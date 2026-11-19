import { useQuery } from '@tanstack/react-query';
import { organizationsApi, type ShareableInvitation } from '@/shared/lib/api';
import { InvitationStatus } from 'shared/types';
import { organizationKeys } from '@/shared/hooks/organizationKeys';
import { useAuth } from '@/shared/hooks/auth/useAuth';

interface UseOrganizationInvitationsOptions {
  organizationId: string | null;
  isAdmin: boolean;
  isPersonal: boolean;
}

export function useOrganizationInvitations(
  options: UseOrganizationInvitationsOptions
) {
  const { organizationId, isAdmin, isPersonal } = options;
  const { userId } = useAuth();

  return useQuery<ShareableInvitation[]>({
    queryKey: [...organizationKeys.invitations(organizationId ?? ''), userId],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('No organization ID provided');
      }
      const invitations =
        await organizationsApi.listInvitations(organizationId);
      // Only return pending invitations
      return invitations.filter(
        (inv) => inv.status === InvitationStatus.PENDING
      );
    },
    enabled: !!userId && !!organizationId && isAdmin && !isPersonal,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
