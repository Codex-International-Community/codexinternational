//! Skill Radar & Smart Question Routing: maps member skill tags (opt-in)
//! and routes open technical questions to the most relevant experts.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::wiki::normalize_tags;
use crate::{
    auth::extractor::{AuthUser, OptionalAuthUser},
    chat::repo::channel_access,
    communities::permissions::PERM_VIEW_CHANNEL,
    error::AppError,
    state::AppState,
};

#[derive(Debug, Serialize, FromRow)]
pub struct UserSkillTag {
    pub tag: String,
    pub score: i32,
    pub opt_in: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSkillsRequest {
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub opt_in: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct RadarQuestion {
    pub id: Uuid,
    pub community_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub author_id: Uuid,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub status: String,
    pub matched_user_ids: Vec<Uuid>,
    pub solved_wiki_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub solved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRadarQuestionRequest {
    pub community_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListRadarQuery {
    pub status: Option<String>,
    pub tag: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SolveRadarRequest {
    pub solver_user_id: Option<Uuid>,
    pub wiki_id: Option<Uuid>,
}

fn default_true() -> bool {
    true
}

/// `GET /api/v1/moat/skills/me`
pub async fn get_my_skills(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<UserSkillTag>>, AppError> {
    let rows = sqlx::query_as::<_, UserSkillTag>(
        "SELECT tag, score, opt_in, updated_at
         FROM user_skill_tags
         WHERE user_id = $1
         ORDER BY score DESC, tag ASC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

/// `PUT /api/v1/moat/skills/me`
pub async fn update_my_skills(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<UpdateSkillsRequest>,
) -> Result<Json<Vec<UserSkillTag>>, AppError> {
    let tags = normalize_tags(&req.tags);
    let mut tx = state.pg.begin().await?;

    sqlx::query("DELETE FROM user_skill_tags WHERE user_id = $1")
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;

    for tag in &tags {
        sqlx::query(
            "INSERT INTO user_skill_tags (user_id, tag, score, opt_in)
             VALUES ($1, $2, 1, $3)
             ON CONFLICT (user_id, tag)
             DO UPDATE SET opt_in = EXCLUDED.opt_in, updated_at = NOW()",
        )
        .bind(auth.user_id)
        .bind(tag)
        .bind(req.opt_in)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    get_my_skills(State(state), auth).await
}

/// `POST /api/v1/moat/radar/questions`
pub async fn create_radar_question(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<CreateRadarQuestionRequest>,
) -> Result<(StatusCode, Json<RadarQuestion>), AppError> {
    if let Some(cid) = req.channel_id {
        channel_access(&state, cid, auth.user_id, PERM_VIEW_CHANNEL, false).await?;
    }

    let title = req.title.trim();
    let body = req.body.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::BadRequest(
            "title must be 1-200 characters".into(),
        ));
    }
    if body.is_empty() || body.chars().count() > 4000 {
        return Err(AppError::BadRequest(
            "body must be 1-4000 characters".into(),
        ));
    }

    let tags = normalize_tags(&req.tags);
    let matched_user_ids: Vec<Uuid> = if tags.is_empty() {
        Vec::new()
    } else {
        sqlx::query_scalar(
            "SELECT user_id
             FROM user_skill_tags
             WHERE opt_in = TRUE
               AND user_id <> $1
               AND tag = ANY($2)
             GROUP BY user_id
             ORDER BY SUM(score) DESC
             LIMIT 5",
        )
        .bind(auth.user_id)
        .bind(&tags)
        .fetch_all(&state.pg)
        .await?
    };

    let id = Uuid::now_v7();
    let question = sqlx::query_as::<_, RadarQuestion>(
        "INSERT INTO help_radar_questions
            (id, community_id, channel_id, author_id, title, body, tags, matched_user_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *",
    )
    .bind(id)
    .bind(req.community_id)
    .bind(req.channel_id)
    .bind(auth.user_id)
    .bind(title)
    .bind(body)
    .bind(&tags)
    .bind(&matched_user_ids)
    .fetch_one(&state.pg)
    .await?;

    Ok((StatusCode::CREATED, Json(question)))
}

/// `GET /api/v1/moat/radar/questions` (Public Read-Only)
pub async fn list_radar_questions(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(_user): OptionalAuthUser,
    Query(query): Query<ListRadarQuery>,
) -> Result<Json<Vec<RadarQuestion>>, AppError> {
    let status = query
        .status
        .as_deref()
        .map(|s| s.trim().to_ascii_uppercase())
        .filter(|s| matches!(s.as_str(), "OPEN" | "SOLVED"));
    let tag = query
        .tag
        .as_deref()
        .map(|s| s.trim().trim_start_matches('#').to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    let limit = query.limit.unwrap_or(30).clamp(1, 100);

    let rows = sqlx::query_as::<_, RadarQuestion>(
        "SELECT *
         FROM help_radar_questions
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR $2 = ANY(tags))
         ORDER BY created_at DESC
         LIMIT $3",
    )
    .bind(status)
    .bind(tag)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(rows))
}

/// `POST /api/v1/moat/radar/questions/{id}/solve`
pub async fn solve_radar_question(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<SolveRadarRequest>,
) -> Result<Json<RadarQuestion>, AppError> {
    let existing =
        sqlx::query_as::<_, RadarQuestion>("SELECT * FROM help_radar_questions WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pg)
            .await?
            .ok_or_else(|| AppError::NotFound("question not found".into()))?;

    if existing.author_id != auth.user_id && auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only the question author or dev can mark solved".into(),
        ));
    }

    let mut tx = state.pg.begin().await?;
    let updated = sqlx::query_as::<_, RadarQuestion>(
        "UPDATE help_radar_questions
         SET status = 'SOLVED',
             solved_wiki_id = COALESCE($2, solved_wiki_id),
             solved_at = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(req.wiki_id)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(solver_id) = req.solver_user_id {
        for tag in &updated.tags {
            sqlx::query(
                "INSERT INTO user_skill_tags (user_id, tag, score, opt_in)
                 VALUES ($1, $2, 2, TRUE)
                 ON CONFLICT (user_id, tag)
                 DO UPDATE SET score = user_skill_tags.score + 2, updated_at = NOW()",
            )
            .bind(solver_id)
            .bind(tag)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(Json(updated))
}
