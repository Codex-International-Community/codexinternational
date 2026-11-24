use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SocialActionKind {
    Like,
    Repost,
    Bookmark,
}

impl SocialActionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Like => "like",
            Self::Repost => "repost",
            Self::Bookmark => "bookmark",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialActionStreamRecord {
    pub user_id: Uuid,
    pub post_id: Uuid,
    pub kind: SocialActionKind,
    pub active: bool,
    pub timestamp_ms: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreatePostRequest {
    pub content: String,
    pub media_url: Option<String>,
    pub media_alt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateReplyRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ListPostsQuery {
    pub tab: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SocialReplyResponse {
    pub id: Uuid,
    pub author: String,
    pub handle: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SocialPostResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub author: String,
    pub handle: String,
    pub verified: bool,
    pub text: String,
    pub media: Option<String>,
    pub media_alt: Option<String>,
    pub likes: i64,
    pub reposts: i64,
    pub replies: Vec<SocialReplyResponse>,
    pub liked: bool,
    pub reposted: bool,
    pub saved: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToggleActionResponse {
    pub post_id: Uuid,
    pub action: String,
    pub active: bool,
    pub likes: i64,
    pub reposts: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SocialActivityItem {
    pub id: String,
    pub post_id: Uuid,
    pub kind: String, // "reply" | "like" | "repost"
    pub actor_name: String,
    pub actor_handle: String,
    pub preview: String,
    pub created_at: DateTime<Utc>,
}
