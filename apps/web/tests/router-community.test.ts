import { afterEach, describe, expect, it, vi } from 'vitest';

const RELEASE_CHANNEL_ENV = 'NEXT_PUBLIC_OD_RELEASE_CHANNEL';
const initialReleaseChannel = process.env[RELEASE_CHANNEL_ENV];

async function loadRouter(releaseChannel: string): Promise<typeof import('../src/router')> {
  vi.resetModules();
  vi.stubEnv(RELEASE_CHANNEL_ENV, releaseChannel);
  return import('../src/router');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (initialReleaseChannel == null) {
    delete process.env[RELEASE_CHANNEL_ENV];
  } else {
    process.env[RELEASE_CHANNEL_ENV] = initialReleaseChannel;
  }
});

describe('community route visibility', () => {
  it('redirects the community view to home in stable builds', async () => {
    const router = await loadRouter('stable');

    expect(router.parseRoute('/community')).toEqual({ kind: 'home', view: 'home' });
    expect(router.buildPath({ kind: 'home', view: 'community' })).toBe('/');
    expect(router.buildPath({ kind: 'community' })).toBe('/');
  });

  it('keeps the community view available in beta builds', async () => {
    const router = await loadRouter('beta');

    expect(router.parseRoute('/community')).toEqual({ kind: 'home', view: 'community' });
    expect(router.buildPath({ kind: 'home', view: 'community' })).toBe('/community');
    expect(router.buildPath({ kind: 'community' })).toBe('/community');
  });

  it('keeps the community view available when no release channel is baked in', async () => {
    const router = await loadRouter('');

    expect(router.parseRoute('/community')).toEqual({ kind: 'home', view: 'community' });
  });
});
