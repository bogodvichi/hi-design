// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import { UpdaterPopup } from '../../src/components/UpdaterPopup';

afterEach(cleanup);

it('does not simulate download progress when the development updater is idle', async () => {
  const restore = installMockOpenDesignHost({ host: { updater: { status: vi.fn(async () => ({
    arch: 'arm64' as const, capabilities: { canApplyInPlace: false, canDownload: false, canOpenInstaller: false, requiresManualInstall: false },
    channel: 'stable' as const, currentVersion: '0.0.0', enabled: false, mode: 'package-launcher' as const,
    platform: 'darwin' as const, state: 'idle' as const, supported: false,
  })) } } });
  try {
    render(<UpdaterPopup />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('updater-download-progress')).toBeNull();
  } finally { cleanup(); restore(); }
});
