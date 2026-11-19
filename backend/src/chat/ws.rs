use std::{collections::HashSet,sync::Arc,time::Duration};
use axum::extract::{State,WebSocketUpgrade,ws::{Message,WebSocket}};
use chrono::Utc;
use fred::interfaces::PubsubInterface;
use serde::{Deserialize,Serialize};
use tokio::{sync::mpsc,time::{interval,timeout}};
use uuid::Uuid;
use crate::{auth::jwt::decode_access_token,communities::permissions::PERM_VIEW_CHANNEL,state::AppState};
use super::{protocol::ClientFrame,repo::{SendMessageInput,channel_access,enqueue,history}};

#[derive(Debug,Deserialize)]struct AuthFrame{#[serde(rename="type")]frame_type:String,access_token:String,device_id:Option<Uuid>}
pub async fn upgrade(State(state):State<Arc<AppState>>,ws:WebSocketUpgrade)->axum::response::Response{ws.on_upgrade(move|socket|run_socket(socket,state))}

async fn run_socket(mut socket:WebSocket,state:Arc<AppState>){
 let auth=match timeout(Duration::from_secs(5),socket.recv()).await{Ok(Some(Ok(Message::Text(t))))=>serde_json::from_str::<AuthFrame>(t.as_str()).ok(),_=>None};
 let Some(auth)=auth.filter(|a|a.frame_type=="AUTH")else{let _=socket.send(Message::Close(None)).await;return;};
 let claims=match decode_access_token(&auth.access_token,state.config.jwt_secret.expose()){Ok(c)=>c,Err(_)=>{let _=send(&mut socket,serde_json::json!({"type":"ERROR","code":"UNAUTHORIZED"})).await;let _=socket.send(Message::Close(None)).await;return;}};
 if auth.device_id.is_some_and(|id|id!=claims.sid){let _=socket.send(Message::Close(None)).await;return;}
 let valid=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM user_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()) AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND (suspended_until IS NULL OR suspended_until<=NOW()))")
  .bind(claims.sid).bind(claims.sub).fetch_one(&state.pg).await.unwrap_or(false);
 if !valid{let _=socket.send(Message::Close(None)).await;return;}
 if send(&mut socket,serde_json::json!({"type":"READY","userId":claims.sub,"serverTime":Utc::now()})).await.is_err(){return;}

 let(tx,mut rx)=mpsc::channel::<String>(128);let mut subscribed=HashSet::new();let mut jobs=Vec::new();let mut focused:Option<Uuid>=None;let mut beat=interval(Duration::from_secs(30));let presence=format!("presence:user:{}",claims.sub);
 let _:Result<(),_>=state.valkey.set(&presence,Utc::now().timestamp().to_string(),Some(fred::types::Expiration::EX(90)),None,false).await;
 loop{
  tokio::select!{
   out=rx.recv()=>{let Some(out)=out else{break;};if socket.send(Message::Text(out.into())).await.is_err(){break;}}
   incoming=socket.recv()=>{
    let Some(Ok(frame))=incoming else{break;};
    let raw=match frame{Message::Text(t)=>t,Message::Close(_)=>break,_=>continue};
    let cmd=match serde_json::from_str::<ClientFrame>(raw.as_str()){Ok(v)=>v,Err(_)=>{let _=send(&mut socket,serde_json::json!({"type":"ERROR","code":"BAD_FRAME"})).await;continue;}};
    match cmd{
     ClientFrame::Auth{..}=>{let _=send(&mut socket,serde_json::json!({"type":"ERROR","code":"ALREADY_AUTHENTICATED"})).await;}
     ClientFrame::Ping=>{let _=send(&mut socket,serde_json::json!({"type":"PONG"})).await;}
     ClientFrame::SubscribeChannels{channels}=>for sub in channels{
      if subscribed.contains(&sub.channel_id){continue;}
      if let Err(e)=channel_access(&state,sub.channel_id,claims.sub,PERM_VIEW_CHANNEL,false).await{let _=send(&mut socket,serde_json::json!({"type":"ERROR","channelId":sub.channel_id,"message":e.to_string()})).await;continue;}
      let(receiver,first)=state.ws_registry.subscribe(sub.channel_id).await;
      if first{let _=state.valkey_sub.subscribe(format!("pubsub:ch:{}",sub.channel_id)).await;}
      let sender=tx.clone();jobs.push(tokio::spawn(async move{let mut receiver=receiver;loop{match receiver.recv().await{Ok(v)=>if sender.send(v).await.is_err(){break;},Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>continue,Err(tokio::sync::broadcast::error::RecvError::Closed)=>break;}}}));
      subscribed.insert(sub.channel_id);
      match history(&state,sub.channel_id,sub.last_seen_seq_id,100).await{Ok(messages)=>{let _=send(&mut socket,serde_json::json!({"type":"GAP_SYNC_BATCH","channelId":sub.channel_id,"messages":messages,"resyncRequired":false})).await;},Err(e)=>{let _=send(&mut socket,serde_json::json!({"type":"ERROR","channelId":sub.channel_id,"message":e.to_string()})).await;}}
     },
     ClientFrame::SendMessage{channel_id,client_msg_id,content,media_id,reply_to_id,reply_to_story_id}=>{
      let user=crate::auth::extractor::AuthUser{user_id:claims.sub,device_id:claims.sid,platform_role:claims.role.clone()};
      match enqueue(&state,&user,channel_id,SendMessageInput{client_msg_id,content,media_id,reply_to_id,reply_to_story_id}).await{Ok(ack)=>{let _=send(&mut socket,ack).await;},Err(e)=>{let _=send(&mut socket,serde_json::json!({"type":"ERROR","code":"SEND_MESSAGE_FAILED","message":e.to_string()})).await;}}
     },
     ClientFrame::TypingStart{channel_id}=>{
      if channel_access(&state,channel_id,claims.sub,crate::communities::permissions::PERM_SEND_MESSAGES,true).await.is_ok(){let e=serde_json::json!({"type":"TYPING_START","channelId":channel_id,"userId":claims.sub});let _:Result<i64,_>=state.valkey.publish(format!("pubsub:ch:{channel_id}"),e.to_string()).await;}
     },
     ClientFrame::MarkRead{channel_id,seq_id}=>{
      if channel_access(&state,channel_id,claims.sub,PERM_VIEW_CHANNEL,false).await.is_ok(){let _=sqlx::query("UPDATE channel_members SET last_read_seq_id=GREATEST(last_read_seq_id,$3) WHERE channel_id=$1 AND user_id=$2").bind(channel_id).bind(claims.sub).bind(seq_id.max(0)).execute(&state.pg).await;}
     },
     ClientFrame::FocusChannel{channel_id}=>{
      if let Some(old)=focused.take(){let _:Result<i64,_>=state.valkey.del(format!("ws:active:{}:{old}",claims.sub)).await;}
      if let Some(id)=channel_id{if channel_access(&state,id,claims.sub,PERM_VIEW_CHANNEL,false).await.is_ok(){focused=Some(id);let _:Result<(),_>=state.valkey.set(format!("ws:active:{}:{id}",claims.sub),"1",Some(fred::types::Expiration::EX(90)),None,false).await;}}
     }
    }
   },
   _=beat.tick()=>{
    let _:Result<(),_>=state.valkey.set(&presence,Utc::now().timestamp().to_string(),Some(fred::types::Expiration::EX(90)),None,false).await;
    let _=sqlx::query("UPDATE users SET last_seen_at=NOW() WHERE id=$1").bind(claims.sub).execute(&state.pg).await;
    if let Some(id)=focused{let _:Result<(),_>=state.valkey.set(format!("ws:active:{}:{id}",claims.sub),"1",Some(fred::types::Expiration::EX(90)),None,false).await;}
   }
  }
 }
 for job in jobs{job.abort();}
 for id in subscribed{if state.ws_registry.unsubscribe(id).await{let _=state.valkey_sub.unsubscribe(format!("pubsub:ch:{id}")).await;}}
 if let Some(id)=focused{let _:Result<i64,_>=state.valkey.del(format!("ws:active:{}:{id}",claims.sub)).await;}
}

async fn send<T:Serialize>(socket:&mut WebSocket,value:T)->Result<(),axum::Error>{let encoded=serde_json::to_string(&value).unwrap_or_else(|_|"{\"type\":\"ERROR\"}".into());socket.send(Message::Text(encoded.into())).await}

pub fn start_pubsub_dispatcher(state:Arc<AppState>){
 let _manager=state.valkey_sub.manage_subscriptions();let mut messages=state.valkey_sub.message_rx();
 tokio::spawn(async move{loop{match messages.recv().await{
  Ok(m)=>{let name=m.channel.to_string();let Some(id)=name.strip_prefix("pubsub:ch:").and_then(|s|Uuid::parse_str(s).ok())else{continue;};if let Ok(payload)=m.value.convert::<String>(){state.ws_registry.publish(id,payload).await;}}
  Err(e)=>tracing::warn!(error=%e,"Valkey Pub/Sub receive error")
 }}})
}
