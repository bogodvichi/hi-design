export type LoginPlatform = 'hikke' | 'hicoo' | 'uedro';

/** Only a rejected credential submission is 401; upstream failures are 502. */
export class PlatformLoginError extends Error {
  readonly code: 'UNAUTHORIZED' | 'BAD_GATEWAY';

  constructor(readonly platform: LoginPlatform, readonly status: 401 | 502 = 502) {
    super(status === 401 ? 'invalid username or password' : `${platform} login unavailable`);
    this.name = 'PlatformLoginError';
    this.code = status === 401 ? 'UNAUTHORIZED' : 'BAD_GATEWAY';
  }
}

export function normalizeLoginError(platform: LoginPlatform, error: unknown): PlatformLoginError {
  return error instanceof PlatformLoginError ? error : new PlatformLoginError(platform);
}

export async function runPlatformLogin<T>(platform: LoginPlatform, login: () => Promise<T>): Promise<T> {
  try {
    return await login();
  } catch (error) {
    throw normalizeLoginError(platform, error);
  }
}
