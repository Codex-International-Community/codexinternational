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
