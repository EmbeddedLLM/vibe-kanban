use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use api_types::{LocalLoginRequest, LocalLoginResponse, MemberRole, User};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use secrecy::ExposeSecret;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    AppState,
    auth::local::LOCAL_AUTH_PROVIDER,
    config::AuthConfig,
    db::{Tx, auth::AuthSessionRepository, organizations::OrganizationRepository},
};

const INVITATION_PREFIX: &str = "password-";
const MIN_PASSWORD_LENGTH: usize = 15;
const MAX_PASSWORD_BYTES: usize = 1024;
static PASSWORD_WORKERS: Semaphore = Semaphore::const_new(4);
static LOGIN_WINDOW: LazyLock<Mutex<LoginWindow>> =
    LazyLock::new(|| Mutex::new(LoginWindow::new()));

struct LoginWindow {
    started: Instant,
    total: u16,
    per_email: HashMap<[u8; 32], u16>,
}

impl LoginWindow {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            total: 0,
            per_email: HashMap::new(),
        }
    }

    fn allow(&mut self, email: &str) -> bool {
        if self.started.elapsed() >= Duration::from_secs(60) {
            *self = Self::new();
        }
        if self.total >= 120 {
            return false;
        }
        let count = self.per_email.entry(digest(email)).or_default();
        if *count >= 10 {
            return false;
        }
        *count += 1;
        self.total += 1;
        true
    }
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PasswordError {
    #[error("Password accounts are disabled")]
    Disabled,
    #[error("Invalid email or password")]
    InvalidCredentials,
    #[error("This link is invalid, expired, or already used")]
    InvalidLink,
    #[error("An account already exists for this email")]
    AlreadyExists,
    #[error("{0}")]
    InvalidInput(&'static str),
    #[error("Too many password requests. Wait a minute and try again.")]
    RateLimited,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

pub(crate) fn normalize_email(email: &str) -> Result<String, PasswordError> {
    let email = email.trim();
    let valid_parts = email.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty() && !domain.is_empty() && !domain.contains('@')
    });
    if !valid_parts
        || !email.is_ascii()
        || email.len() > 254
        || email.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(PasswordError::InvalidInput("Enter a valid email address"));
    }
    Ok(email.to_ascii_lowercase())
}

pub(crate) fn ensure_enabled(config: &AuthConfig) -> Result<(), PasswordError> {
    if config.password_accounts() {
        Ok(())
    } else {
        Err(PasswordError::Disabled)
    }
}

async fn password_job<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, PasswordError> {
    let slot = PASSWORD_WORKERS
        .try_acquire()
        .map_err(|_| PasswordError::RateLimited)?;
    let result = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        work()
    })
    .await
    .map_err(anyhow::Error::from)?;
    Ok(result)
}

fn hash(password: &str) -> Result<String, PasswordError> {
    let salt = SaltString::encode_b64(&rand::random::<[u8; 16]>())
        .map_err(|_| anyhow::anyhow!("could not generate a password salt"))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|value| value.to_string())
        .map_err(|_| anyhow::anyhow!("could not hash password").into())
}

async fn hash_new_password(password: String) -> Result<String, PasswordError> {
    if password.len() > MAX_PASSWORD_BYTES || password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(PasswordError::InvalidInput(
            "Use at least 15 characters and at most 1024 bytes",
        ));
    }
    password_job(move || hash(&password)).await?
}

async fn verify_password(
    password: String,
    stored_hash: Option<String>,
) -> Result<bool, PasswordError> {
    if password.len() > MAX_PASSWORD_BYTES {
        return Ok(false);
    }
    password_job(move || match stored_hash {
        Some(encoded) => PasswordHash::new(&encoded).is_ok_and(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        }),
        None => {
            let _ = hash(&password);
            false
        }
    })
    .await
}

async fn insert_user(
    tx: &mut Tx<'_>,
    email: &str,
    name: &str,
    password_hash: &str,
    operator: bool,
) -> Result<User, PasswordError> {
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, first_name)
         SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, first_name, last_name, username, created_at, updated_at",
    )
    .bind(email)
    .bind(name)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(PasswordError::AlreadyExists)?;
    sqlx::query("INSERT INTO local_password_credentials (user_id, password_hash, is_operator) VALUES ($1, $2, $3)")
        .bind(user.id).bind(password_hash).bind(operator).execute(&mut **tx).await?;
    Ok(user)
}

