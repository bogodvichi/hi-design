import type { PublishCloudMcpRequest } from '@open-design/contracts';
import type { HdwCloudClient } from '../integrations/hdw-cloud.js';
import type { TeamResourceRequestScope } from './team-resource-share.js';
import { publishCommunityResourceCopy } from './community-resource-copy.js';

/** Public MCP records contain connection templates, never stored credential values. */
export async function publishCloudMcp(
  client: HdwCloudClient,
  resourceId: string,
  scope: TeamResourceRequestScope,
  input: PublishCloudMcpRequest,
): Promise<{ resourceId: string }> {
  const published = await publishCommunityResourceCopy({
    client, sourceResourceId: resourceId, scope, kind: 'mcp',
    metadata: (source) => {
      const metadata = sanitizeCloudMcpMetadata(source.metadata ?? {});
      if (typeof input.description === 'string') metadata.description = input.description;
      if (typeof input.logoKey === 'string') metadata.logoKey = input.logoKey;
      return metadata;
    },
  });
  return { resourceId: published.resourceId };
}

export function sanitizeCloudMcpMetadata(source: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of ['id', 'templateId', 'label', 'description', 'transport', 'category', 'authMode', 'homepage', 'example', 'command', 'args', 'url', 'logoKey', 'publisherName']) {
    if (source[key] !== undefined) metadata[key] = source[key];
  }
  for (const key of ['envFields', 'headerFields']) {
    if (!Array.isArray(source[key])) continue;
    metadata[key] = source[key].map((field: Record<string, unknown>) => ({
      key: field.key,
      ...(typeof field.label === 'string' ? { label: field.label } : {}),
      ...(typeof field.required === 'boolean' ? { required: field.required } : {}),
      ...(typeof field.secret === 'boolean' ? { secret: field.secret } : {}),
    }));
  }
  return metadata;
}
