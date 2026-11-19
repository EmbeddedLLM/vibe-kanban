import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { CopyableField } from '@/shared/components/CopyableField';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useOrganizationProjects } from '@/shared/hooks/useOrganizationProjects';
import { useUserOrganizations } from '@/shared/hooks/useUserOrganizations';
import { mcpCredentialsApi, type McpCredential } from '@/shared/lib/api';
import { getRemoteApiUrl } from '@/shared/lib/remoteApi';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { SettingsCard } from './shared/SettingsComponents';

export function McpAccessSettingsSection() {
  const { t } = useTranslation('settings');
  const { isLoaded, isSignedIn, userId } = useAuth();

  if (!isLoaded)
    return <p className="text-low">{t('common:states.loading')}</p>;

  if (!isSignedIn || !userId) {
    return <p className="text-low">{t('settings.mcpAccess.signIn')}</p>;
  }

  return <MemberMcpAccess key={userId} userId={userId} />;
}

function MemberMcpAccess({ userId }: { userId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const organizationField = useId();
  const projectField = useId();
  const nameField = useId();
  const [organizationChoice, setOrganizationChoice] = useState('');
  const [projectChoice, setProjectChoice] = useState('');
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<
    (Pick<McpCredential, 'id' | 'name'> & { token: string }) | null
  >(null);
  const activeOrganizationId = useOrganizationStore((s) => s.selectedOrgId);
  const organizations = useUserOrganizations();
  const organizationList = organizations.data?.organizations ?? [];
  const organization =
    organizationList.find(
      (item) => item.id === (organizationChoice || activeOrganizationId)
    ) ??
    organizationList.find((item) => !item.is_personal) ??
    organizationList[0];
  const projects = useOrganizationProjects(organization?.id ?? null);
  const project = projects.data?.find((item) => item.id === projectChoice);
  const credentialsKey = ['mcp-credentials', userId] as const;
  const credentials = useQuery({
    queryKey: credentialsKey,
    queryFn: ({ signal }) => mcpCredentialsApi.list(signal),
  });
  const create = useMutation({
    mutationFn: async (data: { name: string; project_id: string }) => {
      const { id, name, token } = await mcpCredentialsApi.create(data);
      setIssued({ id, name, token });
    },
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
    },
  });
  const revoke = useMutation({
    mutationFn: mcpCredentialsApi.revoke,
    onSuccess: (_, id) => {
      setIssued((current) => (current?.id === id ? null : current));
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
    },
  });

  const mcpUrl = new URL('/mcp', getRemoteApiUrl() || window.location.origin)
    .href;
  const codexCommand = `codex mcp add vibe_kanban --url "${mcpUrl}" --bearer-token-env-var VIBE_KANBAN_MCP_TOKEN`;

  function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !name.trim() || create.isPending) return;
    create.mutate({ name: name.trim(), project_id: project.id });
  }

  async function revokeKey(credential: McpCredential) {
    const result = await ConfirmDialog.show({
      title: t('settings.mcpAccess.revoke'),
      message: t('settings.mcpAccess.confirmRevoke', { name: credential.name }),
      confirmText: t('settings.mcpAccess.revoke'),
      variant: 'destructive',
    });
    if (result === 'confirmed') revoke.mutate(credential.id);
  }

  return (
    <>
      <SettingsCard
        title={t('settings.mcpAccess.create')}
        description={t('settings.mcpAccess.description')}
      >
        <form className="space-y-4" onSubmit={createKey}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={organizationField}>
                {t('settings.mcpAccess.organization')}
              </Label>
              <Select
                value={organization?.id ?? ''}
                onValueChange={(value) => {
                  setOrganizationChoice(value);
                  setProjectChoice('');
                }}
                disabled={create.isPending || organizationList.length === 0}
              >
                <SelectTrigger id={organizationField}>
                  <SelectValue
                    placeholder={t('settings.mcpAccess.selectOrganization')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {organizationList.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={projectField}>
                {t('settings.mcpAccess.project')}
              </Label>
              <Select
                value={project?.id ?? ''}
                onValueChange={setProjectChoice}
                disabled={create.isPending || !projects.data?.length}
              >
                <SelectTrigger id={projectField}>
                  <SelectValue
                    placeholder={t('settings.mcpAccess.selectProject')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {projects.data?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {organizations.isLoading || projects.isLoading ? (
            <p role="status" className="text-sm text-low">
              {t('common:states.loading')}
            </p>
          ) : organizations.isError || projects.isError ? (
            <p role="alert" className="text-sm text-error">
              {t('settings.mcpAccess.projectError')}
            </p>
          ) : !projects.data?.length ? (
            <p className="text-sm text-low">
              {t('settings.mcpAccess.noProjects')}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor={nameField}>
              {t('settings.mcpAccess.harnessName')}
            </Label>
            <Input
              id={nameField}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.mcpAccess.harnessPlaceholder')}
              maxLength={80}
              disabled={create.isPending}
              required
            />
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-error">
              {create.error.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={!project || !name.trim() || create.isPending}
          >
            {t(
              create.isPending
                ? 'settings.mcpAccess.creating'
                : 'settings.mcpAccess.create'
            )}
          </Button>
        </form>
        {issued && (
          <div className="space-y-3 rounded-sm border border-border bg-secondary p-3">
            <p className="text-sm font-medium text-high">
              {t('settings.mcpAccess.created', { name: issued.name })}
            </p>
            <p className="text-sm text-low">
              {t('settings.mcpAccess.saveKey')}
            </p>
            <CopyableField
              key={issued.id}
              label={t('settings.mcpAccess.key')}
              value={issued.token}
              copyLabel={t('settings.mcpAccess.copyKey')}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setIssued(null)}
            >
              {t('common:buttons.close')}
            </Button>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('settings.mcpAccess.connect')}
        description={t('settings.mcpAccess.connectDescription')}
      >
        <CopyableField
          label={t('settings.mcpAccess.url')}
          value={mcpUrl}
          copyLabel={t('settings.mcpAccess.copyUrl')}
        />
        <CopyableField
          label={t('settings.mcpAccess.codexCommand')}
          value={codexCommand}
          copyLabel={t('settings.mcpAccess.copyCommand')}
        />
      </SettingsCard>

      <SettingsCard title={t('settings.mcpAccess.yourKeys')}>
        {credentials.isLoading ? (
          <p role="status" className="text-sm text-low">
            {t('common:states.loading')}
          </p>
        ) : credentials.isError ? (
          <p role="alert" className="text-sm text-error">
            {credentials.error.message}
          </p>
        ) : credentials.data?.length ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {credentials.data.map((credential) => (
              <li
                key={credential.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-high">
                    {credential.name}
                  </p>
                  <p className="break-words text-xs text-low">
                    {credential.project_name ?? credential.project_id}
                  </p>
                  <p className="text-xs text-low">
                    {t('settings.mcpAccess.expires', {
                      date: new Date(
                        credential.expires_at
                      ).toLocaleDateString(),
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => void revokeKey(credential)}
                >
                  {t('settings.mcpAccess.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-low">{t('settings.mcpAccess.noKeys')}</p>
        )}
        {revoke.isError && (
          <p role="alert" className="text-sm text-error">
            {revoke.error.message}
          </p>
        )}
      </SettingsCard>
    </>
  );
}
