import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
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
import { useOrganizationProjectList } from '@/shared/hooks/useOrganizationProjectList';
import { useUserOrganizations } from '@/shared/hooks/useUserOrganizations';
import {
  mcpCredentialsApi,
  type McpCredential,
  type McpCredentialExpiration,
} from '@/shared/lib/api';
import {
  MCP_SETUP_KEY_PLACEHOLDER,
  mcpSetupExample,
  mcpSetupWithKey,
  type McpClient,
} from '@/shared/lib/mcpSetup';
import { getRemoteApiUrl } from '@/shared/lib/remoteApi';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { SettingsCard } from './shared/SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';

const expirationOptions = [
  ['seven_days', 'settings.mcpAccess.sevenDays'],
  ['thirty_days', 'settings.mcpAccess.thirtyDays'],
  ['ninety_days', 'settings.mcpAccess.ninetyDays'],
  ['one_year', 'settings.mcpAccess.oneYear'],
  ['never', 'settings.mcpAccess.never'],
] as const;

const agentClients = [
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['pi', 'Pi'],
] as const;

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
  const { setDirty } = useSettingsDirty();
  const mounted = useRef(false);
  const organizationField = useId();
  const projectField = useId();
  const nameField = useId();
  const expirationField = useId();
  const [client, setClient] = useState<McpClient>('codex');
  const [organizationChoice, setOrganizationChoice] = useState('');
  const [projectChoice, setProjectChoice] = useState('');
  const [name, setName] = useState('');
  const [expiration, setExpiration] =
    useState<McpCredentialExpiration>('thirty_days');
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
  const projects = useOrganizationProjectList(organization?.id ?? null, true);
  const project =
    projects.data?.find((item) => item.id === projectChoice) ??
    (projects.data?.length === 1 ? projects.data[0] : undefined);
  const credentialsKey = ['mcp-credentials', userId] as const;
  const credentials = useQuery({
    queryKey: credentialsKey,
    queryFn: ({ signal }) => mcpCredentialsApi.list(signal),
    staleTime: 30_000,
  });

  async function updateCredentials(
    update: (current: McpCredential[]) => McpCredential[]
  ) {
    // Discard reads started before the server confirmed the mutation.
    await queryClient.cancelQueries({ queryKey: credentialsKey });
    queryClient.setQueryData<McpCredential[]>(credentialsKey, (current) =>
      update(current ?? [])
    );
    void queryClient.invalidateQueries({ queryKey: credentialsKey });
  }

  const create = useMutation({
    mutationFn: async (
      data: Parameters<typeof mcpCredentialsApi.create>[0]
    ) => {
      const { token, ...credential } = await mcpCredentialsApi.create(data);
      if (mounted.current) {
        setDirty('mcp-key-issued', true);
        setIssued({ id: credential.id, name: credential.name, token });
      }
      return credential;
    },
    onSuccess: (credential) => {
      setName('');
      return updateCredentials((current) => [
        credential,
        ...current.filter((item) => item.id !== credential.id),
      ]);
    },
    onSettled: () => {
      if (mounted.current) setDirty('mcp-key-creating', false);
    },
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setDirty('mcp-key-creating', false);
      setDirty('mcp-key-issued', false);
    };
  }, [setDirty]);

  useEffect(() => {
    setDirty('mcp-key-issued', Boolean(issued));
  }, [issued, setDirty]);

  const mcpUrl = new URL('/mcp', getRemoteApiUrl() || window.location.origin)
    .href;

  function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !name.trim() || create.isPending || issued) return;
    setDirty('mcp-key-creating', true);
    create.mutate({ name: name.trim(), project_id: project.id, expiration });
  }

  function closeIssuedKey() {
    setIssued(null);
  }

  function removeRevokedKey(id: string) {
    setIssued((current) => (current?.id === id ? null : current));
    return updateCredentials((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  return (
    <>
      <SettingsCard
        title={t('settings.mcpAccess.connect')}
        description={t('settings.mcpAccess.connectDescription')}
      >
        <AgentClientPicker client={client} onSelect={setClient} />
        <p className="text-sm text-low">
          <Trans
            t={t}
            i18nKey="settings.mcpAccess.useSavedKey"
            values={{ placeholder: MCP_SETUP_KEY_PLACEHOLDER }}
            components={{ placeholder: <code /> }}
          />
        </p>
        <ClientSetupSnippet
          client={client}
          value={mcpSetupExample(client, mcpUrl)}
        />
        <p className="text-sm text-low">
          <strong className="text-high">
            {t('settings.mcpAccess.verify')}
          </strong>{' '}
          {t('settings.mcpAccess.verifyDescription')}
        </p>
        <CopyableField
          label={t('settings.mcpAccess.url')}
          value={mcpUrl}
          copyLabel={t('settings.mcpAccess.copyUrl')}
        />
      </SettingsCard>

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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={nameField}>
                {t('settings.mcpAccess.keyName')}
              </Label>
              <Input
                id={nameField}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('settings.mcpAccess.keyNamePlaceholder')}
                maxLength={80}
                disabled={create.isPending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={expirationField}>
                {t('settings.mcpAccess.expiration')}
              </Label>
              <Select
                value={expiration}
                onValueChange={(value) =>
                  setExpiration(value as McpCredentialExpiration)
                }
                disabled={create.isPending}
              >
                <SelectTrigger id={expirationField}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {expirationOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {expiration === 'never' && (
                <p className="text-xs text-low">
                  {t('settings.mcpAccess.neverHint')}
                </p>
              )}
            </div>
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-error">
              {create.error.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={!project || !name.trim() || create.isPending || !!issued}
          >
            {t(
              create.isPending
                ? 'settings.mcpAccess.creating'
                : 'settings.mcpAccess.create'
            )}
          </Button>
        </form>
        {issued && (
          <IssuedKeySetup
            key={issued.id}
            issued={issued}
            mcpUrl={mcpUrl}
            client={client}
            onSelectClient={setClient}
            onClose={closeIssuedKey}
          />
        )}
      </SettingsCard>

      <SettingsCard title={t('settings.mcpAccess.yourKeys')}>
        {credentials.isLoading ? (
          <p role="status" className="text-sm text-low">
            {t('common:states.loading')}
          </p>
        ) : credentials.isError && !credentials.data ? (
          <p role="alert" className="text-sm text-error">
            {credentials.error.message}
          </p>
        ) : credentials.data?.length ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {credentials.data.map((credential) => (
              <CredentialRow
                key={credential.id}
                credential={credential}
                onRevoked={removeRevokedKey}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-low">{t('settings.mcpAccess.noKeys')}</p>
        )}
        {credentials.isError && credentials.data && (
          <p role="alert" className="text-sm text-error">
            {credentials.error.message}
          </p>
        )}
      </SettingsCard>
    </>
  );
}

function AgentClientPicker({
  client,
  onSelect,
}: {
  client: McpClient;
  onSelect: (client: McpClient) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div
      role="group"
      aria-label={t('settings.mcpAccess.client')}
      className="flex flex-wrap gap-2"
    >
      {agentClients.map(([value, label]) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={value === client ? 'default' : 'outline'}
          aria-pressed={value === client}
          onClick={() => onSelect(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function ClientSetupSnippet({
  client,
  value,
}: {
  client: McpClient;
  value: string;
}) {
  const { t } = useTranslation('settings');
  const isCodex = client === 'codex';

  return (
    <>
      <CopyableField
        key={client}
        label={t('settings.mcpAccess.configureOnce')}
        value={value}
        copyLabel={t(
          isCodex
            ? 'settings.mcpAccess.copyConfig'
            : 'settings.mcpAccess.copyCommand'
        )}
        multiline={isCodex}
      />
      <p className="text-sm text-low">
        <strong className="text-high">{t('settings.mcpAccess.launch')}</strong>{' '}
        {isCodex ? (
          <Trans
            t={t}
            i18nKey="settings.mcpAccess.codexLaunch"
            components={{ path: <code /> }}
          />
        ) : (
          t('settings.mcpAccess.cliLaunch')
        )}
      </p>
      <p className="text-sm text-low">{t('settings.mcpAccess.keyStorage')}</p>
    </>
  );
}

function IssuedKeySetup({
  issued,
  mcpUrl,
  client,
  onSelectClient,
  onClose,
}: {
  issued: { id: string; name: string; token: string };
  mcpUrl: string;
  client: McpClient;
  onSelectClient: (client: McpClient) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const setupHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setupHeading.current?.focus();
  }, []);

  return (
    <div className="space-y-3 rounded-sm border border-border bg-secondary p-3">
      <h3
        ref={setupHeading}
        tabIndex={-1}
        className="text-sm font-medium text-high"
      >
        {t('settings.mcpAccess.created', { name: issued.name })}
      </h3>
      <p className="text-sm text-low">{t('settings.mcpAccess.saveKey')}</p>
      <AgentClientPicker client={client} onSelect={onSelectClient} />
      <ClientSetupSnippet
        client={client}
        value={mcpSetupWithKey(client, mcpUrl, issued)}
      />
      {client !== 'codex' && (
        <p className="text-sm text-low">
          {t('settings.mcpAccess.commandHint')}
        </p>
      )}
      <CopyableField
        label={t('settings.mcpAccess.key')}
        value={issued.token}
        copyLabel={t('settings.mcpAccess.copyKey')}
      />
      <Button type="button" variant="outline" onClick={onClose}>
        {t('common:buttons.close')}
      </Button>
    </div>
  );
}

function CredentialRow({
  credential,
  onRevoked,
}: {
  credential: McpCredential;
  onRevoked: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const revoke = useMutation({
    mutationFn: mcpCredentialsApi.revoke,
    onSuccess: (_, id) => onRevoked(id),
  });

  async function revokeKey() {
    const result = await ConfirmDialog.show({
      title: t('settings.mcpAccess.revoke'),
      message: t('settings.mcpAccess.confirmRevoke', { name: credential.name }),
      confirmText: t('settings.mcpAccess.revoke'),
      variant: 'destructive',
    });
    if (result === 'confirmed') revoke.mutate(credential.id);
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-high">
            {credential.name}
          </p>
          <p className="break-words text-xs text-low">
            {credential.project_name ?? credential.project_id}
          </p>
          <p className="text-xs text-low">
            {credential.expires_at
              ? t('settings.mcpAccess.expires', {
                  date: new Date(credential.expires_at).toLocaleDateString(),
                })
              : t('settings.mcpAccess.neverExpires')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={revoke.isPending}
          onClick={() => void revokeKey()}
        >
          {revoke.isPending
            ? t('settings.mcpAccess.revoking')
            : t('settings.mcpAccess.revoke')}
        </Button>
      </div>
      {revoke.isError && (
        <p role="alert" className="text-sm text-error">
          {revoke.error.message}
        </p>
      )}
    </li>
  );
}
