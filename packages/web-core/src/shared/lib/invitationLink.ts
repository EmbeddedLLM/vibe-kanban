import { InvitationStatus } from 'shared/types';
import type { ShareableInvitation } from './api';

export function getPendingInvitationLink(
  invitation: Pick<ShareableInvitation, 'status' | 'expires_at' | 'accept_url'>,
  now = Date.now()
): string | undefined {
  if (
    invitation.status === InvitationStatus.PENDING &&
    Date.parse(invitation.expires_at) > now
  ) {
    return invitation.accept_url;
  }
  return undefined;
}
