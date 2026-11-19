import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { OrganizationWithRole } from "shared/types";
import { AppBarUserPopover } from "@vibe/ui/components/AppBarUserPopover";
import { getAuthMethods, logout } from "@remote/shared/lib/api";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { SettingsDialog } from "@/shared/dialogs/settings/SettingsDialog";
import { useAuth } from "@/shared/hooks/auth/useAuth";
import { useUserSystem } from "@/shared/hooks/useUserSystem";

interface RemoteAppBarUserPopoverContainerProps {
  organizations: OrganizationWithRole[];
  selectedOrgId: string;
  onOrgSelect: (orgId: string) => void;
}

function toNextPath({
  pathname,
  searchStr,
  hash,
}: Pick<ReturnType<typeof useLocation>, "pathname" | "searchStr" | "hash">) {
  return `${pathname}${searchStr}${hash}`;
}

export function RemoteAppBarUserPopoverContainer({
  organizations,
  selectedOrgId,
  onOrgSelect,
}: RemoteAppBarUserPopoverContainerProps) {
  const { isSignedIn } = useAuth();
  const { loginStatus } = useUserSystem();

  // Extract avatar URL from first provider (matches local-web behavior)
  const avatarUrl =
    loginStatus?.status === "loggedin"
      ? (loginStatus.profile?.providers[0]?.avatar_url ?? null)
      : null;
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const { data: authMethods } = useQuery({
    queryKey: ["remote-auth-methods"],
    queryFn: getAuthMethods,
    enabled: isSignedIn,
    staleTime: 60_000,
  });

  const handleSignIn = useCallback(() => {
    const next = toNextPath(location);

    navigate({
      to: "/account",
      search: next !== "/" ? { next } : undefined,
    });
  }, [location, navigate]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Failed to log out in remote web:", error);
    }

    navigate({
      to: "/account",
      replace: true,
    });
  }, [navigate]);

  const handleOrgSettings = useCallback(
    async (orgId: string) => {
      onOrgSelect(orgId);
      await SettingsDialog.show({
        initialSection: "organizations",
        initialState: { organizationId: orgId },
      });
    },
    [onOrgSelect],
  );

  const handleSettings = useCallback(async () => {
    setOpen(false);
    await SettingsDialog.show();
  }, []);

  return (
    <>
      <AppBarUserPopover
        isSignedIn={isSignedIn}
        avatarUrl={avatarUrl}
        avatarError={avatarError}
        organizations={organizations}
        selectedOrgId={selectedOrgId}
        open={open}
        onOpenChange={setOpen}
        onOrgSelect={onOrgSelect}
        onOrgSettings={(orgId) => {
          void handleOrgSettings(orgId);
        }}
        onSignIn={handleSignIn}
        onLogout={() => {
          void handleLogout();
        }}
        onAvatarError={() => setAvatarError(true)}
        onSettings={() => {
          void handleSettings();
        }}
        onChangePassword={
          authMethods?.password_accounts
            ? () => {
                setOpen(false);
                setPasswordDialogOpen(true);
              }
            : undefined
        }
      />
      {passwordDialogOpen && (
        <ChangePasswordDialog onClose={() => setPasswordDialogOpen(false)} />
      )}
    </>
  );
}
