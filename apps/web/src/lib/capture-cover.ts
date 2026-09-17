import { isOpenDesignHostAvailable } from '@open-design/host';

/**
 * Capture a PNG screenshot of an HTML document by rendering it in a hidden
 * iframe and rasterizing via SVG <foreignObject>.  The result is uploaded
 * to `POST /api/projects/:id/cover` so the project card can show a static
 * <img> instead of an iframe preview.
 *
 * External resources (images, stylesheets, CSS url() references) are inlined
 * as data URLs before serialization so the SVG foreignObject does not taint
 * the canvas.  Resources that cannot be fetched (cross-origin without CORS)
 * are replaced with transparent placeholders or removed so they cannot taint
 * the canvas either.  If tainting still occurs, toBlob is caught and null is
 * returned.
 */

const COVER_WIDTH = 400;
const COVER_HEIGHT = 300;
/** 1×1 transparent PNG used as a placeholder for unfetchable images. */
const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChw9E8oU7AAAAAElFTkSuQmCC';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a URL and return it as a data URL, or null on failure. */
async function fetchAsDataURL(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Matches url(https://…) or url(http://…) references in CSS text. */
const CSS_URL_PATTERN = /url\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/g;

/**
 * Replace every external url() reference in CSS text with a data URL.
 * Unfetchable URLs become `none` so they cannot taint the canvas.
 */
async function inlineCssUrls(text: string): Promise<string> {
  const urls = new Set<string>();
  let match: RegExpExecArray | null;
  CSS_URL_PATTERN.lastIndex = 0;
  while ((match = CSS_URL_PATTERN.exec(text)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  if (urls.size === 0) return text;

  const fetched = new Map<string, string>();
  await Promise.all(
    Array.from(urls).map(async (url) => {
      const dataUrl = await fetchAsDataURL(url);
      if (dataUrl) fetched.set(url, dataUrl);
    }),
  );

  return text.replace(CSS_URL_PATTERN, (_full, url: string) => {
    const dataUrl = fetched.get(url);
    return dataUrl ? `url(${dataUrl})` : 'none';
  });
}

/**
 * Walk the document and inline external images, stylesheets, and CSS url()
 * references as data URLs so the serialized SVG foreignObject does not taint
 * the canvas.  Resources that cannot be fetched are replaced with
 * placeholders or removed.
 */
async function inlineExternalResources(doc: Document): Promise<void> {
  const tasks: Promise<void>[] = [];

  // Inline <img> src as data URLs; strip srcset so it cannot override.
  for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>('img[src]'))) {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    tasks.push(
      (async () => {
        const dataUrl = await fetchAsDataURL(src);
        img.removeAttribute('srcset');
        img.setAttribute('src', dataUrl ?? TRANSPARENT_PX);
      })(),
    );
  }

  // Inline <link rel="stylesheet"> as <style> blocks.
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('data:') || href.startsWith('blob:')) continue;
    tasks.push(
      (async () => {
        try {
          const resp = await fetch(href);
          const css = await resp.text();
          const style = doc.createElement('style');
          style.textContent = await inlineCssUrls(css);
          link.replaceWith(style);
        } catch {
          link.remove();
        }
      })(),
    );
  }

  // Inline url() references in <style> blocks.
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    if (!style.textContent) continue;
    tasks.push(
      (async () => {
        style.textContent = await inlineCssUrls(style.textContent);
      })(),
    );
  }

  // Inline url() references in inline style attributes.
  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const css = el.getAttribute('style');
    if (!css) continue;
    tasks.push(
      (async () => {
        el.setAttribute('style', await inlineCssUrls(css));
      })(),
    );
  }

  await Promise.all(tasks);
}

/**
 * Render `html` in a hidden iframe, then serialize the document into an SVG
 * foreignObject and draw it onto a canvas.  Returns a PNG Blob or null when
 * the capture fails (CORS, empty body, etc.).
 */
export async function captureProjectCover(html: string): Promise<Blob | null> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:0;opacity:0;pointer-events:none;';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  let svgUrl: string | null = null;

  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      setTimeout(resolve, 3000);
    });
    await wait(300);

    const doc = iframe.contentDocument;
    if (!doc) return null;

    // Inline external resources before serialization so the SVG foreignObject
    // does not reference any cross-origin URLs and taint the canvas.
    await inlineExternalResources(doc);

    const serialized = new XMLSerializer().serializeToString(doc.documentElement);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
      '<foreignObject width="100%" height="100%">' +
      serialized +
      '</foreignObject></svg>';

    svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

    const img = new Image();

    const blob = await new Promise<Blob | null>((resolve) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = COVER_WIDTH;
        canvas.height = COVER_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
        ctx.drawImage(img, 0, 0, COVER_WIDTH, COVER_HEIGHT);
        try {
          canvas.toBlob((b) => resolve(b), 'image/png');
        } catch {
          // Tainted canvas — a resource we could not inline is still
          // referenced by the foreignObject.  Degrade to no cover.
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = svgUrl!;
      setTimeout(() => resolve(null), 4000);
    });

    return blob;
  } catch {
    return null;
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    iframe.remove();
  }
}

/**
 * Upload a cover PNG to the daemon for the given project.  The daemon
 * stores it as `.cover.png` in the project directory and updates
 * `projects.cover_digest`.
 */
export async function uploadProjectCover(
  projectId: string,
  blob: Blob,
  workspaceContext?: { headers?: Record<string, string> } | null,
): Promise<boolean> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        ...(workspaceContext?.headers ?? {}),
      },
      body: blob,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Convenience: capture a cover from HTML and upload it.  Returns true when
 * the cover was successfully generated and uploaded.
 */
export async function captureAndUploadCover(
  projectId: string,
  html: string,
  workspaceContext?: { headers?: Record<string, string> } | null,
): Promise<boolean> {
  // In the desktop environment, the daemon's generateProjectCover handles
  // cover capture natively via Electron's webContents.capturePage() — skip
  // the browser-side SVG foreignObject fallback to avoid tainted-canvas
  // errors and redundant work.
  if (isOpenDesignHostAvailable()) return false;
  const blob = await captureProjectCover(html);
  if (!blob) return false;
  return uploadProjectCover(projectId, blob, workspaceContext);
}
