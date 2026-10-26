// @vitest-environment jsdom

import { projectFileWriteContent } from '../helpers/project-file-write';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

const panelState = vi.hoisted(() => ({
  props: null as ComponentProps<typeof import('../../src/components/ManualEditPanel').ManualEditPanel> | null,
}));

vi.mock('../../src/components/ManualEditPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ManualEditPanel')>();
  return {
    ...actual,
    ManualEditPanel: (props: ComponentProps<typeof actual.ManualEditPanel>) => {
      panelState.props = props;
      return <div data-testid="mock-manual-edit-panel" />;
    },
  };
});

import { FileViewer } from '../../src/components/FileViewer';

function openManualTools() {
  // Manual tools now live directly in the primary toolbar.
}

function clickManualTool(testId: string) {
  openManualTools();
  fireEvent.click(screen.getByTestId(testId));
}

function clickAgentTool(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
}

async function enterManualEditMode() {
  const initialFrame = await waitFor(() => {
    const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    if (!node.contentWindow) throw new Error('Preview frame not ready');
    return node;
  });
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

// Pins the inspector to a target. Hover no longer auto-selects, so selection
// rides the explicit click path (od-edit-select), matching the bridge sending
// it when the user clicks the hover affordance or a container/image body.
async function selectManualEditTarget(target = heroTarget()) {
  const frame = await waitFor(() => {
    const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    if (!node.contentWindow) throw new Error('Preview frame not ready');
    return node;
  });
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'od-edit-select', target },
      source: frame.contentWindow,
    }));
  });
  await waitFor(() => expect(panelState.props).not.toBeNull());
}

