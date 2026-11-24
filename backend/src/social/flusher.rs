use std::{sync::Arc, time::Duration};

use fred::{
    interfaces::{ClientLike, StreamsInterface},
    types::streams::XReadResponse,
};
use tokio::time::{interval, sleep};

use super::{
    protocol::SocialActionStreamRecord,
    repo::{SOCIAL_ACTION_GROUP, SOCIAL_ACTION_STREAM, persist_action_batch},
};
use crate::{error::AppError, state::AppState};

const CONSUMER: &str = "social_pg_flusher_local";
const FLUSH_INTERVAL: Duration = Duration::from_millis(500);

pub async fn run_social_flusher(state: Arc<AppState>) {
    let flusher_client = match state.build_valkey_client() {
        Ok(client) => client,
        Err(e) => {
            tracing::error!(error = %e, "failed to build dedicated social flusher valkey client");
            return;
        }
    };
    if let Err(e) = flusher_client.init().await {
        tracing::error!(error = %e, "failed to connect dedicated social flusher valkey client");
        return;
    }

    let group: Result<String, _> = flusher_client
        .xgroup_create(SOCIAL_ACTION_STREAM, SOCIAL_ACTION_GROUP, "0", true)
        .await;
    if let Err(e) = group
        && !e.to_string().contains("BUSYGROUP")
    {
        tracing::error!(error = %e, "social stream group init failed");
        return;
    }

    let mut ticker = interval(FLUSH_INTERVAL);
    loop {
        ticker.tick().await;

        let pending: Result<XReadResponse<String, String, String, String>, _> = flusher_client
            .xreadgroup_map(
                SOCIAL_ACTION_GROUP,
                CONSUMER,
                Some(1000),
                None,
                false,
                SOCIAL_ACTION_STREAM,
                "0",
            )
            .await;
        if let Ok(res) = pending {
            let batch = flatten(res);
            if !batch.is_empty()
                && let Err(e) = flush(&state, batch).await
            {
                tracing::warn!(error = %e, "pending social action flush failed");
                sleep(Duration::from_millis(250)).await;
                continue;
            }
        }

        let fresh: Result<XReadResponse<String, String, String, String>, _> = flusher_client
            .xreadgroup_map(
                SOCIAL_ACTION_GROUP,
                CONSUMER,
                Some(1000),
                None,
                false,
                SOCIAL_ACTION_STREAM,
                ">",
            )
            .await;
        if let Ok(res) = fresh {
            let batch = flatten(res);
            if !batch.is_empty()
                && let Err(e) = flush(&state, batch).await
            {
                tracing::warn!(error = %e, "social action flush failed");
                sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

fn flatten(
    r: XReadResponse<String, String, String, String>,
) -> Vec<(String, SocialActionStreamRecord)> {
    r.into_values()
        .flatten()
        .filter_map(|(id, fields)| {
            fields
                .get("payload")
                .and_then(|v| serde_json::from_str::<SocialActionStreamRecord>(v).ok())
                .map(|m| (id, m))
        })
        .collect()
}

async fn flush(
    state: &AppState,
    batch: Vec<(String, SocialActionStreamRecord)>,
) -> Result<(), AppError> {
    if let Err(batch_err) = persist_action_batch(&state.pg, &batch).await {
        tracing::warn!(
            error = %batch_err,
            count = batch.len(),
            "social action batch persist failed; isolating per-record"
        );
        let mut ack_ids = Vec::with_capacity(batch.len());
        for (id, rec) in batch {
            let single = [(id.clone(), rec)];
            match persist_action_batch(&state.pg, &single).await {
                Ok(()) => ack_ids.push(id),
                Err(AppError::Internal(err))
                    if err
                        .downcast_ref::<sqlx::Error>()
                        .and_then(|se| se.as_database_error())
                        .and_then(|de| de.code())
                        .is_some_and(|c| c.starts_with("23") || c.starts_with("22")) =>
                {
                    tracing::error!(
                        stream_id = %id,
                        error = %err,
                        "dropping poison social stream record after permanent SQL constraint error"
                    );
                    ack_ids.push(id);
                }
                Err(e) => return Err(e),
            }
        }
        if !ack_ids.is_empty() {
            let _: i64 = state
                .valkey
                .xack(SOCIAL_ACTION_STREAM, SOCIAL_ACTION_GROUP, ack_ids.clone())
                .await?;
            let _: i64 = state.valkey.xdel(SOCIAL_ACTION_STREAM, ack_ids).await?;
        }
        return Ok(());
    }

    let ids = batch.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
    let _: i64 = state
        .valkey
        .xack(SOCIAL_ACTION_STREAM, SOCIAL_ACTION_GROUP, ids.clone())
        .await?;
    let _: i64 = state.valkey.xdel(SOCIAL_ACTION_STREAM, ids).await?;
    Ok(())
}
