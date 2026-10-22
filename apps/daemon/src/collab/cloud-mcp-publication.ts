import type { PublishCloudMcpRequest } from '@open-design/contracts';
import type { HdwCloudClient } from '../integrations/hdw-cloud.js';
import { TeamResourceShareForbiddenError, type TeamResourceRequestScope } from './team-resource-share.js';

/** Public MCP records contain connection templates, never stored credential values. */
export async function publishCloudMcp(
  client: HdwCloudClient,
  resourceId: string,
  scope: TeamResourceRequestScope,
  input: PublishCloudMcpRequest,
): Promise<void> {
  if (!scope.canShare) throw new TeamResourceShareForbiddenError();
  const { teamId, memberId } = scope.principal;
  const record = await client.getResource(teamId, resourceId);
  if (!record) throw new Error('cloud MCP not found');
  if (record.kind !== 'mcp' || record.ownerMemberId !== memberId) throw new TeamResourceShareForbiddenError();
  const source = record.metadata ?? {};
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
  if (typeof input.description === 'string') metadata.description = input.description;
  if (typeof input.logoKey === 'string') metadata.logoKey = input.logoKey;
  const { payload } = await client.request<{ code: number; msg?: string }>(
    'PUT', `/api/workspaces/${encodeURIComponent(teamId)}/resources/${encodeURIComponent(resourceId)}`,
    { metadata, scope: 'public' }, { 'x-hdw-workspace-id': teamId },
  );
  if (payload.code !== 0) throw new Error(payload.msg || 'cloud MCP publish failed');
}
