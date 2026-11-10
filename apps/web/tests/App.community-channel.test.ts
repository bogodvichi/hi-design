import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/types';

vi.mock('../src/features/communityUi', () => ({
  COMMUNITY_UI_VISIBLE: false,
}));

import { shouldRouteToFirstRunOnboarding } from '../src/App';

const unfinishedConfig: AppConfig = {
  mode: 'api',
  apiKey: 'sk-test',
  apiProtocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: false,
};

describe('community onboarding deep link visibility', () => {
  it('does not let the hidden community route bypass first-run onboarding in stable builds', () => {
    expect(shouldRouteToFirstRunOnboarding(unfinishedConfig, '/community')).toBe(true);
  });
});