afterEach(() => {
  cleanup();
  panelState.props = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit history regressions', () => {
  it('refreshes a conflicting revision without retrying it as a full-file upload', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1></body></html>';
    const externalSource = initialSource.replace('Hero', 'Changed elsewhere');
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/files') && init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return Response.json({ error: { code: 'FILE_EDIT_CONFLICT', message: 'The file changed.' } }, { status: 409 });
      }
      if (String(input).includes('/raw/')) return new Response(writes.length ? externalSource : initialSource);
      return Response.json({ deployments: [], versions: [] });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={initialSource} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    await act(async () => {
      await panelState.props?.onApplyPatch({ id: 'hero', kind: 'set-text', value: 'My change' }, 'Content: Hero');
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveProperty('patch.baseDigest');
    expect(writes[0]).not.toHaveProperty('content');
    await waitFor(() => expect(panelState.props?.draft.fullSource).toBe(externalSource));
    expect(panelState.props?.error).toContain('changed outside manual edit');
    expect(panelState.props?.canUndo).toBe(false);
    expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).srcdoc).toContain('Changed elsewhere');
  });

  it('flushes pending style edits before activating draw mode from manual edit', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero" style="color: #111111">Hero</h1></body></html>';
    let saveResolve!: (value: Response) => void;
    const saveResponse = new Promise<Response>((resolve) => {
      saveResolve = resolve;
    });
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = { content: projectFileWriteContent(init.body, initialSource) };
        savedSources.push(payload.content);
        return saveResponse;
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(initialSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();

    act(() => {
      panelState.props?.onStyleChange?.('hero', { color: '#ef4444' }, 'Style: Hero');
    });
    clickAgentTool('draw-overlay-toggle');

    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).toContain('rgb(239, 68, 68)');
    openManualTools();
    expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('draw-overlay-toggle').getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      saveResolve(new Response(JSON.stringify({ file: htmlPreviewFile() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      await saveResponse;
    });

    await waitFor(() => {
      openManualTools();
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('false');
    });
    expect(screen.getByTestId('draw-overlay-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the srcDoc iframe mounted when closing manual edit on a srcDoc-only preview', async () => {
    const source = '<!doctype html><html><body><script>localStorage.getItem("od");</script><main data-od-id="hero">Hero</main></body></html>';

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();

    const editFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(editFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
    expect(editFrame.srcdoc).toContain('data-od-edit-bridge');

    // Exiting through the toolbar must preserve srcDoc-only previews.
    clickManualTool('manual-edit-mode-toggle');

    await waitFor(() => {
      const previewFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(previewFrame).toBe(editFrame);
      expect(previewFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
      expect(previewFrame.srcdoc).toContain('Hero');
      expect(previewFrame.srcdoc).toContain('data-od-edit-bridge');
    });
  });

  it('uses the undone source snapshot for a follow-up edit after undo', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero" style="color: #111111">Hero</h1></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = { content: projectFileWriteContent(init.body, persistedSource) };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();

    act(() => {
      panelState.props?.onApplyPatch(
        { kind: 'set-style', id: 'hero', styles: { color: '#ef4444' } },
        'Style: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).toContain('rgb(239, 68, 68)');

    act(() => {
      panelState.props?.onUndo();
    });
    await waitFor(() => expect(savedSources).toHaveLength(2));
    expect(savedSources[1]).toBe(initialSource);

    act(() => {
      panelState.props?.onApplyPatch(
        { kind: 'set-style', id: 'hero', styles: { backgroundColor: '#f97316' } },
        'Style: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(3));

    expect(savedSources[2]).toContain('background-color: rgb(249, 115, 22)');
    expect(savedSources[2]).not.toContain('rgb(239, 68, 68)');
  });

  it('updates the manual edit canvas after text patches without replacing its transport', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1></body></html>';
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = { content: projectFileWriteContent(init.body, initialSource) };
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(initialSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const getActivePreviewFrame = () => screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;

    await waitFor(() => {
      const frame = getActivePreviewFrame();
      expect(frame.getAttribute('data-od-active')).toBe('true');
      expect(frame.getAttribute('data-od-render-mode')).toBe('srcdoc');
      expect(panelState.props?.draft.fullSource).toContain('Hero');
    });
    const frame = getActivePreviewFrame();
    const transportBeforeSave = frame.srcdoc;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() => {
      panelState.props?.onApplyPatch(
        { id: 'hero', kind: 'set-text', value: 'Updated hero' },
        'Content: Hero',
      );
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    await waitFor(() => expect(panelState.props?.draft.fullSource).toContain('Updated hero'));
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: 'od-edit-preview-text',
        id: 'hero',
        value: 'Updated hero',
      }, '*');
    });
    expect(getActivePreviewFrame()).toBe(frame);
    expect(frame.srcdoc).toBe(transportBeforeSave);
  });

  it('can undo automatically saved text and restores the inspector values', async () => {
    let persistedSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1></body></html>';
    const initial = persistedSource;
    const writes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/files') && init?.method === 'POST') {
        persistedSource = projectFileWriteContent(init.body, persistedSource);
        writes.push(persistedSource);
        return Response.json({ file: htmlPreviewFile() });
      }
      if (String(input).includes('/raw/')) return new Response(persistedSource);
      return Response.json({ deployments: [], versions: [] });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={initial} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    act(() => { panelState.props?.onDraftChange({ ...panelState.props.draft, text: 'Edited' }); });
    await waitFor(() => expect(panelState.props?.saveState).toBe('saved'));
    expect(writes).toHaveLength(1);
    act(() => { panelState.props?.onUndo(); });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toBe(initial);
    await waitFor(() => expect(panelState.props?.draft.text).toBe('Hero'));
    act(() => { panelState.props?.onRedo(); });
    await waitFor(() => expect(writes).toHaveLength(3));
    await waitFor(() => expect(panelState.props?.draft.text).toBe('Edited'));
  });

  it('clears the selected target after deleting an element', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1><p data-od-id="body">Body</p></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = { content: projectFileWriteContent(init.body, persistedSource) };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const postMessageSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    await waitFor(() => expect(panelState.props?.selectedTarget?.id).toBe('hero'));
    expect(panelState.props?.draft.text).toBe('Hero');

    act(() => {
      panelState.props?.onApplyPatch(
        { id: 'hero', kind: 'remove-element' },
        'Delete element',
      );
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).not.toContain('data-od-id="hero"');
    expect(savedSources[0]).toContain('data-od-id="body"');
    // Clearing the selection closes the inspector: edit mode returns to a clean
    // canvas (no docked/pinned panel) and the iframe selection marker is reset.
    await waitFor(() => expect(screen.queryByTestId('mock-manual-edit-panel')).toBeNull());
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-selected-target', id: null }),
      '*',
    );
    await waitFor(() => {
      expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).srcdoc)
        .not.toContain('data-od-id="hero"');
    });
  });
});

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

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'h1',
    className: '',
    text: 'Hero',
    rect: { x: 0, y: 0, width: 120, height: 40 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<h1 data-od-id="hero">Hero</h1>',
  };
}
