import { describe, expect, it } from 'vitest';

import { decideCodexTransport, resolveCodexTransport } from '../../src/runtimes/codex-transport.js';

describe('Codex transport selection', () => {
  it('keeps exec as the safe default', () => {
    expect(resolveCodexTransport({})).toBe('exec');
  });

  it('enables app-server only through the explicit feature flag', () => {
    expect(resolveCodexTransport({ OD_CODEX_TRANSPORT: 'app-server' })).toBe('app-server');
    expect(resolveCodexTransport({ OD_CODEX_TRANSPORT: 'exec' })).toBe('exec');
    expect(resolveCodexTransport({ OD_CODEX_TRANSPORT: 'unexpected' })).toBe('exec');
  });

  it('uses app-server only for the conservative first-rollout shape', () => {
    expect(decideCodexTransport({
      requested: 'app-server',
      nativePromptCore: true,
      hasMcpBridges: false,
      hasStrategyTask: false,
      hasImageInput: false,
      pluginIsolation: false,
      hasExplicitSkill: false,
    })).toEqual({
      requested: 'app-server',
      actual: 'app-server',
      fallbackReason: null,
    });
  });

  it.each([
    ['non_native_prompt', { nativePromptCore: false }],
    ['mcp_bridges', { hasMcpBridges: true }],
    ['strategy_task', { hasStrategyTask: true }],
    ['image_input', { hasImageInput: true }],
    ['plugin_isolation', { pluginIsolation: true }],
    ['explicit_skill', { hasExplicitSkill: true }],
    ['unsupported_platform', { platformSupportsAppServer: false }],
  ] as const)('falls back to exec for %s', (reason, override) => {
    expect(decideCodexTransport({
      requested: 'app-server',
      nativePromptCore: true,
      hasMcpBridges: false,
      hasStrategyTask: false,
      hasImageInput: false,
      pluginIsolation: false,
      hasExplicitSkill: false,
      platformSupportsAppServer: true,
      ...override,
    })).toEqual({
      requested: 'app-server',
      actual: 'exec',
      fallbackReason: reason,
    });
  });
});
