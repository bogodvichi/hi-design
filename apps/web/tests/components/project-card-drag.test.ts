// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenDesignHostCaptureResult } from '@open-design/host';
import {
  installProjectCardDragPreview,
  prepareProjectCardDragPreview,
} from '../../src/components/project-card-drag';

const host = vi.hoisted(() => ({
  captureHostPage: vi.fn<() => Promise<OpenDesignHostCaptureResult>>(),
  isOpenDesignHostAvailable: vi.fn(() => false),
}));

vi.mock('@open-design/host', () => host);

beforeEach(() => {
  host.isOpenDesignHostAvailable.mockReset().mockReturnValue(false);
  host.captureHostPage.mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function htmlCard() {
  const card = document.createElement('div');
  const thumbnail = document.createElement('div');
  thumbnail.className = 'recent-projects__card-thumb';
  const frame = document.createElement('iframe');
  frame.loading = 'lazy';
  thumbnail.append(frame);
  card.append(thumbnail);
  document.body.append(card);
  frame.contentDocument!.body.textContent = 'Rendered project cover';
  vi.spyOn(thumbnail, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 320, 180));
  return { card, thumbnail, frame };
}

function decodeImage() {
  vi.stubGlobal('Image', function () {
    const image = document.createElement('img');
    image.decode = vi.fn().mockResolvedValue(undefined);
    return image;
  });
}

describe('project card HTML drag preview', () => {
  it('keeps the loaded iframe document when a static cover is unavailable', () => {
    const { card, thumbnail, frame } = htmlCard();
    const setDragImage = vi.fn();

    const cleanup = installProjectCardDragPreview({ setDragImage } as unknown as DataTransfer, card);
    const dragImage = setDragImage.mock.calls[0]![0] as HTMLElement;

    expect(dragImage.querySelector('iframe')?.contentDocument?.body.textContent)
      .toBe('Rendered project cover');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(dragImage.querySelector('.project-card-drag-preview__count')).toHaveTextContent('1');

    cleanup();
    expect(frame.isConnected).toBe(true);
    expect(thumbnail.querySelector('.project-card-drag-preview__count')).toBeNull();
  });

  it('uses a decoded screenshot with a count badge without reloading the iframe', async () => {
    const { card, frame } = htmlCard();
    host.isOpenDesignHostAvailable.mockReturnValue(true);
    host.captureHostPage.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,Y292ZXI=', w: 320, h: 180 });
    decodeImage();

    await prepareProjectCardDragPreview(card);
    expect(host.captureHostPage).toHaveBeenCalledWith({ clip: { x: 10, y: 20, width: 320, height: 180 } });
    const setDragImage = vi.fn();
    const cleanup = installProjectCardDragPreview({ setDragImage } as unknown as DataTransfer, card, 2);
    const dragImage = setDragImage.mock.calls[0]![0] as HTMLElement;

    expect(dragImage.querySelector('iframe')).toBeNull();
    expect(dragImage.querySelector('img')?.src).toBe('data:image/png;base64,Y292ZXI=');
    expect(dragImage.querySelector('.project-card-drag-preview__count')).toHaveTextContent('2');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(frame.contentDocument?.body.textContent).toBe('Rendered project cover');
    cleanup();
    cleanup();
    expect(document.querySelector('.project-card-drag-preview')).toBeNull();
    expect(frame.isConnected).toBe(true);
  });

  it('starts a drag immediately while capture is pending and does not swap its image later', async () => {
    const { card, thumbnail } = htmlCard();
    host.isOpenDesignHostAvailable.mockReturnValue(true);
    let complete!: (result: OpenDesignHostCaptureResult) => void;
    host.captureHostPage.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    decodeImage();
    const pending = prepareProjectCardDragPreview(card);
    const duplicate = prepareProjectCardDragPreview(card);
    expect(host.captureHostPage).toHaveBeenCalledTimes(1);
    const setDragImage = vi.fn();
    const cleanup = installProjectCardDragPreview({ setDragImage } as unknown as DataTransfer, card);
    expect(setDragImage).toHaveBeenCalledWith(thumbnail, 24, 24);
    cleanup();
    complete({ ok: true, dataUrl: 'data:image/png;base64,Y292ZXI=', w: 320, h: 180 });
    await Promise.all([pending, duplicate]);
    expect(setDragImage).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.project-card-drag-preview__count')).toBeNull();
  });

  it('retries failed captures and rejects a screenshot after the iframe source changes', async () => {
    const { card, thumbnail, frame } = htmlCard();
    host.isOpenDesignHostAvailable.mockReturnValue(true);
    host.captureHostPage.mockRejectedValueOnce(new Error('capture unavailable'))
      .mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,Y292ZXI=', w: 320, h: 180 });
    decodeImage();
    await prepareProjectCardDragPreview(card);
    await prepareProjectCardDragPreview(card);
    expect(host.captureHostPage).toHaveBeenCalledTimes(2);
    frame.srcdoc = '<p>Updated cover</p>';
    const setDragImage = vi.fn();
    const cleanup = installProjectCardDragPreview({ setDragImage } as unknown as DataTransfer, card);
    expect(setDragImage).toHaveBeenCalledWith(thumbnail, 24, 24);
    cleanup();
  });

  it('does not capture offscreen covers or image-only cards', async () => {
    const { card, thumbnail } = htmlCard();
    host.isOpenDesignHostAvailable.mockReturnValue(true);
    vi.mocked(thumbnail.getBoundingClientRect).mockReturnValue(new DOMRect(-10, 20, 320, 180));
    await prepareProjectCardDragPreview(card);
    thumbnail.replaceChildren(document.createElement('img'));
    await prepareProjectCardDragPreview(card);
    expect(host.captureHostPage).not.toHaveBeenCalled();
  });
});