pub(crate) async fn bootstrap(pool: &PgPool, config: &AuthConfig) -> anyhow::Result<()> {
    if !config.password_accounts() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(518092026031800)")
        .execute(&mut *tx)
        .await?;
    let operator = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM local_password_credentials WHERE is_operator",
    )
    .fetch_optional(&mut *tx)
    .await?;
    if operator.is_none() {
        let initial = config.local().ok_or_else(|| anyhow::anyhow!(
                "Set SELF_HOST_LOCAL_AUTH_EMAIL and SELF_HOST_LOCAL_AUTH_PASSWORD to initialise the first password account"
            ))?;
        let email = normalize_email(initial.email())?;
        let hash = hash_new_password(initial.password().expose_secret().to_owned()).await?;
        let operator = insert_user(&mut tx, &email, "Admin", &hash, true).await?;
        OrganizationRepository::ensure_personal_org_and_admin_membership_tx(
            &mut tx,
            operator.id,
            Some("Admin"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn start_session(
    state: &AppState,
    tx: &mut Tx<'_>,
    user: &User,
) -> Result<LocalLoginResponse, PasswordError> {
    let session = AuthSessionRepository::create_on(&mut **tx, user.id, None)
        .await
        .map_err(anyhow::Error::from)?;
    let tokens = state
        .jwt()
        .generate_tokens(&session, user, LOCAL_AUTH_PROVIDER)
        .map_err(anyhow::Error::from)?;
    AuthSessionRepository::set_current_refresh_token_on(
        &mut **tx,
        session.id,
        tokens.refresh_token_id,
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(LocalLoginResponse {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
    })
}

pub(crate) async fn login(
    state: &AppState,
    payload: &LocalLoginRequest,
) -> Result<LocalLoginResponse, PasswordError> {
    let email = normalize_email(&payload.email).map_err(|_| PasswordError::InvalidCredentials)?;
    if !LOGIN_WINDOW
        .lock()
        .map_err(|_| anyhow::anyhow!("password login limiter unavailable"))?
        .allow(&email)
    {
        return Err(PasswordError::RateLimited);
    }
    let credential = sqlx::query_as::<_, (Uuid, i64, String)>(
        "SELECT u.id, c.version, c.password_hash FROM users u
         JOIN local_password_credentials c ON c.user_id = u.id WHERE u.email = $1",
    )
    .bind(email)
    .fetch_optional(state.pool())
    .await?;
    let (identity, password_hash) = match credential {
        Some((id, version, hash)) => (Some((id, version)), Some(hash)),
        None => (None, None),
    };
    if !verify_password(payload.password.clone(), password_hash).await? {
        return Err(PasswordError::InvalidCredentials);
    }
    let (user_id, version) = identity.ok_or(PasswordError::InvalidCredentials)?;
    let mut tx = state.pool().begin().await?;
    // Password changes and session creation must serialize on this row.
    let user = sqlx::query_as::<_, User>(
        "SELECT u.id, u.email, u.first_name, u.last_name, u.username, u.created_at, u.updated_at
         FROM users u JOIN local_password_credentials c ON c.user_id = u.id
         WHERE u.id = $1 AND c.version = $2 FOR UPDATE OF c",
    )
    .bind(user_id)
    .bind(version)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(PasswordError::InvalidCredentials)?;
    let session = start_session(state, &mut tx, &user).await?;
    tx.commit().await?;
    Ok(session)
}

pub(crate) fn invitation_nonce() -> String {
    format!("{INVITATION_PREFIX}{}", Uuid::new_v4())
}

pub(crate) fn is_password_invite(nonce: &str) -> bool {
    nonce.starts_with(INVITATION_PREFIX)
}

fn invite_mac(config: &AuthConfig, id: Uuid, nonce: &str) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(config.jwt_secret().expose_secret().as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(b"vibe-kanban password invitation v1\0");
    mac.update(id.as_bytes());
    mac.update(nonce.as_bytes());
    mac
}

pub(crate) fn invitation_url(config: &AuthConfig, base: &str, id: Uuid, nonce: &str) -> String {
    let signature = URL_SAFE_NO_PAD.encode(invite_mac(config, id, nonce).finalize().into_bytes());
    format!(
        "{}/invitations/local/accept#{id}.{signature}",
        base.trim_end_matches('/')
    )
}

#[derive(sqlx::FromRow)]
struct PasswordInvitation {
    id: Uuid,
    organization_id: Uuid,
    organization_name: String,
    email: String,
    role: MemberRole,
    expires_at: DateTime<Utc>,
    token: String,
}

#[derive(Serialize)]
pub(crate) struct InvitationPreview {
    organization_name: String,
    email: String,
    role: MemberRole,
    expires_at: DateTime<Utc>,
}

const INVITE_QUERY: &str = "SELECT i.id, i.organization_id, o.name AS organization_name, i.email,
    i.role, i.expires_at, i.token FROM organization_invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.id = $1 AND i.status = 'pending' AND i.expires_at > clock_timestamp()
    AND NOT o.is_personal";

struct InviteClaim {
    id: Uuid,
    signature: Vec<u8>,
}

impl InviteClaim {
    fn parse(token: &str) -> Result<Self, PasswordError> {
        let (id, signature) = token.split_once('.').ok_or(PasswordError::InvalidLink)?;
        if id.len() != 36 || signature.len() != 43 {
            return Err(PasswordError::InvalidLink);
        }
        let id = Uuid::parse_str(id).map_err(|_| PasswordError::InvalidLink)?;
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| PasswordError::InvalidLink)?;
        Ok(Self { id, signature })
    }

    fn check(
        &self,
        config: &AuthConfig,
        invitation: Option<PasswordInvitation>,
    ) -> Result<PasswordInvitation, PasswordError> {
        let invitation = invitation.ok_or(PasswordError::InvalidLink)?;
        if !is_password_invite(&invitation.token)
            || invite_mac(config, invitation.id, &invitation.token)
                .verify_slice(&self.signature)
                .is_err()
        {
            return Err(PasswordError::InvalidLink);
        }
        Ok(invitation)
    }
}

pub(crate) async fn preview(
    state: &AppState,
    token: &str,
) -> Result<InvitationPreview, PasswordError> {
    let config = &state.config().auth;
    ensure_enabled(config)?;
    let claim = InviteClaim::parse(token)?;
    let invitation = claim.check(
        config,
        sqlx::query_as(INVITE_QUERY)
            .bind(claim.id)
            .fetch_optional(state.pool())
            .await?,
    )?;
    Ok(InvitationPreview {
        organization_name: invitation.organization_name,
        email: invitation.email,
        role: invitation.role,
        expires_at: invitation.expires_at,
    })
}

#[derive(Serialize)]
pub(crate) struct Enrollment {
    #[serde(flatten)]
    session: LocalLoginResponse,
    pub(crate) organization_id: Uuid,
    project_id: Option<Uuid>,
}

pub(crate) async fn enroll(
    state: &AppState,
    token: &str,
    name: &str,
    password: String,
) -> Result<Enrollment, PasswordError> {
    preview(state, token).await?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err(PasswordError::InvalidInput(
            "Enter a display name of up to 100 characters",
        ));
    }
    let hash = hash_new_password(password).await?;
    let claim = InviteClaim::parse(token)?;
    let mut tx = state.pool().begin().await?;
    let query = format!("{INVITE_QUERY} FOR UPDATE OF i");
    let invitation = claim.check(
        &state.config().auth,
        sqlx::query_as(&query)
            .bind(claim.id)
            .fetch_optional(&mut *tx)
            .await?,
    )?;
    let user = insert_user(
        &mut tx,
        &normalize_email(&invitation.email)?,
        name,
        &hash,
        false,
    )
    .await?;
    sqlx::query("INSERT INTO organization_member_metadata (organization_id, user_id, role) VALUES ($1, $2, $3)")
        .bind(invitation.organization_id).bind(user.id).bind(invitation.role).execute(&mut *tx).await?;
    sqlx::query("UPDATE organization_invitations SET status = 'accepted' WHERE id = $1")
        .bind(invitation.id)
        .execute(&mut *tx)
        .await?;
    let project_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM projects WHERE organization_id = $1 ORDER BY sort_order, id LIMIT 1",
    )
    .bind(invitation.organization_id)
    .fetch_optional(&mut *tx)
    .await?;
    let session = start_session(state, &mut tx, &user).await?;
    tx.commit().await?;
    tracing::info!(target: "audit", user_id = %user.id, organization_id = %invitation.organization_id,
        invitation_id = %invitation.id, "password invitation accepted");
    Ok(Enrollment {
        session,
        organization_id: invitation.organization_id,
        project_id,
    })
}

pub(crate) async fn issue_reset_link(
    pool: &PgPool,
    config: &AuthConfig,
    email: &str,
) -> Result<String, PasswordError> {
    ensure_enabled(config)?;
    let email = normalize_email(email)?;
    let token = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let token_hash = digest(&token);
    let mut tx = pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT u.id FROM users u JOIN local_password_credentials c ON c.user_id = u.id
         WHERE u.email = $1 FOR UPDATE OF c",
    )
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(PasswordError::InvalidCredentials)?;
    sqlx::query(
        "INSERT INTO local_password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 minutes') ON CONFLICT (user_id)
         DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at",
    )
    .bind(user_id)
    .bind(&token_hash[..])
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::info!(target: "audit", %user_id, "operator issued password reset");
    Ok(format!(
        "{}/invitations/reset/accept#{token}",
        config.public_base_url().trim_end_matches('/')
    ))
}

