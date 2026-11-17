use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub provider: String,
    pub provider_id: String,
    pub email: Option<String>,
    pub display_name: String,
    pub initials: String,
    pub tone: String,
    pub status: String,
    pub role: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub abbr: String,
    pub tone: String,
    pub owner_id: Option<Uuid>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Channel {
    pub id: String,
    pub server_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub position: i32,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: String,
    pub author_id: Uuid,
    pub text: String,
    pub reactions: sqlx::types::Json<serde_json::Value>,
    pub reply_to: Option<Uuid>,
    pub attachment: Option<sqlx::types::Json<serde_json::Value>>,
    pub edited: bool,
    pub created_at: DateTime<Utc>,
    // joined
    pub author_name: String,
    pub author_initials: String,
    pub author_tone: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateMessage {
    pub text: String,
    pub reply_to: Option<Uuid>,
    pub attachment: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct FullData {
    pub user: User,
    pub servers: Vec<Server>,
    pub channels: std::collections::HashMap<String, Vec<Channel>>,
    pub messages: std::collections::HashMap<String, Vec<Message>>,
    pub dm_messages: std::collections::HashMap<String, Vec<Message>>,
    pub conversations: Vec<serde_json::Value>,
    pub pins: std::collections::HashMap<String, Vec<String>>,
    pub display_name: String,
    pub theme: String,
}