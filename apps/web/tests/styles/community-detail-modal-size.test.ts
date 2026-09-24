import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const previewCss = readFileSync(
  new URL('../../src/styles/viewer/composio.css', import.meta.url),
  'utf8',
);
const pluginCss = readFileSync(
  new URL('../../src/styles/viewer/templates-plugins.css', import.meta.url),
  'utf8',
);

describe('community detail modal sizing', () => {
  it('keeps desktop preview details clear of native window controls', () => {
    expect(previewCss).toMatch(
      /\.ds-modal-backdrop--compact\s*\{[^}]*padding:\s*64px 48px 48px;/s,
    );
    expect(previewCss).toMatch(
      /\.ds-modal--compact:not\(\.ds-modal-fullscreen\)\s*\{[^}]*max-width:\s*none;[^}]*height:\s*calc\(100vh - 112px\);/s,
    );
  });

  it('applies the same native-window safe area to scenario details', () => {
    expect(pluginCss).toMatch(
      /\.plugin-details-modal-backdrop--compact\s*\{[^}]*padding:\s*64px 48px 48px;/s,
    );
    expect(pluginCss).toMatch(
      /\.plugin-details-modal--compact\s*\{[^}]*max-width:\s*840px;[^}]*max-height:\s*calc\(100vh - 112px\);/s,
    );
  });
});
