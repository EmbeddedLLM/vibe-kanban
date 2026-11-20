import { describe, expect, it } from 'vitest';
import {
  MCP_SETUP_KEY_PLACEHOLDER,
  mcpSetupExample,
  mcpSetupWithKey,
} from './mcpSetup';

const url = 'https://board.example.com/mcp';

describe('MCP setup', () => {
  it('shows a complete Codex TOML entry with a placeholder', () => {
    expect(mcpSetupExample('codex', url)).toBe(
      `[mcp_servers.vibe_kanban]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${MCP_SETUP_KEY_PLACEHOLDER}" }`
    );
  });

  it('uses the Pi syntax for a literal header', () => {
    expect(mcpSetupExample('pi', url)).toBe(
      `pi mcp add vibe_kanban --url '${url}' --header 'Authorization=Bearer ${MCP_SETUP_KEY_PLACEHOLDER}'`
    );
  });

  it('can replace a Claude entry and sets its bearer header', () => {
    expect(mcpSetupExample('claude', url)).toBe(
      `(claude mcp remove --scope user vibe_kanban >/dev/null 2>&1 || true) && claude mcp add --scope user --transport http vibe_kanban '${url}' --header 'Authorization: Bearer ${MCP_SETUP_KEY_PLACEHOLDER}'`
    );
  });

  it.each(['codex', 'claude', 'pi'] as const)(
    'includes the issued key directly in %s setup',
    (client) => {
      const setup = mcpSetupWithKey(client, url, {
        id: '12345678-abcd-4abc-abcd-123456789abc',
        token: 'vkm_example',
      });
      expect(setup).toContain('vibe_kanban_12345678abcd');
      expect(setup).toContain('Bearer vkm_example');
      expect(setup).not.toContain(MCP_SETUP_KEY_PLACEHOLDER);
      expect(setup).not.toContain('bearer-token-env-var');
    }
  );
});