pub(crate) async fn reset(
    state: &AppState,
    token: &str,
    password: String,
) -> Result<(), PasswordError> {
    ensure_enabled(&state.config().auth)?;
    if token.len() != 43 {
        return Err(PasswordError::InvalidLink);
    }
    let token_hash = digest(token);
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM local_password_resets WHERE token_hash = $1 AND expires_at > clock_timestamp()",
    ).bind(&token_hash[..]).fetch_optional(state.pool()).await?.ok_or(PasswordError::InvalidLink)?;
    let hash = hash_new_password(password).await?;
    let mut tx = state.pool().begin().await?;
    lock_credential(&mut tx, user_id, None).await?;
    let consumed = sqlx::query("DELETE FROM local_password_resets WHERE user_id = $1 AND token_hash = $2 AND expires_at > clock_timestamp()")
        .bind(user_id).bind(&token_hash[..]).execute(&mut *tx).await?;
    if consumed.rows_affected() != 1 {
        return Err(PasswordError::InvalidLink);
    }
    replace_password(&mut tx, user_id, &hash).await?;
    sqlx::query("DELETE FROM mcp_credentials WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!(target: "audit", %user_id, "local password reset");
    Ok(())
}

async fn lock_credential(
    tx: &mut Tx<'_>,
    user_id: Uuid,
    version: Option<i64>,
) -> Result<(), PasswordError> {
    sqlx::query_scalar::<_, i64>("SELECT version FROM local_password_credentials WHERE user_id = $1 AND ($2::bigint IS NULL OR version = $2) FOR UPDATE")
        .bind(user_id).bind(version).fetch_optional(&mut **tx).await?.ok_or(PasswordError::InvalidCredentials)?;
    Ok(())
}

