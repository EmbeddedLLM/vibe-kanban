import { getToken, triggerRefresh } from "@remote/shared/lib/auth/tokenManager";
import { takeTokens } from "@remote/shared/lib/auth";
import type { ListOrganizationsResponse } from "shared/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export type OAuthProvider = "github" | "google";

export type AuthMethodsResponse = {
  local_auth_enabled: boolean;
  oauth_providers: string[];
  password_accounts?: boolean;
};

type HandoffInitResponse = {
  handoff_id: string;
  authorize_url: string;
};

type HandoffRedeemResponse = {
  access_token: string;
  refresh_token: string;
};

type LocalLoginResponse = {
  access_token: string;
  refresh_token: string;
};

export type InvitationLookupResponse = {
  id: string;
  organization_slug: string;
  organization_name?: string;
  role: string;
  expires_at: string;
};

type AcceptInvitationResponse = {
  organization_id: string;
  organization_slug: string;
  role: string;
};

type IdentityResponse = {
  user_id: string;
  username: string | null;
  email: string;
};

export async function initOAuth(
  provider: OAuthProvider,
  returnTo: string,
  appChallenge: string,
): Promise<HandoffInitResponse> {
  const res = await fetch(`${API_BASE}/v1/oauth/web/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      return_to: returnTo,
      app_challenge: appChallenge,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth init failed (${res.status})`);
  }
  return res.json();
}

export async function getAuthMethods(): Promise<AuthMethodsResponse> {
  const res = await fetch(`${API_BASE}/v1/auth/methods`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Auth methods lookup failed (${res.status})`);
  }
  return res.json();
}

export async function redeemOAuth(
  handoffId: string,
  appCode: string,
  appVerifier: string,
): Promise<HandoffRedeemResponse> {
  const res = await fetch(`${API_BASE}/v1/oauth/web/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handoff_id: handoffId,
      app_code: appCode,
      app_verifier: appVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth redeem failed (${res.status})`);
  }
  return res.json();
}

export async function localLogin(
  email: string,
  password: string,
): Promise<LocalLoginResponse> {
  return localAccountRequest("login", { email, password });
}

export type PasswordInvitation = {
  organization_name: string;
  email: string;
  role: string;
  expires_at: string;
};

async function localAccountRequest<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}/v1/auth/local/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const details = await res.json().catch(() => null);
    throw new Error(details?.error || `Account request failed (${res.status})`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export function previewPasswordInvitation(
  token: string,
): Promise<PasswordInvitation> {
  return localAccountRequest("invitations/preview", { token });
}

export function acceptPasswordInvitation(
  token: string,
  displayName: string,
  password: string,
) {
  return localAccountRequest<
    LocalLoginResponse & {
      organization_id: string;
      project_id: string | null;
    }
  >("invitations/accept", { token, display_name: displayName, password });
}

export function resetLocalPassword(
  token: string,
  password: string,
): Promise<void> {
  return localAccountRequest("password/reset", { token, password });
}

export async function changeLocalPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const accessToken = await getToken();
  const res = await fetch(`${API_BASE}/v1/auth/local/password/change`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    const details = await res.json().catch(() => null);
    throw new Error(details?.error || "Could not change password.");
  }
}

export async function getInvitation(
  token: string,
): Promise<InvitationLookupResponse> {
  const res = await fetch(`${API_BASE}/v1/invitations/${token}`);
  if (!res.ok) {
    throw new Error(`Invitation not found (${res.status})`);
  }
  return res.json();
}

export async function acceptInvitation(
  token: string,
  accessToken: string,
): Promise<AcceptInvitationResponse> {
  const res = await fetch(`${API_BASE}/v1/invitations/${token}/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to accept invitation (${res.status})`);
  }
  return res.json();
}

export async function refreshTokens(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${API_BASE}/v1/tokens/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const err = new Error(`Token refresh failed (${res.status})`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const accessToken = await getToken();

  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    const newAccessToken = await triggerRefresh();
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${newAccessToken}`,
      },
    });
  }

  return res;
}

export async function logout(): Promise<void> {
  const { accessToken, refreshToken } = await takeTokens();
  if (!accessToken && !refreshToken) return;

  const request = refreshToken
    ? fetch(`${API_BASE}/v1/tokens/revoke`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    : fetch(`${API_BASE}/v1/oauth/logout`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${accessToken}` },
      });

  void request
    .then((response) => {
      if (!response.ok && response.status !== 401) {
        throw new Error(`Session revocation failed (${response.status})`);
      }
    })
    .catch((error) =>
      console.error("Failed to revoke the signed-out session:", error),
    );
}

export async function listOrganizations(): Promise<ListOrganizationsResponse> {
  const res = await authenticatedFetch(`${API_BASE}/v1/organizations`);
  if (!res.ok) {
    throw new Error(`Failed to list organizations (${res.status})`);
  }
  return res.json();
}

export async function getIdentity(): Promise<IdentityResponse> {
  const res = await authenticatedFetch(`${API_BASE}/v1/identity`);
  if (!res.ok) {
    throw new Error(`Failed to fetch identity (${res.status})`);
  }
  return res.json();
}

export { listOrganizationProjects } from "@/shared/lib/remoteApi";
