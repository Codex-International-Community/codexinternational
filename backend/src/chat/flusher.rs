use super::{
    protocol::MessageStreamRecord,
    repo::{MESSAGE_GROUP, MESSAGE_STREAM, persist_batch},
};
use crate::{error::AppError, state::AppState};
use fred::{
    interfaces::{ClientLike, StreamsInterface},
    types::streams::XReadResponse,
};
use std::{sync::Arc, time::Duration};
use tokio::time::sleep;
const CONSUMER: &str = "pg_flusher_local";

pub async fn run_message_flusher(state: Arc<AppState>) {
    // Use a dedicated Valkey connection for `XREADGROUP BLOCK 0` so blocking
    // stream reads never stall commands on the shared `state.valkey` pool.
    let flusher_client = match state.build_valkey_client() {
        Ok(client) => client,
        Err(e) => {
            tracing::error!(error = %e, "failed to build dedicated flusher valkey client");
            return;
        }
    };
    if let Err(e) = flusher_client.init().await {
        tracing::error!(error = %e, "failed to connect dedicated flusher valkey client");
        return;
    }

    let group: Result<String, _> = flusher_client
        .xgroup_create(MESSAGE_STREAM, MESSAGE_GROUP, "0", true)
        .await;
    if let Err(e) = group
        && !e.to_string().contains("BUSYGROUP")
    {
        tracing::error!(error=%e,"stream group init failed");
        return;
    }
    loop {
        let pending: Result<XReadResponse<String, String, String, String>, _> = flusher_client
            .xreadgroup_map(
                MESSAGE_GROUP,
                CONSUMER,
                Some(1000),
                None,
                false,
                MESSAGE_STREAM,
                "0",
            )
            .await;
        if let Ok(res) = pending {
            let batch = flatten(res);
            if !batch.is_empty()
                && let Err(e) = flush(&state, batch).await
            {
                tracing::warn!(error=%e,"pending flush failed");
                sleep(Duration::from_millis(250)).await;
                continue;
            }
        }
        // Redis/Valkey returns a null reply when a finite BLOCK timeout expires without
        // new entries. fred's map helper cannot decode that null as XReadResponse, so
        // BLOCK 0 waits for the next entry and avoids spurious "Cannot convert to map" errors.
        let fresh: Result<XReadResponse<String, String, String, String>, _> = flusher_client
            .xreadgroup_map(
                MESSAGE_GROUP,
                CONSUMER,
                Some(1000),
                Some(0),
                false,
                MESSAGE_STREAM,
                ">",
            )
            .await;
        match fresh {
            Ok(res) => {
                let batch = flatten(res);
                if !batch.is_empty()
                    && let Err(e) = flush(&state, batch).await
                {
                    tracing::warn!(error=%e,"message flush failed");
                    sleep(Duration::from_millis(250)).await;
                }
            }
            Err(e) => {
                tracing::error!(error=%e,"stream read failed");
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
}
fn flatten(r: XReadResponse<String, String, String, String>) -> Vec<(String, MessageStreamRecord)> {
    r.into_values()
        .flatten()
        .filter_map(|(id, fields)| {
            fields
                .get("payload")
                .and_then(|v| serde_json::from_str::<MessageStreamRecord>(v).ok())
                .map(|m| (id, m))
        })
        .collect()
}
async fn flush(
    state: &AppState,
    batch: Vec<(String, MessageStreamRecord)>,
) -> Result<(), AppError> {
    persist_batch(&state.pg, &batch).await?;
    let ids = batch.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
    let _: i64 = state
        .valkey
        .xack(MESSAGE_STREAM, MESSAGE_GROUP, ids.clone())
        .await?;
    let _: i64 = state.valkey.xdel(MESSAGE_STREAM, ids).await?;
    Ok(())
}
