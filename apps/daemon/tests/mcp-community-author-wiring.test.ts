import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/mcp-routes.ts',
);
const source = fs.readFileSync(sourcePath, 'utf8');

function between(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('community MCP/tool author wiring', () => {
  it('exposes publisherName for MCP community cards', () => {
    const route = between(
      "app.get('/api/workspace/mcp/cloud'",
      "app.post('/api/workspace/mcp/cloud'",
    );
    expect(route).toContain('publisherName:');
    expect(route).toContain("typeof r.ownerDisplayName === 'string'");
    expect(route).toContain('r.ownerMemberId as string');
  });

  it('keeps the publisher-facing MCP name separate from its technical id', () => {
    const listRoute = between(
      "app.get('/api/workspace/mcp/cloud'",
      "app.post('/api/workspace/mcp/cloud'",
    );
    const publishRoute = between(
      "app.post('/api/workspace/mcp/cloud'",
      "app.post('/api/workspace/mcp/cloud/:resourceId/install'",
    );
    expect(listRoute).toContain("label: typeof meta.label === 'string'");
    expect(publishRoute).toContain("if (typeof tplObj.label !== 'string' || !tplObj.label.trim())");
    expect(publishRoute).not.toContain('tplObj.label = tplObj.id;\ntry');
  });

  it('exposes publisherName for Tool community cards', () => {
    const route = between(
      "app.get('/api/workspace/tool/cloud'",
      "app.post('/api/workspace/tool/cloud'",
    );
    expect(route).toContain('publisherName:');
    expect(route).toContain("typeof r.ownerDisplayName === 'string'");
    expect(route).toContain('r.ownerMemberId as string');
  });
});
