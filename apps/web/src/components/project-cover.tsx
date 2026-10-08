import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { projectFileUrl } from '../providers/registry';
import type { ProjectFile } from '../types';
import {
  THUMBNAIL_OVERSCAN_MARGIN,
  useThumbnailLoadSlot,
} from '../lib/thumbnail-load-gate';
import { useInView } from './plugins-home/useInView';

export type ProjectCoverKind = 'html' | 'image' | 'video' | 'logo';

export interface ProjectCoverOverride {
  kind: ProjectCoverKind;
  name: string;
  mtime?: number;
}

export function projectFallbackVisual(
  projectId: string,
  projectName: string,
): { style: CSSProperties; initial: string } {
  let h = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const hue2 = (hue + 38) % 360;
  const style: CSSProperties = {
    background: `radial-gradient(circle at 30% 28%, hsl(${hue} 70% 78% / 0.55), transparent 42%), linear-gradient(135deg, hsl(${hue} 65% 88%), hsl(${hue2} 70% 90%))`,
  };
  const trimmed = projectName.trim();
  const initial = (trimmed ? Array.from(trimmed)[0]! : '?').toUpperCase();
  return { style, initial };
}

export function communityOriginProjectId(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (!tag.startsWith('project-id:')) continue;
    const projectId = tag.slice('project-id:'.length).trim();
    if (projectId) return projectId;
  }
  return null;
}

export function communityOriginProjectName(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (!tag.startsWith('project-name:')) continue;
    const encoded = tag.slice('project-name:'.length);
    if (!encoded) continue;
    try {
      const projectName = decodeURIComponent(encoded).trim();
      if (projectName) return projectName;
    } catch {
      // Ignore malformed legacy tags and fall back to the community title.
    }
  }
  return null;
}

export function coverFromProjectFile(
  file: ProjectFile,
  kind: ProjectCoverKind = file.kind as ProjectCoverKind,
): ProjectCoverOverride | null {
  if (kind !== 'html' && kind !== 'image' && kind !== 'video' && kind !== 'logo') return null;
  return { kind, name: file.path ?? file.name, mtime: file.mtime };
}

export function selectProjectFileCover(files: ProjectFile[]): ProjectCoverOverride | null {
  const html =
    files.find((file) => (file.path ?? file.name) === 'index.html') ??
    files
      .filter((file) => file.kind === 'html')
      .sort((a, b) => b.mtime - a.mtime)[0];
  if (html) return coverFromProjectFile(html, 'html');

  const image = files
    .filter((file) => file.kind === 'image')
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (image) return coverFromProjectFile(image, 'image');

  const video = files
    .filter((file) => file.kind === 'video')
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (video) return coverFromProjectFile(video, 'video');

  return null;
}

export function projectCoverUrl(
  projectId: string,
  name: string,
  version?: number,
  workspaceContext?: WorkspaceCollabContext | null,
): string {
  const url = projectFileUrl(projectId, name, workspaceContext);
  if (!Number.isFinite(version) || version === undefined || version <= 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(String(Math.trunc(version)))}`;
}

export function HtmlProjectCoverFrame({
  src,
  initial,
  iframeClassName,
  glyphClassName,
  diagnostic,
}: {
  src: string | undefined;
  initial: string;
  iframeClassName: string;
  glyphClassName: string;
  diagnostic: string;
}) {
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState(false);
  // Cover work is deferred until the card is near the viewport, and the
  // iframe document load itself is budgeted by the shared thumbnail gate so a
  // large grid cannot saturate the daemon connection pool (Batch A §4.2).
  const { ref: inViewRef, inView } = useInView<HTMLSpanElement>({
    rootMargin: THUMBNAIL_OVERSCAN_MARGIN,
  });

  useEffect(() => {
    if (!src || !inView) {
      setFailed(false);
      setVerified(false);
      return;
    }

    const controller = new AbortController();
    let disposed = false;

    setFailed(false);
    setVerified(false);

    fetch(src, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (disposed) return;
        if (response.ok || response.status === 304) {
          setVerified(true);
          return;
        }
        console.warn(
          `[project-cover] HTML cover unavailable (${response.status} ${response.statusText}):`,
          diagnostic,
        );
        setFailed(true);
      })
      .catch((err) => {
        if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
        console.warn('[project-cover] failed to verify HTML cover:', diagnostic, err);
        setFailed(true);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [src, diagnostic, inView]);

  const { canLoad, settle } = useThumbnailLoadSlot(
    Boolean(src) && inView && verified && !failed,
  );

  if (!src || failed || !verified || !canLoad) {
    return (
      <span ref={inViewRef} className={glyphClassName}>
        {initial}
      </span>
    );
  }

  return (
    <iframe
      className={iframeClassName}
      src={src}
      title=""
      loading="lazy"
      sandbox="allow-scripts"
      tabIndex={-1}
      onLoad={settle}
      onError={() => {
        settle();
        console.warn('[project-cover] failed to load HTML cover:', diagnostic);
        setFailed(true);
      }}
    />
  );
}

/**
 * Image cover with onError fallback to the initial glyph. When coverDigest is
 * set but the actual cover file is missing (404), the <img> would otherwise
 * show a broken-image icon. This component swaps to the gradient + initial
 * glyph so the card always has a visual placeholder.
 */
export function ImageProjectCover({
  src,
  initial,
  imgClassName,
  glyphClassName,
  diagnostic,
}: {
  src: string;
  initial: string;
  imgClassName: string;
  glyphClassName: string;
  diagnostic: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <span className={glyphClassName}>{initial}</span>
    );
  }

  return (
    <img
      className={imgClassName}
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        console.warn('[project-cover] failed to load image cover:', diagnostic);
        setFailed(true);
      }}
    />
  );
}
