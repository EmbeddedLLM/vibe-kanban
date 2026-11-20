export type McpClient = 'codex' | 'claude' | 'pi';

export const MCP_SERVER_NAME = 'vibe_kanban';
export const MCP_SETUP_KEY_PLACEHOLDER = 'YOUR_VIBE_KANBAN_KEY';

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function mcpSetup(
  client: McpClient,
  url: string,
  token = MCP_SETUP_KEY_PLACEHOLDER
): string {
  const name = MCP_SERVER_NAME;
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
