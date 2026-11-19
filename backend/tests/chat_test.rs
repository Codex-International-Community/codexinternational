use std::{collections::HashMap,sync::Arc};
use axum::{body::Body,http::{Request,StatusCode}};
use backend::{app_router,config::AppConfig,state::AppState};
use tower::ServiceExt;

#[tokio::test]
async fn chat_routes_reject_anonymous_requests(){
 let config=AppConfig::from_map(&HashMap::new()).expect("development config");
 let state=Arc::new(AppState::connect_lazy(config).expect("lazy state"));
 let app=app_router(state);
 let channel="00000000-0000-0000-0000-000000000001";
 for(method,path)in[("GET",format!("/api/v1/channels/{channel}/messages")),("POST",format!("/api/v1/channels/{channel}/messages"))]{
  let response=app.clone().oneshot(Request::builder().method(method).uri(path).body(Body::empty()).expect("request")).await.expect("response");
  assert_eq!(response.status(),StatusCode::UNAUTHORIZED);
 }
}
