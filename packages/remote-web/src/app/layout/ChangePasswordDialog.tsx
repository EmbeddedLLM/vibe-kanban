import { useState, type FormEvent } from "react";
import { Button } from "@vibe/ui/components/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@vibe/ui/components/Dialog";
import { Input } from "@vibe/ui/components/Input";
import { Label } from "@vibe/ui/components/Label";
import { changeLocalPassword } from "@remote/shared/lib/api";
import { clearTokens } from "@remote/shared/lib/auth";

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const current = String(data.get("current"));
    const next = String(data.get("next"));
    if (next !== data.get("confirmation")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await changeLocalPassword(current, next);
      await clearTokens();
      window.location.replace("/account");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change password.",
      );
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="space-y-base p-double"
        hideCloseButton={pending}
      >
        <DialogTitle>Change password</DialogTitle>
        <DialogDescription>
          You’ll need to sign in again on all devices.
        </DialogDescription>
        <form className="space-y-base" onSubmit={(event) => void submit(event)}>
          <div className="space-y-half">
            <Label htmlFor="change-password-current">Current password</Label>
            <Input
              id="change-password-current"
              name="current"
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              required
            />
          </div>
          <div className="space-y-half">
            <Label htmlFor="change-password-next">New password</Label>
            <Input
              id="change-password-next"
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={1024}
              aria-describedby="new-password-hint"
              required
            />
            <p id="new-password-hint" className="text-xs text-low">
              Use at least 15 characters.
            </p>
          </div>
          <div className="space-y-half">
            <Label htmlFor="change-password-confirmation">
              Confirm new password
            </Label>
            <Input
              id="change-password-confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              maxLength={1024}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Change password"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
