import type { WebContents } from 'electron';
import type { DesktopStatusSnapshot } from '@open-design/sidecar-proto';

/** Origins identify renderer roles without exposing URL queries or document content. */
export function inspectDesktopWebContents(contents: WebContents[]): NonNullable<DesktopStatusSnapshot['webContents']> {
  return contents.filter(content => !content.isDestroyed()).map(content => ({
    id: content.id,
    type: content.getType(),
    osProcessId: content.getOSProcessId(),
    frames: content.mainFrame.framesInSubtree.map(frame => ({
      processId: frame.processId,
      routingId: frame.routingId,
      origin: navigationOrigin(frame.url),
    })),
  }));
}

function navigationOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? parsed.protocol : parsed.origin;
  } catch {
    return '';
  }
}
