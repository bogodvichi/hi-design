import { KNOWN_PROVIDERS, defaultKnownProviderModel, type KnownProvider } from './config';
import { resolveFixedOriginBaseUrl } from './apiProtocols';
import type { AppConfig, ApiProtocol, ApiProtocolConfig } from '../types';

export function defaultApiProtocolConfig(protocol: ApiProtocol): ApiProtocolConfig {
  const provider = KNOWN_PROVIDERS.find((p) => p.protocol === protocol);
  return {
    apiKey: '',
    baseUrl: provider?.baseUrl ?? '',
    model: defaultKnownProviderModel(provider),
    apiVersion: '',
    apiProviderBaseUrl: provider ? provider.baseUrl : null,
  };
}

function providerFamilyLabel(provider: KnownProvider): string {
  return provider.label.replace(/\s+—\s+(Anthropic|OpenAI)$/u, '');
}

function siblingProviderForProtocol(
  providerBaseUrl: string | null | undefined,
  protocol: ApiProtocol,
): KnownProvider | null {
  if (!providerBaseUrl) return null;
  const currentProvider = KNOWN_PROVIDERS.find(
    (p) => p.baseUrl === providerBaseUrl,
  );
  if (!currentProvider) return null;

  const currentFamily = providerFamilyLabel(currentProvider);
  return (
    KNOWN_PROVIDERS.find(
      (p) => p.protocol === protocol && providerFamilyLabel(p) === currentFamily,
    ) ?? null
  );
}

function nextApiProtocolConfig(
  config: AppConfig,
  protocol: ApiProtocol,
): ApiProtocolConfig {
  const savedConfig = config.apiProtocolConfigs?.[protocol];
  if (savedConfig) return savedConfig;

  const currentConfig = currentApiProtocolConfig(config);
  const siblingProvider = siblingProviderForProtocol(
    currentConfig.apiProviderBaseUrl,
    protocol,
  );
  if (siblingProvider) {
    return {
      ...defaultApiProtocolConfig(protocol),
      baseUrl: siblingProvider.baseUrl,
      model: defaultKnownProviderModel(siblingProvider),
      apiProviderBaseUrl: siblingProvider.baseUrl,
    };
  }

  if (currentConfig.apiProviderBaseUrl === null) {
    return {
      ...currentConfig,
      apiKey: '',
      apiVersion: protocol === 'azure' ? currentConfig.apiVersion : '',
      apiProviderBaseUrl: null,
    };
  }

  return {
    ...defaultApiProtocolConfig(protocol),
  };
}

export function currentApiProtocolConfig(config: AppConfig): ApiProtocolConfig {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    apiVersion: config.apiVersion ?? '',
    apiProviderBaseUrl: config.apiProviderBaseUrl ?? null,
    byokImageModel: config.byokImageModel ?? '',
    byokVideoModel: config.byokVideoModel ?? '',
    byokSpeechModel: config.byokSpeechModel ?? '',
    byokSpeechVoice: config.byokSpeechVoice ?? '',
  };
}


export function applyApiProtocolConfig(
  config: AppConfig,
  protocol: ApiProtocol,
  apiConfig: ApiProtocolConfig,
): AppConfig {
  return {
    ...config,
    apiProtocol: protocol,
    apiKey: apiConfig.apiKey,
    baseUrl: resolveFixedOriginBaseUrl(protocol, apiConfig.baseUrl),
    model: apiConfig.model,
    apiProviderBaseUrl: apiConfig.apiProviderBaseUrl ?? null,
    apiVersion: protocol === 'azure' ? (apiConfig.apiVersion ?? '') : '',
    // byokImageModel applies to the protocols that inject the daemon-side
    // generate_image tool (SenseAudio, AIHubMix) — flipping to another BYOK
    // tab shouldn't carry an image-model choice into, say, the OpenAI form.
    // Mirrors the apiVersion guarding above.
    byokImageModel:
      protocol === 'senseaudio' || protocol === 'aihubmix'
        ? (apiConfig.byokImageModel ?? '')
        : '',
    // byokVideoModel only applies to AIHubMix today (the only BYOK chat with a
    // video-model picker; SenseAudio's video tool uses a fixed model).
    byokVideoModel:
      protocol === 'aihubmix' ? (apiConfig.byokVideoModel ?? '') : '',
    // Speech model + voice also AIHubMix-only today.
    byokSpeechModel:
      protocol === 'aihubmix' ? (apiConfig.byokSpeechModel ?? '') : '',
    byokSpeechVoice:
      protocol === 'aihubmix' ? (apiConfig.byokSpeechVoice ?? '') : '',
  };
}


export function updateCurrentApiProtocolConfig(
  config: AppConfig,
  patch: Partial<ApiProtocolConfig>,
): AppConfig {
  const protocol = config.apiProtocol ?? 'anthropic';
  const clearedApiKey =
    patch.apiKey !== undefined &&
    !patch.apiKey.trim() &&
    Boolean(currentApiProtocolConfig(config).apiKey.trim());
  const defaultModel = defaultApiProtocolConfig(protocol).model;
  const nextApiConfig: ApiProtocolConfig = {
    ...currentApiProtocolConfig(config),
    ...patch,
    ...(clearedApiKey && defaultModel && patch.model === undefined
      ? { model: defaultModel }
      : {}),
  };
  return applyApiProtocolConfig(
    {
      ...config,
      apiProtocolConfigs: {
        ...(config.apiProtocolConfigs ?? {}),
        [protocol]: nextApiConfig,
      },
    },
    protocol,
    nextApiConfig,
  );
}


export function switchApiProtocolConfig(
  config: AppConfig,
  protocol: ApiProtocol,
): AppConfig {
  const currentProtocol = config.apiProtocol ?? 'anthropic';
  const apiProtocolConfigs = {
    ...(config.apiProtocolConfigs ?? {}),
    [currentProtocol]: currentApiProtocolConfig(config),
  };
  const nextApiConfig = nextApiProtocolConfig(
    {
      ...config,
      apiProtocolConfigs,
    },
    protocol,
  );
  return applyApiProtocolConfig(
    {
      ...config,
      mode: 'api',
      apiProtocolConfigs,
    },
    protocol,
    nextApiConfig,
  );
}

