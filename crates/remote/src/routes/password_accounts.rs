use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;

use super::error::ErrorResponse;
use crate::{
    AppState,
    auth::{
        RequestContext,
        passwords::{self, PasswordError},
    },
};

impl From<PasswordError> for ErrorResponse {
    fn from(error: PasswordError) -> Self {
        let status = match &error {
            PasswordError::Disabled | PasswordError::InvalidLink => StatusCode::NOT_FOUND,
            PasswordError::InvalidCredentials => StatusCode::UNAUTHORIZED,
            PasswordError::AlreadyExists => StatusCode::CONFLICT,
            PasswordError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            PasswordError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            PasswordError::Database(_) | PasswordError::Internal(_) => {
                tracing::error!(?error, "password account operation failed");
                return Self::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not complete account operation",
                );
            }
        };
        Self::new(status, error.to_string())
    }
}

pub(super) fn public_router() -> Router<AppState> {
    Router::new()
        .route("/auth/local/invitations/preview", post(preview))
        .route("/auth/local/invitations/accept", post(enroll))
        .route("/auth/local/password/reset", post(reset))
        .layer(DefaultBodyLimit::max(8 * 1024))
}

pub(super) fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/auth/local/password/change", post(change))
        .layer(DefaultBodyLimit::max(8 * 1024))
}

#[derive(Deserialize)]
struct Link {
    token: String,
}

#[derive(Deserialize)]
struct Enroll {
    token: String,
    display_name: String,
    password: String,
}

#[derive(Deserialize)]
struct Reset {
    token: String,
    password: String,
}

#[derive(Deserialize)]
struct Change {
    current_password: String,
    new_password: String,
}

async fn preview(
    State(state): State<AppState>,
    Json(link): Json<Link>,
) -> Result<Response, ErrorResponse> {
    let details = passwords::preview(&state, &link.token).await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(details)).into_response())
}

async fn enroll(
    State(state): State<AppState>,
    Json(payload): Json<Enroll>,
) -> Result<Response, ErrorResponse> {
    let result = passwords::enroll(
        &state,
        &payload.token,
        &payload.display_name,
        payload.password,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(result),
    )
        .into_response())
}

async fn reset(
    State(state): State<AppState>,
    Json(payload): Json<Reset>,
) -> Result<StatusCode, ErrorResponse> {
    passwords::reset(&state, &payload.token, payload.password).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn change(
    State(state): State<AppState>,
    Extension(ctx): Extension<RequestContext>,
    Json(payload): Json<Change>,
) -> Result<StatusCode, ErrorResponse> {
    passwords::change(
        &state,
        ctx.user.id,
        &ctx.user.email,
        payload.current_password,
        payload.new_password,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
