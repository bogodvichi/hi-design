import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const daemonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcpRoutes = fs.readFileSync(path.join(daemonRoot, 'src/mcp-routes.ts'), 'utf8');
const server = fs.readFileSync(path.join(daemonRoot, 'src/server.ts'), 'utf8');
const resourceController = fs.readFileSync(
  path.resolve(daemonRoot, '../../hidesign-web/app/controller/api/resource.js'),
  'utf8',
);

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `expected to find ${start}`).toBeGreaterThan(-1);
  expect(endIndex, `expected to find ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('community Skill/MCP/tool publication actions', () => {
  it.each([
    ['mcp', 'CLOUD_MCP_NOT_FOUND'],
    ['tool', 'CLOUD_TOOL_NOT_FOUND'],
  ])('keeps %s unpublish separate from permanent delete', (kind, notFoundCode) => {
    const unpublish = between(
      mcpRoutes,
      `app.post('/api/workspace/${kind}/cloud/:resourceId/unpublish'`,
      `app.delete('/api/workspace/${kind}/cloud/:resourceId'`,
    );
    expect(unpublish).toContain(notFoundCode);
    expect(unpublish).toContain('record.ownerMemberId !== getOwnerMemberId(req)');
    expect(unpublish).toContain('{ metadata: record.metadata ?? {}, scope: null }');

    const deletionStart = mcpRoutes.indexOf(`app.delete('/api/workspace/${kind}/cloud/:resourceId'`);
    const deletionEnd = kind === 'mcp'
      ? mcpRoutes.indexOf("app.post('/api/workspace/mcp/cloud/:resourceId/install'", deletionStart)
      : mcpRoutes.length;
    expect(deletionStart).toBeGreaterThan(-1);
    expect(deletionEnd).toBeGreaterThan(deletionStart);
    const deletion = mcpRoutes.slice(deletionStart, deletionEnd);
    expect(deletion).toContain('hdwDelete(');
  });

  it('keeps Skill unpublish separate from permanent delete', () => {
    const unpublish = between(
      server,
      "app.post('/api/workspace/skills/cloud/:resourceId/unpublish'",
      "app.delete('/api/workspace/skills/cloud/:resourceId'",
    );
    expect(unpublish).toContain('cloudResource.ownerMemberId !== scope.principal.memberId');
    expect(unpublish).toContain('{ metadata: cloudResource.metadata ?? {}, scope: null }');

    const deletion = server.slice(server.indexOf(
      "app.delete('/api/workspace/skills/cloud/:resourceId'",
    ));
    expect(deletion).toContain('hdwCloudClient.removeResource(workspaceId, resourceId)');
  });

  it('lets HDW move a public resource back to its null personal scope', () => {
    expect(resourceController).toContain("Object.prototype.hasOwnProperty.call(body, 'scope')");
    expect(resourceController).toContain('updateFields.scope = body.scope || null');
  });
});
