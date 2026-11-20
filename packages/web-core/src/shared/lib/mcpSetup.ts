export type McpClient = 'codex' | 'claude' | 'pi';

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function mcpSetupCommand(
  client: McpClient,
  url: string,
  credential: { id: string; token: string }
): string {
  const suffix = credential.id.replaceAll('-', '').slice(0, 12);
  const name = 'vibe_kanban_' + suffix;
  const variable = 'VIBE_KANBAN_MCP_TOKEN_' + suffix.toUpperCase();
  const exportKey = 'export ' + variable + '=' + shellQuote(credential.token);
  const endpoint = shellQuote(url);

  if (client === 'claude') {
    const header = shellQuote('Authorization: Bearer ${' + variable + '}');
    const remove = `claude mcp remove --scope user ${name} >/dev/null 2>&1`;
    const add = `claude mcp add --scope user --transport http ${name} ${endpoint} --header ${header}`;
    return `${exportKey} && (${remove} || true) && ${add}`;
  }

  return `${exportKey} && ${client} mcp add ${name} --url ${endpoint} --bearer-token-env-var ${variable}`;
}
