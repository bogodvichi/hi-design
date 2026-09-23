import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { c as createTar } from 'tar';

import {
  detectCommunityArchiveFormat,
  extractCommunityArchive,
} from '../src/community-archive.js';

const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('community archive extraction', () => {
  it('detects and extracts ZIP archives published by publish-community', async () => {
    const root = await makeTempRoot('od-community-zip-');
    const destination = path.join(root, 'extract');

    const zip = new JSZip();
    zip.file('index.html', '<!doctype html><h1>ZIP preview</h1>');
    zip.file('assets/app.js', 'console.log("zip");');
    const archive = await zip.generateAsync({ type: 'nodebuffer' });

    expect(detectCommunityArchiveFormat(archive)).toBe('zip');
    await expect(extractCommunityArchive(archive, destination)).resolves.toBe('zip');
    await expect(readFile(path.join(destination, 'index.html'), 'utf8'))
      .resolves.toContain('ZIP preview');
    await expect(readFile(path.join(destination, 'assets/app.js'), 'utf8'))
      .resolves.toContain('console.log');
  });

  it('detects and extracts tar.gz archives from legacy / CLI publishing', async () => {
    const root = await makeTempRoot('od-community-tar-');
    const source = path.join(root, 'source');
    const destination = path.join(root, 'extract');
    const archivePath = path.join(root, 'community.tgz');

    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'index.html'), '<!doctype html><h1>TAR preview</h1>');
    await createTar({ cwd: source, gzip: true, file: archivePath }, ['index.html']);
    const archive = await readFile(archivePath);

    expect(detectCommunityArchiveFormat(archive)).toBe('tar');
    await expect(extractCommunityArchive(archive, destination)).resolves.toBe('tar');
    await expect(readFile(path.join(destination, 'index.html'), 'utf8'))
      .resolves.toContain('TAR preview');
  });

  it('removes stale partial extraction state when the archive is invalid', async () => {
    const root = await makeTempRoot('od-community-invalid-');
    const destination = path.join(root, 'extract');

    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'archive.tgz'), 'stale partial archive');

    await expect(
      extractCommunityArchive(Buffer.from('not-an-archive'), destination),
    ).rejects.toThrow('unsupported community archive format');

    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
