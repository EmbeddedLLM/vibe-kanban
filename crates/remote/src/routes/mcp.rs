use std::sync::Arc;

use api_types::{
    CreateIssueAssigneeRequest, CreateIssueCommentRequest, CreateIssueRequest, Issue,
    ProjectStatus, SearchIssuesRequest, UpdateIssueRequest,
};
use axum::{
    Router,
    extract::{Request, State},
    http::{StatusCode, header, request::Parts},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use rmcp::{
    ErrorData, ServerHandler,
    handler::server::{
        tool::{Extension, ToolRouter},
        wrapper::Parameters,
    },
    model::{CallToolResult, ErrorCode, Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::never::NeverSessionManager,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::{limit::RequestBodyLimitLayer, request_id::RequestId};
use uuid::Uuid;

use super::{
    error::ErrorResponse,
    issue_assignees::create_issue_assignee_for_user,
    issue_comments::create_issue_comment_for_user,
    issues::{create_issue_for_user, update_issue_for_user},
    mcp_credentials::{self, McpPrincipal},
    organization_members::ensure_member_access,
};
use crate::{
    AppState,
    audit::{self, AuditAction, AuditEvent},
    db::{self, issues::IssueRepository, project_statuses::ProjectStatusRepository},
};

pub(super) fn router(state: &AppState) -> Router<AppState> {
    let app = state.clone();
    let service = StreamableHttpService::new(
        move || {
            Ok(BoardMcp {
                state: app.clone(),
                tool_router: BoardMcp::tool_router(),
            })
        },
        Arc::new(NeverSessionManager::default()),
        StreamableHttpServerConfig::default()
            .with_stateful_mode(false)
            .with_json_response(true),
    );

    Router::new()
        .route_service("/mcp", service)
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), authorize))
}

async fn authorize(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    let allowed_origin = url::Url::parse(&state.server_public_base_url)
        .ok()
        .map(|url| url.origin().ascii_serialization());
    if request
        .headers()
        .get_all(header::ORIGIN)
        .iter()
        .any(|origin| {
            origin
                .to_str()
                .ok()
                .zip(allowed_origin.as_deref())
                .is_none_or(|(origin, allowed)| origin != allowed)
        })
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    let principal = match mcp_credentials::authenticate(&state, request.headers()).await {
        Ok(Some(principal)) => principal,
        Ok(None) => {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, "Bearer")],
            )
                .into_response();
        }
        Err(error) => return error.into_response(),
    };
    request.headers_mut().remove(header::AUTHORIZATION);
    request.extensions_mut().insert(principal);
    next.run(request).await
}

