pub mod flusher;
pub mod handlers;
pub mod protocol;
pub mod registry;
pub mod repo;
pub mod ws;

use std::sync::Arc;
use axum::{Router,routing::get};
use crate::state::AppState;

pub fn router()->Router<Arc<AppState>>{
 Router::new().route("/channels/{channel_id}/messages",get(handlers::list_messages).post(handlers::send_message))
  .route("/messages/{message_id}",axum::routing::patch(handlers::edit_message).delete(handlers::delete_message))
}
