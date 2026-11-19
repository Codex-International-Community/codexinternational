use std::sync::Arc;
use axum::{Json,extract::{Path,Query,State},http::StatusCode};
use serde::{Deserialize,Serialize};
use uuid::Uuid;
use crate::{auth::extractor::AuthUser,communities::permissions::PERM_VIEW_CHANNEL,error::AppError,state::AppState};
use super::{protocol::{ClientMessage,MessageAck},repo::{SendMessageInput,channel_access,enqueue,history}};

#[derive(Debug,Deserialize)]
pub struct HistoryQuery{#[serde(default)]pub after_seq:i64,#[serde(default="limit_default")]pub limit:i64}
fn limit_default()->i64{50}
#[derive(Debug,Serialize)]pub struct HistoryResponse{pub messages:Vec<ClientMessage>}
#[derive(Debug,Serialize)]pub struct SendResponse{pub ack:MessageAck}

pub async fn list_messages(State(state):State<Arc<AppState>>,auth:AuthUser,Path(channel):Path<Uuid>,Query(q):Query<HistoryQuery>)
->Result<Json<HistoryResponse>,AppError>{
 channel_access(&state,channel,auth.user_id,PERM_VIEW_CHANNEL,false).await?;
 Ok(Json(HistoryResponse{messages:history(&state,channel,q.after_seq,q.limit).await?}))
}
pub async fn send_message(State(state):State<Arc<AppState>>,auth:AuthUser,Path(channel):Path<Uuid>,Json(input):Json<SendMessageInput>)
->Result<(StatusCode,Json<SendResponse>),AppError>{
 let ack=enqueue(&state,&auth,channel,input).await?;
 Ok((StatusCode::ACCEPTED,Json(SendResponse{ack})))
}


#[derive(Debug,Deserialize)]
pub struct EditMessageInput { pub content: String }

async fn check_message_manage(
 state:&AppState,
 auth:&AuthUser,
 channel_id:Uuid,
 sender_id:Option<Uuid>,
)->Result<(),AppError>{
 if sender_id==Some(auth.user_id){return Ok(());}
 let permissions=sqlx::query_as::<_,(Option<Uuid>,Option<i64>)>(
  "SELECT ch.community_id,r.permissions
   FROM channels ch
   LEFT JOIN community_members cm ON cm.community_id=ch.community_id AND cm.user_id=$2
   LEFT JOIN community_roles r ON r.id=cm.role_id
   WHERE ch.id=$1"
 ).bind(channel_id).bind(auth.user_id).fetch_optional(&state.pg).await?
   .ok_or_else(||AppError::NotFound("message channel not found".to_string()))?;
 if permissions.0.is_none() || !crate::communities::permissions::has_permission(
   permissions.1.unwrap_or_default(),
   crate::communities::permissions::PERM_MANAGE_MESSAGES,
 ){
  return Err(AppError::Forbidden("message owner or MANAGE_MESSAGES permission required".to_string()));
 }
 Ok(())
}

pub async fn edit_message(
 State(state):State<Arc<AppState>>,
 auth:AuthUser,
 Path(message_id):Path<Uuid>,
 Json(input):Json<EditMessageInput>,
)->Result<Json<ClientMessage>,AppError>{
 let content=input.content.trim();
 if content.is_empty()||content.chars().count()>4000{
  return Err(AppError::BadRequest("message content must contain 1-4000 characters".to_string()));
 }
 let row=sqlx::query_as::<_,(Uuid,Option<Uuid>,i64)>(
  "SELECT channel_id,sender_id,seq_id FROM messages WHERE id=$1 AND deleted_at IS NULL"
 ).bind(message_id).fetch_optional(&state.pg).await?
  .ok_or_else(||AppError::NotFound("message not found".to_string()))?;
 let (channel_id,sender_id,seq_id)=row;
 channel_access(&state,channel_id,auth.user_id,crate::communities::permissions::PERM_VIEW_CHANNEL,false).await?;
 check_message_manage(&state,&auth,channel_id,sender_id).await?;
 sqlx::query("UPDATE messages SET content=$2,edited_at=NOW() WHERE id=$1")
  .bind(message_id).bind(content).execute(&state.pg).await?;
 let updated=crate::chat::repo::history(&state,channel_id,seq_id.saturating_sub(1),1).await?
  .into_iter().find(|message|message.id==message_id.to_string())
  .ok_or_else(||AppError::NotFound("message not found after edit".to_string()))?;
 let event=serde_json::json!({"type":"MESSAGE_UPDATE","message":updated});
 let _:Result<i64,_>=state.valkey.publish(format!("pubsub:ch:{channel_id}"),event.to_string()).await;
 Ok(Json(updated))
}

pub async fn delete_message(
 State(state):State<Arc<AppState>>,
 auth:AuthUser,
 Path(message_id):Path<Uuid>,
)->Result<StatusCode,AppError>{
 let row=sqlx::query_as::<_,(Uuid,Option<Uuid>)>(
  "SELECT channel_id,sender_id FROM messages WHERE id=$1 AND deleted_at IS NULL"
 ).bind(message_id).fetch_optional(&state.pg).await?
  .ok_or_else(||AppError::NotFound("message not found".to_string()))?;
 let (channel_id,sender_id)=row;
 channel_access(&state,channel_id,auth.user_id,crate::communities::permissions::PERM_VIEW_CHANNEL,false).await?;
 check_message_manage(&state,&auth,channel_id,sender_id).await?;
 sqlx::query("UPDATE messages SET content=NULL,deleted_at=NOW() WHERE id=$1")
  .bind(message_id).execute(&state.pg).await?;
 let event=serde_json::json!({"type":"MESSAGE_DELETE","id":message_id,"channelId":channel_id});
 let _:Result<i64,_>=state.valkey.publish(format!("pubsub:ch:{channel_id}"),event.to_string()).await;
 Ok(StatusCode::NO_CONTENT)
}
