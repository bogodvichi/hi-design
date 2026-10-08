import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveCodexConfigPath } from '../codex-config-normalize.js';
import { proxyDispatcherRequestInit } from '../connectionTest.js';

const FRESH_MS = 5 * 60_000;
const MAX_STALE_MS = 24 * 60 * 60_000;
const RETRY_MS = 30_000;
type Catalog = { models: Array<{ slug: string; [key: string]: unknown }> };

function isCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== 'object' || !('models' in value)) return false;
  const models = value.models;
  return Array.isArray(models) && models.length > 0
    && models.every((model) => typeof model?.slug === 'string' && model.slug.length > 0)
    && new Set(models.map((model) => model.slug)).size === models.length;
}

/**
 * Keep full, account-specific native metadata out of the shared CODEX_HOME
 * cache. Codex's five-second refresh can time out downloading the uncompressed
 * catalog, and another CLI version can invalidate that shared cache each turn.
 * model_catalog_json consumes the same metadata without changing the provider,
 * model, instructions, tools, authentication, or native session directory.
 */
export class CodexModelCatalog {
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly attemptedAt = new Map<string, number>();
  private readonly fetchedAt = new Map<string, number>();

  constructor(
    private readonly dataDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async waitForRefreshes(): Promise<void> {
    await Promise.all(this.pending.values());
  }

  async prepare(
    env: NodeJS.ProcessEnv,
    cliVersion: string | null | undefined,
    requestedModel?: string | null,
  ): Promise<string | null> {
    // Verified native catalog support starts at this installed CLI version.
    const version = /(?:^|\s)(0\.(\d+)\.\d+)$/.exec(cliVersion?.trim() ?? '');
    if (!version || Number(version[2]) < 161) return null;
    if (Object.entries(env).some(([key, value]) => value &&
      /^(OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE)$/i.test(key))) return null;
    try {
      const home = path.dirname(resolveCodexConfigPath(env));
      const auth = JSON.parse(await readFile(path.join(home, 'auth.json'), 'utf8'));
      const token = auth.tokens?.access_token;
      const account = auth.tokens?.account_id;
      if (auth.auth_mode !== 'chatgpt' || typeof token !== 'string' || !token
        || typeof account !== 'string' || !account || auth.OPENAI_API_KEY) return null;
      // A login or token change must never reuse another authentication scope.
      const scope = createHash('sha256').update(JSON.stringify([home, version[1], account, token])).digest('hex');
      const file = path.join(this.dataDir, 'codex-model-catalogs', `${scope}.json`);
      let usable = false;
      let age = Infinity;
      try {
        const stored: unknown = JSON.parse(await readFile(file, 'utf8'));
        usable = isCatalog(stored) && (!requestedModel || requestedModel === 'default'
          || stored.models.some((model) => model.slug === requestedModel));
        age = this.now() - (this.fetchedAt.get(file) ?? (await stat(file)).mtimeMs);
      } catch { /* A cold launch fetches its catalog below. */ }
      if (usable && age < FRESH_MS) return file;
      let refresh = this.pending.get(file);
      if (!refresh && this.now() - (this.attemptedAt.get(file) ?? -Infinity) >= RETRY_MS) {
        this.attemptedAt.set(file, this.now());
        refresh = this.refresh(file, version[1]!, token, account, env, requestedModel)
          .finally(() => this.pending.delete(file));
        this.pending.set(file, refresh);
      }
      // Refresh old metadata in the background, but bound stale use. Missing
      // models and login changes require a new successful authenticated fetch.
      if (usable && age < MAX_STALE_MS) return file;
      return refresh ? await refresh : null;
    } catch {
      // Keyring-only auth or inaccessible state stays on the native CLI path.
      return null;
    }
  }

  private async refresh(
    file: string, version: string, token: string, account: string,
    env: NodeJS.ProcessEnv, requestedModel?: string | null,
  ): Promise<string | null> {
    const proxy = proxyDispatcherRequestInit(env);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const response = await this.fetchImpl(
        `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(version)}`,
        {
          ...proxy.requestInit,
          headers: { Authorization: `Bearer ${token}`, 'ChatGPT-Account-ID': account,
            'Accept-Encoding': 'gzip', originator: 'codex_exec' },
          redirect: 'error', signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const catalog: unknown = await response.json();
      if (!isCatalog(catalog) || (requestedModel && requestedModel !== 'default'
        && !catalog.models.some((model) => model.slug === requestedModel))) return null;
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(temp, JSON.stringify(catalog), { mode: 0o600 });
      await rename(temp, file);
      this.fetchedAt.set(file, this.now());
      return file;
    } catch {
      return null;
    } finally {
      await unlink(temp).catch(() => undefined);
      await proxy.close().catch(() => undefined);
    }
  }
}
