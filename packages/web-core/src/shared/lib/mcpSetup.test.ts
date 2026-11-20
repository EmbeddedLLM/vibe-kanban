import { describe, expect, it } from 'vitest';
import { MCP_SETUP_KEY_PLACEHOLDER, mcpSetup } from './mcpSetup';

const url = 'https://board.example.com/mcp';

describe('MCP setup', () => {
  it('shows a complete Codex TOML entry with a placeholder', () => {
    expect(mcpSetup('codex', url)).toBe(
      `[mcp_servers.vibe_kanban]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${MCP_SETUP_KEY_PLACEHOLDER}" }`
    );
  });

  it('uses the Pi syntax for a literal header', () => {
    expect(mcpSetup('pi', url)).toBe(
      `pi mcp add vibe_kanban --url '${url}' --header 'Authorization=Bearer ${MCP_SETUP_KEY_PLACEHOLDER}'`
    );
  });

  it('can replace a Claude entry and sets its bearer header', () => {
    expect(mcpSetup('claude', url)).toBe(
      `(claude mcp remove --scope user vibe_kanban >/dev/null 2>&1 || true) && claude mcp add --scope user --transport http vibe_kanban '${url}' --header 'Authorization: Bearer ${MCP_SETUP_KEY_PLACEHOLDER}'`
    );
  });

  it.each(['codex', 'claude', 'pi'] as const)(
    'fills in the issued key for %s with the same server name',
    (client) => {
      expect(mcpSetup(client, url, 'vkm_example')).toBe(
        mcpSetup(client, url).replace(MCP_SETUP_KEY_PLACEHOLDER, 'vkm_example')
      );
    }
  );
});