struct BoardMcp {
    state: AppState,
    tool_router: ToolRouter<Self>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ListIssues {
    #[schemars(description = "Optional title, description, or issue identifier to search for")]
    search: Option<String>,
    status_id: Option<Uuid>,
    limit: Option<i32>,
    offset: Option<i32>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct CreateIssue {
    title: String,
    description: Option<String>,
    status_id: Uuid,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct MoveIssue {
    issue_id: Uuid,
    status_id: Uuid,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct AssignIssue {
    issue_id: Uuid,
    #[schemars(
        description = "Organization member's user ID. Leave empty to assign to the authenticated member."
    )]
    assignee_user_id: Option<Uuid>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct AddComment {
    issue_id: Uuid,
    message: String,
}

#[tool_router]
impl BoardMcp {
    #[tool(
        description = "Return the authenticated team member ID and the project this credential can access"
    )]
    async fn get_identity(&self, Extension(parts): Extension<Parts>) -> ToolResult {
        let member = principal(&parts)?;
        result(json!({"user_id": member.user_id, "project_id": member.project_id}))
    }

    #[tool(description = "List the Kanban columns for the authenticated project")]
    async fn list_statuses(&self, Extension(parts): Extension<Parts>) -> ToolResult {
        let member = principal(&parts)?;
        let statuses =
            ProjectStatusRepository::list_by_project(self.state.pool(), member.project_id)
                .await
                .map_err(internal_error)?;
        result(json!({"statuses": statuses}))
    }

    #[tool(description = "List or search issues in the authenticated project")]
    async fn list_issues(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<ListIssues>,
    ) -> ToolResult {
        let member = principal(&parts)?;
        let request = SearchIssuesRequest {
            project_id: member.project_id,
            status_id: args.status_id,
            status_ids: None,
            priority: None,
            parent_issue_id: None,
            search: args.search,
            simple_id: None,
            assignee_user_id: None,
            tag_id: None,
            tag_ids: None,
            sort_field: None,
            sort_direction: None,
            limit: Some(args.limit.unwrap_or(25).clamp(1, 100)),
            offset: Some(args.offset.unwrap_or(0).max(0)),
        };
        let issues = IssueRepository::search(self.state.pool(), &request)
            .await
            .map_err(internal_error)?;
        result(issues)
    }

    #[tool(description = "Create an issue in the authenticated project")]
    async fn create_issue(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<CreateIssue>,
    ) -> ToolResult {
        let member = principal(&parts)?;
        let status = self.status(member, args.status_id).await?;
        let title = args.title.trim();
        if title.is_empty() || title.chars().count() > 255 {
            return Err(ErrorData::invalid_params(
                "title must contain 1–255 characters",
                None,
            ));
        }
        let payload = CreateIssueRequest {
            id: None,
            project_id: member.project_id,
            status_id: status.id,
            title: title.to_owned(),
            description: args.description,
            priority: None,
            start_date: None,
            target_date: None,
            completed_at: None,
            sort_order: 0.0,
            parent_issue_id: None,
            parent_issue_sort_order: None,
            extension_metadata: json!({}),
        };
        let issue = db::TX_CONTEXT
            .scope(
                Some(tx_context(&parts, member)),
                create_issue_for_user(&self.state, member.user_id, payload),
            )
            .await
            .map_err(tool_error)?
            .data;
        log_change(
            member,
            AuditAction::McpIssueCreated,
            issue.id,
            format!("status_id={}", status.id),
        );
        result(issue)
    }

    #[tool(description = "Move an issue to a different column in the authenticated project")]
    async fn move_issue(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<MoveIssue>,
    ) -> ToolResult {
        let member = principal(&parts)?;
        let issue = self.issue(member, args.issue_id).await?;
        let status = self.status(member, args.status_id).await?;
        let payload = UpdateIssueRequest {
            status_id: Some(status.id),
            ..Default::default()
        };
        let updated = db::TX_CONTEXT
            .scope(
                Some(tx_context(&parts, member)),
                update_issue_for_user(&self.state, member.user_id, issue.id, payload),
            )
            .await
            .map_err(tool_error)?
            .data;
        log_change(
            member,
            AuditAction::McpIssueMoved,
            issue.id,
            format!("status_id={}", updated.status_id),
        );
        result(updated)
    }

    #[tool(description = "Add an organization member as an issue assignee")]
    async fn assign_issue(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<AssignIssue>,
    ) -> ToolResult {
        let member = principal(&parts)?;
        let issue = self.issue(member, args.issue_id).await?;
        let assignee = args.assignee_user_id.unwrap_or(member.user_id);
        ensure_member_access(self.state.pool(), member.organization_id, assignee)
            .await
            .map_err(tool_error)?;
        let payload = CreateIssueAssigneeRequest {
            id: None,
            issue_id: issue.id,
            user_id: assignee,
        };
        let assignment = db::TX_CONTEXT
            .scope(
                Some(tx_context(&parts, member)),
                create_issue_assignee_for_user(&self.state, member.user_id, payload),
            )
            .await
            .map_err(tool_error)?
            .data;
        log_change(
            member,
            AuditAction::McpIssueAssigned,
            issue.id,
            format!("assignee_user_id={assignee}"),
        );
        result(assignment)
    }

    #[tool(description = "Post a handoff comment as the authenticated member")]
    async fn add_comment(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<AddComment>,
    ) -> ToolResult {
        let member = principal(&parts)?;
        let issue = self.issue(member, args.issue_id).await?;
        if args.message.trim().is_empty() {
            return Err(ErrorData::invalid_params("message is required", None));
        }
        let payload = CreateIssueCommentRequest {
            id: None,
            issue_id: issue.id,
            parent_id: None,
            message: args.message,
        };
        let comment = db::TX_CONTEXT
            .scope(
                Some(tx_context(&parts, member)),
                create_issue_comment_for_user(&self.state, member.user_id, payload),
            )
            .await
            .map_err(tool_error)?
            .data;
        log_change(
            member,
            AuditAction::McpCommentAdded,
            issue.id,
            format!("comment_id={}", comment.id),
        );
        result(comment)
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for BoardMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("vibe-kanban-board", env!("CARGO_PKG_VERSION")))
            .with_instructions("Coordinate Kanban issues in the project scoped to your credential. Use list_statuses and list_issues to find IDs.")
    }
}

impl BoardMcp {
    async fn issue(&self, member: &McpPrincipal, id: Uuid) -> Result<Issue, ErrorData> {
        IssueRepository::find_by_id(self.state.pool(), id)
            .await
            .map_err(internal_error)?
            .filter(|issue| issue.project_id == member.project_id)
            .ok_or_else(|| ErrorData::invalid_params("issue not found in this project", None))
    }

    async fn status(&self, member: &McpPrincipal, id: Uuid) -> Result<ProjectStatus, ErrorData> {
        ProjectStatusRepository::find_by_id(self.state.pool(), id)
            .await
            .map_err(internal_error)?
            .filter(|status| status.project_id == member.project_id)
            .ok_or_else(|| ErrorData::invalid_params("status not found in this project", None))
    }
}

type ToolResult = Result<CallToolResult, ErrorData>;

fn principal(parts: &Parts) -> Result<&McpPrincipal, ErrorData> {
    parts
        .extensions
        .get::<McpPrincipal>()
        .ok_or_else(|| ErrorData::internal_error("missing MCP authentication context", None))
}

fn tx_context(parts: &Parts, member: &McpPrincipal) -> db::TxContext {
    let request_id = parts
        .extensions
        .get::<RequestId>()
        .and_then(|id| id.header_value().to_str().ok())
        .unwrap_or_default()
        .to_owned();
    db::TxContext {
        user_id: member.user_id,
        request_id,
    }
}

fn result(value: impl Serialize) -> ToolResult {
    serde_json::to_value(value)
        .map(CallToolResult::structured)
        .map_err(internal_error)
}

fn internal_error(error: impl std::fmt::Debug) -> ErrorData {
    tracing::error!(?error, "MCP board operation failed");
    ErrorData::internal_error("board operation failed", None)
}

fn tool_error(error: ErrorResponse) -> ErrorData {
    let (status, message) = error.into_parts();
    if status.is_server_error() {
        return internal_error(message);
    }
    ErrorData::new(
        ErrorCode(-32000),
        message,
        Some(json!({"status": status.as_u16()})),
    )
}

fn log_change(member: &McpPrincipal, action: AuditAction, issue_id: Uuid, details: String) {
    audit::emit(
        AuditEvent::system(action)
            .user(member.user_id, None)
            .mcp_credential(member.id, member.name.clone())
            .organization(member.organization_id)
            .resource("issue", Some(issue_id))
            .http("POST", "/mcp", 200)
            .description(details),
    );
}
