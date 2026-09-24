import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import JSZip from 'jszip';
import { x as extractTar } from 'tar';

export type CommunityArchiveFormat = 'zip' | 'tar';

function safeArchiveRelativePath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\0')) {
    throw new Error('archive contains an invalid path');
  }
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`archive contains an unsafe path: ${rawPath}`);
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('archive contains an invalid path');
  }
  return segments.join('/');
}

export function detectCommunityArchiveFormat(buffer: Buffer): CommunityArchiveFormat {
  const isZip = buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (
      (buffer[2] === 0x03 && buffer[3] === 0x04)
      || (buffer[2] === 0x05 && buffer[3] === 0x06)
      || (buffer[2] === 0x07 && buffer[3] === 0x08)
    );
  if (isZip) return 'zip';

  const isGzip = buffer.length >= 2
    && buffer[0] === 0x1f
    && buffer[1] === 0x8b;
  const isTar = buffer.length >= 262
    && buffer.subarray(257, 262).toString('ascii') === 'ustar';
  if (isGzip || isTar) return 'tar';

  throw new Error('unsupported community archive format');
}

async function extractZip(buffer: Buffer, destination: string): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length === 0) throw new Error('ZIP archive contains no files');

  for (const entry of entries) {
    const relativePath = safeArchiveRelativePath(entry.name);
    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new Error(`ZIP archive contains a symbolic link: ${entry.name}`);
    }

    const outputPath = path.join(destination, ...relativePath.split('/'));
    if (entry.dir) {
      await fs.mkdir(outputPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, await entry.async('nodebuffer'));
  }
}

async function extractTarArchive(buffer: Buffer, destination: string): Promise<void> {
  const archivePath = path.join(destination, '.community-archive.tmp');
  await fs.writeFile(archivePath, buffer);
  let unsafeEntry: string | null = null;

  try {
    await pipeline(
      createReadStream(archivePath),
      extractTar({
        cwd: destination,
        strict: true,
        filter: (entryPath, entry) => {
          try {
            safeArchiveRelativePath(entryPath);
          } catch {
            unsafeEntry = entryPath;
            return false;
          }
          const type = (entry as { type?: string }).type;
          if (type === 'SymbolicLink' || type === 'Link') {
            unsafeEntry = entryPath;
            return false;
          }
          return true;
        },
      }) as NodeJS.WritableStream,
    );
    if (unsafeEntry) {
      throw new Error(`tar archive contains an unsafe entry: ${unsafeEntry}`);
    }
  } finally {
    await fs.rm(archivePath, { force: true }).catch(() => {});
  }
}

export async function extractCommunityArchive(
  buffer: Buffer,
  destination: string,
): Promise<CommunityArchiveFormat> {
  await fs.rm(destination, { recursive: true, force: true });

  let format: CommunityArchiveFormat;
  try {
    format = detectCommunityArchiveFormat(buffer);
  } catch (error) {
    throw error;
  }

  await fs.mkdir(destination, { recursive: true });

  try {
    if (format === 'zip') {
      await extractZip(buffer, destination);
    } else {
      await extractTarArchive(buffer, destination);
    }
    return format;
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
