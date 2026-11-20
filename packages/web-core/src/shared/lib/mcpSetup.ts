export type McpClient = 'codex' | 'claude' | 'pi';

export const MCP_SETUP_KEY_PLACEHOLDER = 'YOUR_VIBE_KANBAN_KEY';

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function mcpSetup(
  client: McpClient,
  url: string,
  name: string,
  token: string
): string {
  const bearer = 'Bearer ' + token;
  if (client === 'codex') {
    return [
      `[mcp_servers.${name}]`,
      `url = ${JSON.stringify(url)}`,
      `http_headers = { Authorization = ${JSON.stringify(bearer)} }`,
    ].join('\n');
  }

  const endpoint = shellQuote(url);

  if (client === 'claude') {
    const header = shellQuote('Authorization: ' + bearer);
    const remove = `claude mcp remove --scope user ${name} >/dev/null 2>&1`;
    const add = `claude mcp add --scope user --transport http ${name} ${endpoint} --header ${header}`;
    return `(${remove} || true) && ${add}`;
  }

  return `pi mcp add ${name} --url ${endpoint} --header ${shellQuote('Authorization=' + bearer)}`;
}

export function mcpSetupExample(client: McpClient, url: string): string {
  return mcpSetup(client, url, 'vibe_kanban', MCP_SETUP_KEY_PLACEHOLDER);
}

export function mcpSetupWithKey(
  client: McpClient,
  url: string,
  credential: { id: string; token: string }
): string {
  const suffix = credential.id.replaceAll('-', '').slice(0, 12);
  return mcpSetup(client, url, 'vibe_kanban_' + suffix, credential.token);
}
