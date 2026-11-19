import { describe, expect, it } from 'vitest';
import { InvitationStatus } from 'shared/types';
import { getPendingInvitationLink } from './invitationLink';

const invitation = {
  status: InvitationStatus.PENDING,
  expires_at: '2026-12-01T00:00:00Z',
  accept_url: 'https://kanban.example.com/invitations/example/accept',
};
const beforeExpiry = Date.parse('2026-11-30T00:00:00Z');

describe('getPendingInvitationLink', () => {
  it('uses the server link for a pending invitation', () => {
    expect(getPendingInvitationLink(invitation, beforeExpiry)).toBe(
      invitation.accept_url
    );
  });

  it('hides a link at expiry even when the server still marks it pending', () => {
    expect(
      getPendingInvitationLink(invitation, Date.parse(invitation.expires_at))
    ).toBeUndefined();
  });

  it.each([
    InvitationStatus.ACCEPTED,
    InvitationStatus.DECLINED,
    InvitationStatus.EXPIRED,
  ])('hides links for %s invitations', (status) => {
    expect(
      getPendingInvitationLink({ ...invitation, status }, beforeExpiry)
    ).toBeUndefined();
  });
});
