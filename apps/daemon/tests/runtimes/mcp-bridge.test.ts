import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import { createLazyMcpBridgeServer } from '../../src/runtimes/mcp-bridge.js';

describe('lazy MCP bridge handshake', () => {
  it('finishes the downstream initialize handshake before connecting upstream', async () => {
    const connectUpstream = vi.fn(async () => {
      throw new Error('upstream unavailable');
    });
    const lazyBridge = createLazyMcpBridgeServer({
      serverName: 'test-bridge',
      instructions: 'test bridge',
      connectUpstream,
    });
    const bridge = lazyBridge.server;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await bridge.connect(serverTransport);
    await client.connect(clientTransport);

    expect(connectUpstream).not.toHaveBeenCalled();
    await expect(client.listTools()).rejects.toThrow('upstream unavailable');
    expect(connectUpstream).toHaveBeenCalledTimes(1);

    await Promise.allSettled([
      client.close(),
      bridge.close(),
      lazyBridge.closeUpstream(),
    ]);
  });
});
