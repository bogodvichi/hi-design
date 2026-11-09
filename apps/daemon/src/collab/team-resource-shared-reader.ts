import type { HdwCloudClient } from '../integrations/hdw-cloud.js';
import { shouldUseHdwHttpResourceTransport } from './hdw-http-team-projects.js';

/** Read with the same transport and login authority used to publish resources. */
export async function readSharedTeamResourceListing(
  workspaceId: string,
  client: HdwCloudClient | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!workspaceId.trim()) throw new Error('explicit workspace scope is required');
  if (shouldUseHdwHttpResourceTransport(env)) {
    if (!client) throw new Error('HDW resource transport is unavailable');
    // HDW uses an omitted scope for workspace-local resources; `public` is
    // the separate community plane. A synthetic `team` filter returns empty.
    const resources = await client.listResources(workspaceId);
    return JSON.stringify({ resources: resources.filter(resource => Boolean(resource.versionId)).map(resource => ({
      ...resource,
      publishedVersion: resource.versionId
        ? { id: resource.versionId, version: resource.version }
        : null,
    })) });
  }
  const { runVelaResourceCommand } = await import('./vela-cli-resource-adapter.js');
  return runVelaResourceCommand(['shared', '--json'], workspaceId);
}
