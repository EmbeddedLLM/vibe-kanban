import { Badge } from '@vibe/ui/components/Badge';
import { Button } from '@vibe/ui/components/Button';
import type { ShareableInvitation } from '@/shared/lib/api';
import { CopyableField } from '@/shared/components/CopyableField';
import { getPendingInvitationLink } from '@/shared/lib/invitationLink';
import { MemberRole } from 'shared/types';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

interface PendingInvitationItemProps {
  invitation: ShareableInvitation;
  onRevoke?: (invitationId: string) => void;
  isRevoking?: boolean;
  onReplace?: (invitationId: string) => void;
  isReplacing?: boolean;
}

export function PendingInvitationItem({
  invitation,
  onRevoke,
  isRevoking,
  onReplace,
  isReplacing,
}: PendingInvitationItemProps) {
  const { t } = useTranslation('organization');
  const expiresAt = new Date(invitation.expires_at);
  const now = Date.now();
  const expired = expiresAt.getTime() <= now;
  const inviteLink = getPendingInvitationLink(invitation, now);

  const handleRevoke = () => {
    const confirmed = window.confirm(
      `Are you sure you want to revoke the invitation for ${invitation.email}? This action cannot be undone.`
    );
    if (confirmed) {
      onRevoke?.(invitation.id);
    }
  };

  return (
    <div className="space-y-3 p-3 border rounded-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="font-medium text-sm break-all">
              {invitation.email}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('invitationList.invited', {
                date: new Date(invitation.created_at).toLocaleDateString(),
              })}
              {' · '}
              {t('invitationList.expires', {
                date: expiresAt.toLocaleDateString(),
              })}
            </div>
          </div>
          <Badge
            variant={
              invitation.role === MemberRole.ADMIN ? 'default' : 'secondary'
            }
          >
            {t('roles.' + invitation.role.toLowerCase())}
          </Badge>
          <Badge variant="outline">
            {t(expired ? 'invitationList.expired' : 'invitationList.pending')}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRevoke}
          disabled={isRevoking}
          aria-label={t('invitationList.revoke')}
          title={t('invitationList.revoke')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {inviteLink && (
        <CopyableField
          label={t('invitationList.link')}
          value={inviteLink}
          copyLabel={t('invitationList.copyLink')}
        />
      )}
      {invitation.password_enrollment && onReplace && (
        <Button
          variant="outline"
          size="sm"
          disabled={isReplacing || isRevoking}
          onClick={() => {
            if (window.confirm(t('invitationList.confirmReplace'))) {
              onReplace(invitation.id);
            }
          }}
        >
          {t('invitationList.replaceLink')}
        </Button>
      )}
    </div>
  );
}
