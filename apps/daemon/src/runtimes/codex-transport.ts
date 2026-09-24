export type CodexTransport = 'exec' | 'app-server';

export type CodexTransportFallbackReason =
  | 'non_native_prompt'
  | 'mcp_bridges'
  | 'strategy_task'
  | 'image_input'
  | 'plugin_isolation'
  | 'explicit_skill'
  | 'unsupported_platform';

export interface CodexTransportDecision {
  requested: CodexTransport;
  actual: CodexTransport;
  fallbackReason: CodexTransportFallbackReason | null;
}

export function decideCodexTransport({
  requested,
  nativePromptCore,
  hasMcpBridges,
  hasStrategyTask,
  hasImageInput,
  pluginIsolation,
  hasExplicitSkill,
  platformSupportsAppServer = process.platform !== 'win32',
}: {
  requested: CodexTransport;
  nativePromptCore: boolean;
  hasMcpBridges: boolean;
  hasStrategyTask: boolean;
  hasImageInput: boolean;
  pluginIsolation: boolean;
  hasExplicitSkill: boolean;
  platformSupportsAppServer?: boolean;
}): CodexTransportDecision {
  if (requested !== 'app-server') {
    return { requested, actual: 'exec', fallbackReason: null };
  }

  const fallbackReason: CodexTransportFallbackReason | null =
    !nativePromptCore
      ? 'non_native_prompt'
      : hasMcpBridges
        ? 'mcp_bridges'
        : hasStrategyTask
          ? 'strategy_task'
          : hasImageInput
            ? 'image_input'
            : pluginIsolation
              ? 'plugin_isolation'
              : hasExplicitSkill
                ? 'explicit_skill'
                : !platformSupportsAppServer
                  ? 'unsupported_platform'
                  : null;

  return {
    requested,
    actual: fallbackReason ? 'exec' : 'app-server',
    fallbackReason,
  };
}

export function resolveCodexTransport(
  env: NodeJS.ProcessEnv = process.env,
): CodexTransport {
  return env.OD_CODEX_TRANSPORT?.trim().toLowerCase() === 'app-server'
    ? 'app-server'
    : 'exec';
}
