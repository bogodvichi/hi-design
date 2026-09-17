// Skill cloud-upload helper: writes uploaded files (or extracted zip
// contents) to a temp directory so the HDW resource adapter can scan and
// publish them to the cloud WITHOUT touching the local .od/skills root.
//
// The browser sends files as multipart form data. For a .zip archive the
// daemon receives the raw blob, extracts it here, and locates the
// directory that contains SKILL.md. For a folder upload the browser
// sends individual files with their relative paths; the daemon writes
// them verbatim. For a single SKILL.md the browser sends one file.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { validateProjectPath } from '../projects.js';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const MAX_FILES = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  isDirectory: boolean;
}

export interface PreparedSkillDir {
  /** Absolute path to the directory the HDW adapter should scan. */
  dir: string;
  /** Slug derived from the skill name or folder name. */
  slug: string;
  /** Display title (from SKILL.md frontmatter or fallback). */
  title: string;
  /** Temp root that should be cleaned up after publish. */
  tempRoot: string;
}

/**
 * Extract a .zip buffer to a temp directory and return the subdirectory
 * that contains SKILL.md. If SKILL.md lives at the archive root the
 * temp directory itself is returned.
 */
export async function prepareSkillFromZip(
  zipBuffer: Buffer,
  tempRoot: string,
): Promise<PreparedSkillDir> {
  const entries = readCentralDirectory(zipBuffer);
  const files = extractFiles(zipBuffer, entries);

  const skillEntry = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  if (!skillEntry) {
    throw new Error('SKILL.md not found in zip archive');
  }

  // Determine the common prefix (the folder containing SKILL.md).
  const skillDir = path.dirname(skillEntry.path);
  const prefix = skillDir === '.' ? '' : skillDir + '/';

  // Strip the common prefix so files land directly under the temp dir.
  const writeDir = skillDir === '.' ? tempRoot : path.join(tempRoot, path.basename(skillDir));
  await mkdir(writeDir, { recursive: true });

  let totalBytes = 0;
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const relPath = file.path.slice(prefix.length);
    if (!relPath) continue;
    const validated = validateProjectPath(relPath);
    const target = safeJoin(writeDir, validated);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.body);
    totalBytes += file.body.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('zip contents exceed size limit');
    }
  }

  const { slug, title } = parseSkillMetadata(skillEntry.body.toString('utf8'), skillDir);
  return { dir: writeDir, slug, title, tempRoot };
}

/**
 * Write individual files (from a folder pick or single SKILL.md) to a
 * temp directory.
 */
export async function prepareSkillFromFiles(
  files: { path: string; body: Buffer }[],
  tempRoot: string,
): Promise<PreparedSkillDir> {
  if (files.length === 0) throw new Error('no files provided');

  const skillEntry = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  if (!skillEntry) throw new Error('SKILL.md not found among uploaded files');

  // Determine the common prefix (the folder containing SKILL.md).
  const skillDir = path.dirname(skillEntry.path);
  const prefix = skillDir === '.' ? '' : skillDir + '/';

  const writeDir = skillDir === '.' ? tempRoot : path.join(tempRoot, path.basename(skillDir));
  await mkdir(writeDir, { recursive: true });

  let totalBytes = 0;
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const relPath = file.path.slice(prefix.length);
    if (!relPath) continue;
    const validated = validateProjectPath(relPath);
    const target = safeJoin(writeDir, validated);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.body);
    totalBytes += file.body.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('uploaded files exceed size limit');
    }
  }

  const { slug, title } = parseSkillMetadata(skillEntry.body.toString('utf8'), skillDir);
  return { dir: writeDir, slug, title, tempRoot };
}

/** Clean up the temp directory after publish (best-effort). */
export async function cleanupSkillTempDir(tempRoot: string): Promise<void> {
  await rm(tempRoot, { recursive: true, force: true });
}

// --- internals ---

function parseSkillMetadata(
  content: string,
  fallbackFolder: string,
): { slug: string; title: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let name = '';
  if (match) {
    const block = match[1] ?? '';
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      name = nameMatch[1]!.trim().replace(/^["']|["']$/g, '').trim();
    }
  }
  const title = name || fallbackFolder || 'skill';
  const slug = slugify(title);
  return { slug, title };
}

function slugify(name: string): string {
  const lowered = name.trim().toLowerCase();
  const cleaned = lowered
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return cleaned.slice(0, 64) || 'skill';
}

function readCentralDirectory(zip: Buffer): ZipEntry[] {
  const eocdOffset = findEocd(zip);
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  const centralSize = zip.readUInt32LE(eocdOffset + 12);
  const centralOffset = zip.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > zip.length) {
    throw new Error('invalid zip central directory');
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error('invalid zip central directory entry');
    }
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if ((flags & 1) !== 0) throw new Error('encrypted zip entries are not supported');
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported zip compression method: ${method}`);
    }
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory: name.endsWith('/'),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(zip: Buffer): number {
  const min = Math.max(0, zip.length - 0xffff - 22);
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('invalid zip: missing central directory');
}

function extractFiles(zip: Buffer, entries: ZipEntry[]): { path: string; body: Buffer }[] {
  const files: { path: string; body: Buffer }[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (files.length >= MAX_FILES) throw new Error('zip contains too many files');

    const relPath = sanitizeZipPath(entry.name);
    if (entry.uncompressedSize > MAX_FILE_BYTES) {
      throw new Error(`zip file too large: ${relPath}`);
    }

    const body = readEntryBody(zip, entry);
    if (body.length > MAX_FILE_BYTES) {
      throw new Error(`zip file too large: ${relPath}`);
    }

    totalBytes += body.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('zip is too large');

    files.push({ path: relPath, body });
  }
  return files;
}

function readEntryBody(zip: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localOffset;
  if (zip.readUInt32LE(offset) !== LOCAL_SIG) {
    throw new Error(`invalid zip local header: ${entry.name}`);
  }
  const nameLen = zip.readUInt16LE(offset + 26);
  const extraLen = zip.readUInt16LE(offset + 28);
  const bodyStart = offset + 30 + nameLen + extraLen;
  const bodyEnd = bodyStart + entry.compressedSize;
  if (bodyEnd > zip.length) {
    throw new Error(`zip entry exceeds archive: ${entry.name}`);
  }
  const compressed = zip.subarray(bodyStart, bodyEnd);
  if (entry.method === 0) return Buffer.from(compressed);
  if (compressed.length === 0) return Buffer.alloc(0);
  const cap = entry.uncompressedSize > 0 ? entry.uncompressedSize : MAX_FILE_BYTES;
  return inflateRawSync(compressed, { maxOutputLength: cap });
}

function sanitizeZipPath(name: string): string {
  if (name.includes('\0')) throw new Error('invalid zip file name');
  const normalized = name.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith('/')) {
    throw new Error('absolute zip paths are not allowed');
  }
  return validateProjectPath(normalized);
}

function safeJoin(root: string, relPath: string): string {
  const target = path.resolve(root, relPath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('path escapes temp dir');
  }
  return target;
}
