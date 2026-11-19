use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode, header},
    routing::{delete, post},
};
use axum_extra::headers::{Authorization, HeaderMapExt, authorization::Bearer};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{error::ErrorResponse, organization_members::ensure_project_access};
use crate::{AppState, auth::RequestContext};

const TOKEN_PREFIX: &str = "vkm_";

#[derive(Clone, sqlx::FromRow)]
pub(super) struct McpPrincipal {
    pub id: Uuid,
    pub name: String,
    pub project_id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Uuid,
}

#[derive(Deserialize)]
struct CreateCredential {
    name: String,
    project_id: Uuid,
}

#[derive(Serialize, sqlx::FromRow)]
struct Credential {
    id: Uuid,
    name: String,
    project_id: Uuid,
    project_name: String,
    expires_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct IssuedCredential {
    #[serde(flatten)]
    credential: Credential,
    token: String,
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/mcp_credentials",
            post(create_credential).get(list_credentials),
        )
        .route("/mcp_credentials/{id}", delete(revoke_credential))
}

async fn create_credential(
    State(state): State<AppState>,
    Extension(ctx): Extension<RequestContext>,
    Json(payload): Json<CreateCredential>,
) -> Result<
    (
        StatusCode,
        [(header::HeaderName, &'static str); 1],
        Json<IssuedCredential>,
    ),
    ErrorResponse,
> {
    let name = payload.name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(ErrorResponse::new(
            StatusCode::BAD_REQUEST,
            "invalid credential name",
        ));
    }
    let organization_id =
        ensure_project_access(state.pool(), ctx.user.id, payload.project_id).await?;
    let mut random = [0u8; 32];
    rand::rng().fill_bytes(&mut random);
    let token = format!("{TOKEN_PREFIX}{}", hex::encode(random));
    let token_hash = hash_token(&token);
    let credential = sqlx::query_as::<_, Credential>(
        "WITH issued AS (
             INSERT INTO mcp_credentials (token_hash, name, project_id, organization_id, user_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, project_id, expires_at
         )
         SELECT issued.*, p.name AS project_name
         FROM issued JOIN projects p ON p.id = issued.project_id",
    )
    .bind(&token_hash[..])
    .bind(name)
    .bind(payload.project_id)
    .bind(organization_id)
    .bind(ctx.user.id)
    .fetch_one(state.pool())
    .await
    .map_err(credential_db_error)?;

    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(IssuedCredential { credential, token }),
    ))
}

async fn list_credentials(
    State(state): State<AppState>,
    Extension(ctx): Extension<RequestContext>,
) -> Result<Json<Vec<Credential>>, ErrorResponse> {
    let credentials = sqlx::query_as::<_, Credential>(
        "SELECT c.id, c.name, c.project_id, p.name AS project_name, c.expires_at
         FROM mcp_credentials c JOIN projects p ON p.id = c.project_id
         WHERE c.user_id = $1 ORDER BY c.expires_at DESC, c.id",
    )
    .bind(ctx.user.id)
    .fetch_all(state.pool())
    .await
    .map_err(credential_db_error)?;
    Ok(Json(credentials))
}

async fn revoke_credential(
    State(state): State<AppState>,
    Extension(ctx): Extension<RequestContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ErrorResponse> {
    let deleted = sqlx::query("DELETE FROM mcp_credentials WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(ctx.user.id)
        .execute(state.pool())
        .await
        .map_err(credential_db_error)?;
    Ok(if deleted.rows_affected() == 0 {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::NO_CONTENT
    })
}

pub(super) async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<McpPrincipal>, ErrorResponse> {
    let Some(Authorization(bearer)) = headers.typed_get::<Authorization<Bearer>>() else {
        return Ok(None);
    };
    let token = bearer.token();
    if !token.starts_with(TOKEN_PREFIX) || token.len() != TOKEN_PREFIX.len() + 64 {
        return Ok(None);
    }
    let token_hash = hash_token(token);
    sqlx::query_as::<_, McpPrincipal>(
        "SELECT c.id, c.name, c.project_id, c.organization_id, c.user_id
         FROM mcp_credentials c
         JOIN projects p ON (p.id, p.organization_id) = (c.project_id, c.organization_id)
         JOIN organization_member_metadata m
           ON (m.organization_id, m.user_id) = (c.organization_id, c.user_id)
         WHERE c.token_hash = $1 AND c.expires_at > NOW()",
    )
    .bind(&token_hash[..])
    .fetch_optional(state.pool())
    .await
    .map_err(credential_db_error)
}

fn hash_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn credential_db_error(error: sqlx::Error) -> ErrorResponse {
    tracing::error!(?error, "MCP credential database operation failed");
    super::error::db_error(error, "MCP credential database operation failed")
}
