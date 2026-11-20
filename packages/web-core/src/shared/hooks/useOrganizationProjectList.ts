import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { listOrganizationProjects } from '@/shared/lib/remoteApi';

export function useOrganizationProjectList(
  organizationId: string | null,
  refreshOnMount = false
) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['organization-projects-rest', userId, organizationId],
    queryFn: async ({ signal }) => {
      if (!organizationId) return [];
      const projects = await listOrganizationProjects(organizationId, signal);
      return [...projects].sort((a, b) => a.sort_order - b.sort_order);
    },
    enabled: Boolean(userId && organizationId),
    staleTime: 30_000,
    refetchOnMount: refreshOnMount ? 'always' : true,
  });
}