async fn replace_password(tx: &mut Tx<'_>, user_id: Uuid, hash: &str) -> Result<(), PasswordError> {
    sqlx::query("UPDATE local_password_credentials SET password_hash = $2, version = version + 1, changed_at = now() WHERE user_id = $1")
        .bind(user_id).bind(hash).execute(&mut **tx).await?;
    sqlx::query(
        "UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub(crate) async fn change(
    state: &AppState,
    user_id: Uuid,
    email: &str,
    current: String,
    proposed: String,
) -> Result<(), PasswordError> {
    ensure_enabled(&state.config().auth)?;
    if !LOGIN_WINDOW
        .lock()
        .map_err(|_| anyhow::anyhow!("password login limiter unavailable"))?
        .allow(email)
    {
        return Err(PasswordError::RateLimited);
    }
    let (version, hash) = sqlx::query_as::<_, (i64, String)>(
        "SELECT version, password_hash FROM local_password_credentials WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(state.pool())
    .await?
    .ok_or(PasswordError::InvalidCredentials)?;
    if !verify_password(current, Some(hash)).await? {
        return Err(PasswordError::InvalidCredentials);
    }
    let hash = hash_new_password(proposed).await?;
    let mut tx = state.pool().begin().await?;
    lock_credential(&mut tx, user_id, Some(version)).await?;
    sqlx::query("DELETE FROM local_password_resets WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    replace_password(&mut tx, user_id, &hash).await?;
    tx.commit().await?;
    tracing::info!(target: "audit", %user_id, "local password changed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_normalization_is_consistent() {
        assert_eq!(
            normalize_email("  Teammate+Work@Example.COM ").unwrap(),
            "teammate+work@example.com"
        );
        for email in [
            "@example.com",
            "user@",
            "user@host@example.com",
            "user name@example.com",
        ] {
            assert!(normalize_email(email).is_err());
        }
    }

    #[tokio::test]
    async fn password_hashes_are_salted_and_verify() {
        let password = "a test password with spaces";
        let stored = hash(password).unwrap();
        assert_ne!(stored, hash(password).unwrap());
        assert!(stored.starts_with("$argon2id$"));
        assert!(
            verify_password(password.to_owned(), Some(stored.clone()))
                .await
                .unwrap()
        );
        assert!(
            !verify_password("different password".to_owned(), Some(stored))
                .await
                .unwrap()
        );
        assert!(hash_new_password("too short".to_owned()).await.is_err());
    }
}
