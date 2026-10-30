// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDialog } from '../../src/components/feedback/FeedbackDialog';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../src/components/feedback/TinyMCEEditor', () => ({ TinyMCEEditor: () => null }));
vi.mock('../../src/components/feedback/FeedbackTypeSelect', () => ({ FeedbackTypeSelect: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FeedbackDialog session', () => {
  it('sends one session request when StrictMode replays the mount effect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>(() => {}));

    render(
      <StrictMode>
        <FeedbackDialog onClose={() => {}} onSuccess={() => {}} />
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
