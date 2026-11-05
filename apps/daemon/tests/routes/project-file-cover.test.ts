import express from 'express';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopExportArtifactInput } from '@open-design/sidecar-proto';
import * as projectFiles from '../../src/projects.js';
import { registerProjectFileRoutes, registerProjectUploadRoutes } from '../../src/routes/project/index.js';

describe('file project cover generation', () => {
  it.each(['text', 'image', 'empty', 'existing', 'missing-file', 'denied'])('repairs a historical cover on read: %s', async (kind) => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-historical-cover-'));
    const projectsDir = path.join(root, 'projects');
    const id = 'historical-project';
    const dir = path.join(projectsDir, id);
    await mkdir(dir, { recursive: true });
    const source = kind === 'image' ? 'picture.png' : 'notes.txt';
    const content = Buffer.from('Historical content <script>');
    if (kind !== 'empty') await writeFile(path.join(dir, source), content);
    const png = Buffer.from('historical-cover-png');
    const project = { id, name: 'Historical project', metadata: {}, coverDigest: ['existing', 'missing-file'].includes(kind) ? 'old-digest' : null as string | null };
    if (kind === 'existing') await writeFile(path.join(dir, '.cover.png'), png);
    const exporter = vi.fn(async (input: DesktopExportArtifactInput) => {
      if (kind === 'image') {
        const url = input.html.match(/src="(http:[^"]+)"/)![1]!;
        expect(Buffer.from(await (await fetch(url)).arrayBuffer())).toEqual(content);
      } else {
        expect(input.html).toContain('Historical content &lt;script&gt;');
      }
      const output = path.join(root, 'rendered.png');
      await writeFile(output, png);
      return { ok: true, path: output };
    });
    const updateProject = vi.fn((_db, _id, patch) => Object.assign(project, patch));
    const app = express();
    app.use(express.json());
    registerProjectFileRoutes(app, {
      db: {},
      http: { sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ code, message }) },
      paths: { PROJECTS_DIR: projectsDir, RUNTIME_DATA_DIR: root, DESIGN_SYSTEMS_DIR: '', USER_DESIGN_SYSTEMS_DIR: '' },
      uploads: { upload: {} }, node: { fs },
      projectStore: { getProject: () => project, getWorkspaceProject: () => null, getWorkspaceProjectByProjectId: () => null, updateProject },
      projectFiles, documents: {}, artifacts: {},
      authorizeProjectRequest: async (_req: unknown, res: express.Response) => {
        if (kind !== 'denied') return true;
        res.status(403).end();
        return false;
      },
      desktopArtifactExporter: exporter,
      daemonUrlRef: { current: 'http://127.0.0.1:1234' },
    } as unknown as Parameters<typeof registerProjectFileRoutes>[1]);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server did not start');
      const url = `http://127.0.0.1:${address.port}/api/projects/${id}/cover`;
      const responses = await Promise.all([fetch(url), fetch(url)]);
      for (const response of responses) {
        expect(response.status).toBe(kind === 'denied' ? 403 : kind === 'empty' ? 404 : 200);
        if (response.ok) {
          expect(response.headers.get('content-type')).toBe('image/png');
          expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
        }
      }
      expect(exporter).toHaveBeenCalledTimes(['empty', 'existing', 'denied'].includes(kind) ? 0 : 1);
      if (!['empty', 'denied'].includes(kind)) {
        expect((await fetch(url)).status).toBe(200);
        expect(await readFile(path.join(dir, '.cover.png'))).toEqual(png);
      }
      if (kind !== 'empty') expect(await readFile(path.join(dir, source))).toEqual(content);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['explicit', 'automatic-entry', 'file-upload', 'batch-upload'])('renders and persists a DOCX cover: %s', async (scenario) => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-file-cover-'));
    const projectsDir = path.join(root, 'projects');
    const id = 'document-project';
    const dir = path.join(projectsDir, id);
    await mkdir(dir, { recursive: true });
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:p><w:r><w:t>Document cover content</w:t></w:r></w:p></w:document>');
    const document = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(path.join(dir, 'guide.docx'), document);
    const png = Buffer.from('rendered-cover-png');
    const exporter = vi.fn(async (input: DesktopExportArtifactInput) => {
      expect(input.html).toContain('Document cover content');
      expect(input.viewportOnly).toBe(true);
      const output = path.join(root, 'rendered.png');
      await writeFile(output, png);
      return { ok: true, path: output };
    });
    const updateProject = vi.fn();
    const app = express();
    app.use(express.json());
    const deps = {
      db: {},
      http: { sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ code, message }) },
      paths: { PROJECTS_DIR: projectsDir, RUNTIME_DATA_DIR: root, DESIGN_SYSTEMS_DIR: '', USER_DESIGN_SYSTEMS_DIR: '' },
      uploads: {
        upload: { single: () => (_req: unknown, _res: unknown, next: () => void) => next() },
        handleProjectUpload: (req: express.Request, _res: express.Response, next: () => void) => {
          req.files = [{ path: path.join(dir, 'guide.docx'), filename: 'guide.docx', originalname: 'guide.docx' }] as Express.Multer.File[];
          next();
        },
      }, node: { fs },
      projectStore: {
        getProject: () => ({ id, name: 'Document project', metadata: {} }),
        getWorkspaceProject: () => null, getWorkspaceProjectByProjectId: () => null, updateProject,
      },
      projectFiles, documents: {}, artifacts: {},
      authorizeProjectRequest: async () => true,
      desktopArtifactExporter: exporter,
      daemonUrlRef: { current: 'http://127.0.0.1:1234' },
    } as unknown as Parameters<typeof registerProjectFileRoutes>[1];
    registerProjectFileRoutes(app, deps);
    registerProjectUploadRoutes(app, deps);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server did not start');
      const endpoint = scenario === 'file-upload' ? '/files' : scenario === 'batch-upload' ? '/upload'
        : `/cover/generate${scenario === 'explicit' ? '?file=guide.docx' : ''}`;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/${id}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'guide.docx', content: document.toString('base64'), encoding: 'base64', overwrite: true }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      if (!scenario.endsWith('upload')) {
        expect(await response.json()).toMatchObject({ code: 0, data: { coverDigest: expect.stringMatching(/^[a-f0-9]{64}$/) } });
      }
      await vi.waitFor(() => expect(updateProject).toHaveBeenCalledWith(expect.anything(), id, expect.objectContaining({ coverDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })));
      expect(exporter).toHaveBeenCalledOnce();
      expect(await readFile(path.join(dir, '.cover.png'))).toEqual(png);
      expect(await readFile(path.join(dir, 'guide.docx'))).toEqual(document);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
