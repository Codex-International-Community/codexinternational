use chrono::{DateTime,Utc};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug,Deserialize)]
#[serde(tag="type",rename_all="SCREAMING_SNAKE_CASE")]
pub enum ClientFrame {
 Auth{access_token:String,device_id:Option<Uuid>},
 SubscribeChannels{channels:Vec<SubscribeChannel>},
 SendMessage{channel_id:Uuid,client_msg_id:Uuid,content:Option<String>,media_id:Option<Uuid>,reply_to_id:Option<Uuid>,reply_to_story_id:Option<Uuid>},
 TypingStart{channel_id:Uuid},
 MarkRead{channel_id:Uuid,seq_id:i64},
 FocusChannel{channel_id:Option<Uuid>},
 Ping,
}
#[derive(Debug,Clone,Deserialize)]
pub struct SubscribeChannel{pub channel_id:Uuid,#[serde(default)]pub last_seen_seq_id:i64}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MessageStreamRecord{
 pub id:Uuid,pub channel_id:Uuid,pub seq_id:i64,pub client_msg_id:Uuid,pub sender_id:Uuid,
 pub content:Option<String>,pub media_id:Option<Uuid>,pub reply_to_id:Option<Uuid>,pub reply_to_story_id:Option<Uuid>,
 pub created_at:DateTime<Utc>,pub author:String,pub username:String,pub initials:String,#[serde(default)]pub role:Option<String>,#[serde(default)]pub attachment:Option<crate::media::ChatAttachment>
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ClientMessage{
 pub id:String,pub channel_id:String,pub seq_id:i64,pub client_msg_id:String,pub author_id:String,
 pub author:String,pub initials:String,pub tone:String,pub time:String,pub created_at:DateTime<Utc>,pub text:String,pub reactions:Value,
 #[serde(skip_serializing_if = "Option::is_none")] pub role:Option<String>,
 #[serde(skip_serializing_if = "Option::is_none")] pub attachment:Option<crate::media::ChatAttachment>,
 #[serde(skip_serializing_if="Option::is_none")]pub reply_to:Option<String>,pub edited:bool
}
impl From<MessageStreamRecord> for ClientMessage{
 fn from(m:MessageStreamRecord)->Self{Self{
  id:m.id.to_string(),channel_id:m.channel_id.to_string(),seq_id:m.seq_id,client_msg_id:m.client_msg_id.to_string(),
  author_id:m.sender_id.to_string(),author:m.author,initials:m.initials,tone:"member".into(),
  time:m.created_at.format("%H:%M").to_string(),created_at:m.created_at,text:m.content.unwrap_or_default(),
  reactions:serde_json::json!({}),role:m.role,attachment:m.attachment,reply_to:m.reply_to_id.map(|id|id.to_string()),edited:false
 }}
}
#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct MessageAck{
 #[serde(rename="type")]pub frame_type:String,pub client_msg_id:String,pub id:String,pub channel_id:String,
 pub seq_id:i64,pub created_at:DateTime<Utc>
}
