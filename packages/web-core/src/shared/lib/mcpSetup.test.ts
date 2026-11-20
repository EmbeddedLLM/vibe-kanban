import { describe, expect, it } from 'vitest';
import {
  MCP_SETUP_TOKEN_VARIABLE,
  mcpSetupCommand,
  mcpSetupExample,
} from './mcpSetup';

const url = 'https://board.example.com/mcp';

describe('MCP setup commands', () => {
  it.each(['codex', 'pi'] as const)(
    'shows the URL and variable name for %s',
    (client) => {
      expect(mcpSetupExample(client, url)).toBe(
        `${client} mcp add vibe_kanban --url '${url}' --bearer-token-env-var ${MCP_SETUP_TOKEN_VARIABLE}`
      );
    }
  );

  it('leaves the Claude header reference for the client to expand', () => {
    expect(mcpSetupExample('claude', url)).toBe(
      `(claude mcp remove --scope user vibe_kanban >/dev/null 2>&1 || true) && claude mcp add --scope user --transport http vibe_kanban '${url}' --header 'Authorization: Bearer \${${MCP_SETUP_TOKEN_VARIABLE}}'`
    );
  });

  it('still includes the secret in the one-time setup command', () => {
    expect(
      mcpSetupCommand('codex', url, {
        id: '12345678-abcd-4abc-abcd-123456789abc',
        token: 'vkm_example',
      })
    ).toBe(
      `export VIBE_KANBAN_MCP_TOKEN_12345678ABCD='vkm_example' && codex mcp add vibe_kanban_12345678abcd --url '${url}' --bearer-token-env-var VIBE_KANBAN_MCP_TOKEN_12345678ABCD`
    );
  });
});
