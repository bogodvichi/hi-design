import { describe, expect, it } from 'vitest';
import type { WebContents } from 'electron';
import { inspectDesktopWebContents } from '../../src/main/web-contents-diagnostics.js';

describe('desktop renderer census', () => {
  it('reports contents and subframe process identities without URL secrets', () => {
    const contents = [{
      id: 1, isDestroyed: () => false, getType: () => 'window', getOSProcessId: () => 100,
      mainFrame: { framesInSubtree: [
        { processId: 7, routingId: 1, url: 'http://localhost:1234/home?ticket=secret#private' },
        { processId: 9, routingId: 2, url: 'data:text/html,private-content' },
      ] },
    }, { isDestroyed: () => true }] as unknown as WebContents[];
    expect(inspectDesktopWebContents(contents)).toEqual([{
      id: 1, type: 'window', osProcessId: 100, frames: [
        { processId: 7, routingId: 1, origin: 'http://localhost:1234' },
        { processId: 9, routingId: 2, origin: 'data:' },
      ],
    }]);
  });
});
