// @vitest-environment jsdom

import { projectFileWriteContent } from '../helpers/project-file-write';
import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileViewer,
  cancelManualEditPendingStyleSnapshot,
} from '../../src/components/FileViewer';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit regressions', () => {
  function clickManualTool(testId: string) {
    fireEvent.click(screen.getByTestId(testId));
  }

  async function previewFrame() {
    return waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
  }

  async function enterManualEditMode() {
    const initialFrame = await previewFrame();
    const postMessageSpy = vi.spyOn(initialFrame.contentWindow!, 'postMessage');

    clickManualTool('manual-edit-mode-toggle');

    const captureRequest = postMessageSpy.mock.calls
      .map(([value]) => value)
      .find((value) => (
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: unknown }).type === 'od:preview-runtime-state-capture'
      )) as { type: string; id: string } | undefined;
    if (captureRequest) {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'od:preview-runtime-state-captured',
            id: captureRequest.id,
            state: {
              version: 1,
              hash: '',
              htmlAttrs: {},
              bodyAttrs: {},
              entries: [],
            },
          },
          source: initialFrame.contentWindow,
        }));
      });
    }

    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
      const activeFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(activeFrame.getAttribute('data-od-active')).toBe('true');
      expect(activeFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
    });
  }

  async function hoverManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-hover', target },
        source: frame.contentWindow,
      }));
    });
    // Hover only surfaces the affordance; it must not open any panel.
    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-hover-open')).toBeTruthy();
    });
  }

  // Clicking the empty canvas is the gesture that opens the compact page card.
  async function clickManualEditBackground() {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-background' },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
  }

  // Hover only surfaces the "edit params" affordance; pinning the inspector to
  // a target now requires an explicit click (mirrors clicking that affordance
  // or a container/image body in the bridge).
  async function selectManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
  }

  // Parameter rows are addressed by their localized `.cc-label`, matching the
  // rewritten panel's single "Parameters" list (the old hardcoded TYPOGRAPHY /
  // SIZE / LAYOUT / BOX group headers are gone).
  async function findStyleInput(label: string) {
    return waitFor(() => {
      const input = Array.from(document.querySelectorAll('.cc-row'))
        .find((row) => row.querySelector('.cc-label')?.textContent === label)
        ?.querySelector('input') as HTMLInputElement | null;
      if (!input) throw new Error(`${label} input not found`);
      return input;
    });
  }

  const FONT_SIZE_ROW = 'Font size';

  // The bridge posts this once a free drag-to-reposition passes the 4px
  // threshold and the pointer is released; the transform it carries is the
  // element's new translate().
  async function dropManualEditDrag(id: string, transform: string) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-drag-commit', id, transform },
        source: frame.contentWindow,
      }));
    });
  }

  it('matches the comment dock spacing and card appearance', () => {
    const css = readFileSync('src/components/ManualEditPanel.module.css', 'utf-8');
    expect(css).toContain('padding: 8px;\n  gap: 12px;');
    expect(css).toContain('border: 1px solid var(--border);\n  border-radius: var(--radius-lg);');
    expect(css).toContain('box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);');
    expect(css).toContain('border: 1px solid var(--border);\n  border-radius: var(--radius-md);');
  });

  it('docks the inspector without covering the frozen-width HTML preview', async () => {
    const originalRect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('viewer-body')) {
        return { x: 0, y: 0, width: 1200, height: 800, top: 0, left: 0,
          right: 1200, bottom: 800, toJSON: () => ({}) } as DOMRect;
      }
      return originalRect.call(this);
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('viewer-body') ? 1200 : 0;
    });
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(<FileViewer projectId="project-1" projectKind="prototype"
      file={htmlPreviewFile()} liveHtml={source} />);
    await enterManualEditMode();
    const workspace = document.querySelector<HTMLElement>('.manual-edit-workspace')!;
    const shell = workspace.querySelector<HTMLElement>('.manual-edit-canvas > div > div')!;
    expect(workspace.querySelector('.manual-edit-right')).toBeNull();
    expect(shell.style.width).toBe('1200px');
    expect(shell.style.transform).toBe('scale(1)');

    await selectManualEditTarget();
    const panel = workspace.querySelector<HTMLElement>('.manual-edit-right')!;
    const canvas = workspace.querySelector<HTMLElement>('.manual-edit-canvas')!;
    expect(workspace.className).toContain('workspaceWithPanel');
    expect(panel.parentElement).toBe(workspace);
    expect(canvas.parentElement).toBe(workspace);
    expect(shell.style.width).toBe('1200px'); // no responsive reflow
    const visualScale = Number(shell.style.transform.slice('scale('.length, -1));
    // Same layout as comments: 8px outer padding on each side,
    // a 12px gutter, 320px inspector, and 1px preview border per side.
    const availableWidth = 1200 - 8 * 2 - 12 - 320 - 2;
    expect(visualScale).toBeCloseTo(availableWidth / 1200);
    // The painted HTML now fits fully inside the inset preview card.
    expect(1200 * visualScale).toBeCloseTo(850);
  });

  it('previews text immediately and autosaves without closing or remounting the inspector', async () => {
    const initial = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1><p data-od-id="other">Other</p></body></html>';
    let persisted = initial;
    const writes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/files') && init?.method === 'POST') {
        persisted = projectFileWriteContent(init.body, persisted);
        writes.push(persisted);
        return Response.json({ file: htmlPreviewFile() });
      }
      if (url.includes('/raw/')) return new Response(persisted);
      return Response.json({ deployments: [], versions: [] });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={initial} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    const panel = document.querySelector('.manual-edit-right')!;
    const textarea = panel.querySelector('textarea')!;
    const frame = await previewFrame();
    const transport = frame.srcdoc;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    expect(panel.classList.contains('manual-edit-floating')).toBe(false);
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    vi.useFakeTimers();
    try {
      fireEvent.change(textarea, { target: { value: 'Updated hero' } });
      expect(post).toHaveBeenCalledWith({ type: 'od-edit-preview-text', id: 'hero', value: 'Updated hero' }, '*');
      expect(writes).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(399); });
      expect(writes).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(121); });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('Updated hero');
      expect(document.querySelector('.manual-edit-right')).toBe(panel);
      expect(panel.querySelector('textarea')).toBe(textarea);
      expect(frame.srcdoc).toBe(transport);
      vi.useRealTimers();
      await selectManualEditTarget({ ...heroTarget(), id: 'other', text: 'Other', fields: { text: 'Other' } });
      expect(panel.querySelector('textarea')).toBe(textarea);
      expect(textarea.value).toBe('Other');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains both element drafts and newer input while an earlier save is in flight', async () => {
    const initial = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1><p data-od-id="other">Other</p></body></html>';
    let persisted = initial;
    const writes: string[] = [];
    let release!: (response: Response) => void;
    const firstWrite = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/files') && init?.method === 'POST') {
        persisted = projectFileWriteContent(init.body, persisted);
        writes.push(persisted);
        return writes.length === 1 ? firstWrite : Response.json({ file: htmlPreviewFile() });
      }
      if (String(input).includes('/raw/')) return new Response(persisted);
      return Response.json({ deployments: [], versions: [] });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={initial} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = await previewFrame();
    const textarea = document.querySelector<HTMLTextAreaElement>('.manual-edit-right textarea')!;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    vi.useFakeTimers();
    try {
      fireEvent.change(textarea, { target: { value: 'First edit' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(520); });
      expect(writes).toHaveLength(1);
      const select = (target: ManualEditTarget) => act(() => {
        window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'od-edit-select', target } }));
      });
      select({ ...heroTarget(), id: 'other', text: 'Other', fields: { text: 'Other' } });
      fireEvent.change(textarea, { target: { value: 'Other edited' } });
      select(heroTarget());
      expect(textarea.value).toBe('First edit');
      fireEvent.change(textarea, { target: { value: 'Newest hero' } });
      await act(async () => {
        release(Response.json({ file: htmlPreviewFile() }));
        await firstWrite;
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(writes).toHaveLength(3);
      expect(persisted).toContain('Newest hero');
      expect(persisted).toContain('Other edited');
      expect(textarea.value).toBe('Newest hero');
      const textPreviews = post.mock.calls.map(([message]) => message as { type?: string; id?: string; value?: string })
        .filter((message) => message.type === 'od-edit-preview-text' && message.id === 'hero');
      expect(textPreviews.at(-1)?.value).toBe('Newest hero');
    } finally { vi.useRealTimers(); }
  });

  it('removes invalid fields from pending manual edit style saves without dropping unrelated fields', () => {
    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px', color: '#111111' },
    }, 'hero', ['fontSize'])).toEqual({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { color: '#111111' },
    });

    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    }, 'hero', ['fontSize'])).toBeNull();

    const otherTargetPending = {
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    };
    expect(cancelManualEditPendingStyleSnapshot(otherTargetPending, 'cta', ['fontSize'])).toBe(otherTargetPending);
  });

  it('opens edit mode with a clean canvas and no docked panel', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    // No panel auto-pops; the canvas stays clean.
    expect(document.querySelector('.manual-edit-right')).toBeNull();
    expect(screen.queryByText('PAGE')).toBeNull();

    // Hovering surfaces only the click affordance, still no panel.
    await hoverManualEditTarget();
    expect(document.querySelector('.manual-edit-right')).toBeNull();
    expect(screen.queryByText('PAGE')).toBeNull();
    expect(screen.getByTestId('manual-edit-hover-open')).toBeTruthy();
  });

  it('opens the compact page-styles card when the empty canvas is clicked', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await clickManualEditBackground();

    expect(screen.getByText('PAGE')).toBeTruthy();
    expect(document.querySelector('.manual-edit-floating')).toBeNull();
  });

  it('pins the inspector to a target only after clicking the hover affordance', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await hoverManualEditTarget();
    // No panel until the affordance is clicked.
    expect(document.querySelector('.manual-edit-right')).toBeNull();

    fireEvent.click(screen.getByTestId('manual-edit-hover-open'));

    // Selected target inspector exposes the localized font-size control.
    await findStyleInput(FONT_SIZE_ROW);
    expect(screen.queryByText('PAGE')).toBeNull();
    // A pinned inspector makes the hover shortcut redundant, including over
    // neighboring elements while the selection stays in place.
    expect(screen.queryByTestId('manual-edit-hover-open')).toBeNull();
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-hover', target: { ...heroTarget(), id: 'neighbor', label: 'Neighbor' } },
        source: frame.contentWindow,
      }));
    });
    expect(screen.queryByTestId('manual-edit-hover-open')).toBeNull();
    expect(document.querySelector('.manual-edit-right')).not.toBeNull();
  });

  it('does not let a pending manual edit style save survive a file switch', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('<!doctype html><html><body></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = htmlPreviewFile();
    const second = { ...htmlPreviewFile(), name: 'second.html', path: 'second.html' };
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={first}
        liveHtml='<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>'
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);
    fireEvent.change(baseSizeInput, { target: { value: '18' } });

    rerender(
      <FileViewer projectId="project-1" projectKind="prototype" file={second}
        liveHtml='<!doctype html><html><body><main data-od-id="second">Second</main></body></html>'
      />,
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('clears loaded source immediately on file switch without liveHtml before manual edit can save', async () => {
    let secondResolve!: (value: Response) => void;
    const secondFetch = new Promise<Response>((resolve) => {
      secondResolve = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/second.html')) return secondFetch;
      return new Response('<!doctype html><html><body><main data-od-id="hero">First</main></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const first = htmlPreviewFile();
      const second = { ...htmlPreviewFile(), name: 'second.html', path: 'second.html' };
      const { rerender } = render(<FileViewer projectId="project-1" projectKind="prototype" file={first} />);

      // The raw fetch is cache-busted on every mtime / reload / files-refresh
      // bump so srcDoc-mode previews see fresh HTML after agent edits.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/projects\/project-1\/raw\/preview\.html(\?|$)/),
        { cache: 'no-store' },
      ));
      await enterManualEditMode();
      await selectManualEditTarget();
      const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);
      fireEvent.change(baseSizeInput, { target: { value: '18' } });

      rerender(<FileViewer projectId="project-1" projectKind="prototype" file={second} />);
      fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      });

      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      secondResolve(new Response('<!doctype html><html><body><main data-od-id="second">Second</main></body></html>', { status: 200 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a prior manual edit save error after a later successful save', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    let saveAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return new Response(JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Request failed (403).' },
          }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(source, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    await waitFor(() => {
      expect(screen.getByText(/Could not save the edited file/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(saveAttempts).toBe(2);
      expect(screen.queryByText(/Could not save the edited file/)).toBeNull();
      expect(screen.getByText('All changes saved')).toBeTruthy();
    });
  });

  it.each([200, 403])('closes the inspector and exits edit mode only after saving succeeds (HTTP %i)', async (status) => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const writes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/files') && init?.method === 'POST') {
        writes.push(String(init.body));
        return status === 200
          ? Response.json({ file: htmlPreviewFile() })
          : Response.json({ error: { code: 'FORBIDDEN', message: 'Save rejected.' } }, { status });
      }
      return new Response(source);
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={source} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    fireEvent.change(await findStyleInput(FONT_SIZE_ROW), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close edit panel' }));
    if (status === 200) {
      await waitFor(() => {
        expect(document.querySelector('.manual-edit-right')).toBeNull();
        expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('false');
      });
      expect(document.querySelector('.manual-edit-workspace')).toBeNull();
    } else {
      await waitFor(() => expect(screen.getByText(/Save rejected/)).toBeTruthy());
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('18px');
  });

  it('keeps the inspector open after automatic saving', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
    expect(document.querySelector('.manual-edit-workspace')).not.toBeNull();
  });

  it('replies to the reloaded preview with the pre-save scroll position after a panel save (#92)', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();

    // The host cannot read a sandboxed iframe's scroll directly; the bridge
    // reports it via od:preview-scroll while the user works. Dispatch from
    // every mounted preview frame — only the active one passes the host's
    // source filter, mirroring production.
    const previewFrames = ['artifact-preview-frame', 'artifact-preview-frame-srcdoc']
      .map((testId) => screen.queryByTestId(testId) as HTMLIFrameElement | null)
      .filter((frame): frame is HTMLIFrameElement => Boolean(frame?.contentWindow));
    expect(previewFrames.length).toBeGreaterThan(0);
    act(() => {
      for (const frame of previewFrames) {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'od:preview-scroll', frameLeft: 0, frameTop: 1234, canvasLeft: 0, canvasTop: 1234 },
          source: frame.contentWindow,
        }));
      }
    });

    // A TEXT change is a content patch: saving it rewrites the frozen source,
    // which rebuilds the srcDoc and reloads the iframe from the top (a style
    // change streams live and never reloads, so it would not cover this bug).
    const textarea = document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'Hero edited' } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });

    // The reloaded document's bridge asks where to scroll back to. The reply
    // must carry the pre-save position — not the long-stale edit-entry
    // snapshot and not a zeroed fallback (#92: preview jumped to the top).
    const restoreMessages: Array<{ frameTop?: number; canvasTop?: number }> = [];
    const spies = previewFrames.map((frame) =>
      vi.spyOn(frame.contentWindow as Window, 'postMessage').mockImplementation(((message: unknown) => {
        const data = message as { type?: string; frameTop?: number; canvasTop?: number } | null;
        if (data && data.type === 'od:preview-scroll-restore') restoreMessages.push(data);
      }) as never),
    );
    try {
      act(() => {
        for (const frame of previewFrames) {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'od:preview-scroll-request' },
            source: frame.contentWindow,
          }));
        }
      });
      await waitFor(() => {
        expect(restoreMessages.length).toBeGreaterThan(0);
      });
      expect(restoreMessages.some((data) => data.frameTop === 1234 && data.canvasTop === 1234)).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('applies a saved panel text edit to the retained iframe without waiting for a style change', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = await previewFrame();
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    const textarea = document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Hero edited' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(postMessage).toHaveBeenCalledWith({
        type: 'od-edit-preview-text',
        id: 'hero',
        value: 'Hero edited',
      }, '*');
    });
  });

  it('automatically persists a dropped drag', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    await findStyleInput(FONT_SIZE_ROW);
    // Nothing is dirty before the drag, so no Reset is offered.
    expect(screen.queryByText('Reset')).toBeNull();

    await dropManualEditDrag('hero', 'translate(12px, 8px)');

    // The drop is a pending edit like any inspector change: nothing on disk yet,
    // but the panel is dirty so Reset/Save act on it.
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );


    await waitFor(() => {
      expect(savedBodies.length).toBe(1);
    });
    const payload = { content: projectFileWriteContent(savedBodies[0], source) };
    expect(payload.content).toContain('translate(12px, 8px)');
  });

  it('keeps a drag on an unselected element out of the open panel draft', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main><aside data-od-id="side">Side</aside></body></html>';
    const fetchMock = vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    await findStyleInput(FONT_SIZE_ROW);

    // A drag commit for a different element must not dirty the panel that is
    // showing `hero` — otherwise Save would write someone else's transform
    // into this element's draft.
    await dropManualEditDrag('side', 'translate(40px, 0px)');

    expect(screen.queryByText('Reset')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('saves text typed in the inspector while an inline text session is active', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-text-session', id: 'hero', active: true },
        source: frame.contentWindow,
      }));
    });

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Edited from panel' } });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-text-session',
          id: 'hero',
          active: false,
          changed: false,
          committed: false,
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => {
      expect(savedBodies.length).toBe(1);
    });
    const payload = { content: projectFileWriteContent(savedBodies[0], source) };
    expect(payload.content).toContain('<main data-od-id="hero">Edited from panel</main>');
    expect(payload.content).not.toContain('<main data-od-id="hero">Hero</main>');
  });

  it('keeps the preview mounted and does not save when deleting the only rendered root', async () => {
    const source = '<!doctype html><html><body><main data-od-id="app-root">App</main><script>window.bootApp && window.bootApp();</script></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget({
      ...heroTarget(),
      id: 'app-root',
      label: 'App root',
      text: 'App',
      outerHtml: '<main data-od-id="app-root">App</main>',
    });

    fireEvent.click(screen.getByLabelText('Delete element'));

    await waitFor(() => {
      expect(screen.getByText('Cannot remove the last rendered element in the document.')).toBeTruthy();
    });
    expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).srcdoc).toContain('data-od-id="app-root"');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'main',
    className: '',
    text: 'Hero',
    rect: { x: 24, y: 24, width: 160, height: 48 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<main data-od-id="hero">Hero</main>',
  };
}

function htmlPreviewFile(): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
