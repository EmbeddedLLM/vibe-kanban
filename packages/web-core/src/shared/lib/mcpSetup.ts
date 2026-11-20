export type McpClient = 'codex' | 'claude' | 'pi';

export const MCP_SETUP_TOKEN_VARIABLE = 'VIBE_KANBAN_MCP_TOKEN';

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function mcpAddCommand(
  client: McpClient,
  url: string,
  name: string,
  variable: string
): string {
  const endpoint = shellQuote(url);

  if (client === 'claude') {
    const header = shellQuote('Authorization: Bearer ${' + variable + '}');
    const remove = `claude mcp remove --scope user ${name} >/dev/null 2>&1`;
    const add = `claude mcp add --scope user --transport http ${name} ${endpoint} --header ${header}`;
    return `(${remove} || true) && ${add}`;
  }

  return `${client} mcp add ${name} --url ${endpoint} --bearer-token-env-var ${variable}`;
}

export function mcpSetupExample(client: McpClient, url: string): string {
  return mcpAddCommand(client, url, 'vibe_kanban', MCP_SETUP_TOKEN_VARIABLE);
}

export function mcpSetupCommand(
  client: McpClient,
  url: string,
  credential: { id: string; token: string }
): string {
  const suffix = credential.id.replaceAll('-', '').slice(0, 12);
  const name = 'vibe_kanban_' + suffix;
  const variable = MCP_SETUP_TOKEN_VARIABLE + '_' + suffix.toUpperCase();
  const exportKey = 'export ' + variable + '=' + shellQuote(credential.token);
  return `${exportKey} && ${mcpAddCommand(client, url, name, variable)}`;
}
