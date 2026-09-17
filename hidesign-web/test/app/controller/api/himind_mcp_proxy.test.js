'use strict';

const assert = require('assert');
const HiMindMcpProxyController = require('../../../../app/controller/api/himind_mcp_proxy');

describe('test/app/controller/api/himind_mcp_proxy.test.js', () => {
  it('fails closed until the dedicated internal CA is configured', async () => {
    const controller = Object.create(HiMindMcpProxyController.prototype);
    controller.app = { config: { himind: { mcpCaCertificate: '' } } };
    controller.ctx = {
      method: 'POST',
      request: { body: {} },
      headers: {},
    };

    await controller.forward();

    assert.strictEqual(controller.ctx.status, 503);
    assert.deepStrictEqual(controller.ctx.body, {
      error: 'HiMind MCP internal CA is not configured',
    });
  });

  it('rejects methods outside the MCP streamable HTTP contract', async () => {
    const controller = Object.create(HiMindMcpProxyController.prototype);
    controller.app = { config: { himind: {} } };
    controller.ctx = { method: 'PUT', request: { body: {} }, headers: {} };

    await controller.forward();

    assert.strictEqual(controller.ctx.status, 405);
  });
});
