import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@vibe/ui/components/Button";
import { Input } from "@vibe/ui/components/Input";
import { Label } from "@vibe/ui/components/Label";
import {
  acceptPasswordInvitation,
  previewPasswordInvitation,
  resetLocalPassword,
  type PasswordInvitation,
} from "@remote/shared/lib/api";
import { clearTokens, storeTokens } from "@remote/shared/lib/auth";
import { useOrganizationStore } from "@/shared/stores/useOrganizationStore";

export default function PasswordAccountLinkPage({
  kind,
}: {
  kind: "invite" | "reset";
}) {
  const isInvite = kind === "invite";
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    token: string;
    details?: PasswordInvitation;
    error?: string;
  }>();

  useEffect(() => {
    const removeFragment = () => {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    };
    const updateToken = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;
      setToken(fragment);
      setError("");
      setDisplayName("");
      setPassword("");
      setConfirmation("");
      removeFragment();
    };
    if (window.location.hash.slice(1) === token && token) {
      removeFragment();
    }
    window.addEventListener("hashchange", updateToken);
    return () => window.removeEventListener("hashchange", updateToken);
  }, [token]);

  useEffect(() => {
    if (!isInvite || !token) return;
    let current = true;
    previewPasswordInvitation(token).then(
      (details) => {
        if (current) setPreview({ token, details });
      },
      (cause: Error) => {
        if (current) setPreview({ token, error: cause.message });
      },
    );
    return () => {
      current = false;
    };
  }, [isInvite, token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (isInvite) {
        const session = await acceptPasswordInvitation(
          token,
          displayName,
          password,
        );
        await storeTokens(session.access_token, session.refresh_token);
        useOrganizationStore
          .getState()
          .setSelectedOrgId(session.organization_id);
        window.location.replace(
          session.project_id ? `/projects/${session.project_id}` : "/",
        );
      } else {
        await resetLocalPassword(token, password);
        await clearTokens();
        window.location.replace("/account");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete the request.",
      );
      setSubmitting(false);
    }
  };

  const activePreview = preview?.token === token ? preview : undefined;
  const invalidLink = !token || Boolean(activePreview?.error);
  const details = activePreview?.details;

  return (
    <main className="h-screen overflow-auto bg-primary">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-base py-double">
        <div className="space-y-base rounded-sm border border-border bg-secondary p-double">
          <h1 className="text-2xl font-semibold text-high">
            {isInvite ? "Accept your invitation" : "Reset your password"}
          </h1>
          {invalidLink ? (
            <p role="alert" className="text-sm text-error">
              {activePreview?.error ||
                (isInvite
                  ? "Open the full invitation link or ask an admin for a new one."
                  : "Open the full reset link or ask the server operator for a new one.")}
            </p>
          ) : isInvite && !details ? (
            <p role="status" className="text-sm text-low">
              Loading invitation…
            </p>
          ) : (
            <form
              onSubmit={(event) => void submit(event)}
              className="space-y-base"
            >
              {details && (
                <>
                  <p className="text-sm text-low">
                    Join{" "}
                    <strong className="text-high">
                      {details.organization_name}
                    </strong>{" "}
                    as {details.role === "ADMIN" ? "an admin" : "a member"}.
                  </p>
                  <div className="space-y-half">
                    <Label htmlFor="invited-email">Email</Label>
                    <Input
                      id="invited-email"
                      type="email"
                      autoComplete="username"
                      value={details.email}
                      readOnly
                    />
                  </div>
                  <div className="space-y-half">
                    <Label htmlFor="invite-name">Display name</Label>
                    <Input
                      id="invite-name"
                      autoComplete="name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={100}
                      required
                    />
                  </div>
                </>
              )}
              <div className="space-y-half">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={15}
                  maxLength={1024}
                  aria-describedby="password-hint"
                  required
                />
                <p id="password-hint" className="text-xs text-low">
                  Use at least 15 characters.
                </p>
              </div>
              <div className="space-y-half">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  maxLength={1024}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-error">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? "Saving…"
                  : isInvite
                    ? "Create account and join"
                    : "Save new password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
