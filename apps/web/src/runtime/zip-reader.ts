// Minimal ZIP reader for the browser. Parses the central directory to
// enumerate entries, then reads local file data. Supports stored
// (method 0) and deflated (method 8) entries via
// DecompressionStream('deflate-raw'), which is available in all modern
// browsers (Chrome 80+, Firefox 113+, Safari 16.4+).

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;

export async function readZipEntries(
  blob: Blob,
): Promise<Map<string, Uint8Array>> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buffer.buffer);

  const eocdOffset = findEocd(buffer, view);
  if (eocdOffset < 0) throw new Error('Invalid ZIP: end-of-central-directory not found');

  const cdEntryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map<string, Uint8Array>();
  let offset = cdOffset;

  for (let i = 0; i < cdEntryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder().decode(nameBytes);

    // Skip directory entries (names ending with /).
    if (name.endsWith('/')) {
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }

    // Read the local file header to find the actual data offset.
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = compressedData;
    } else if (method === 8) {
      data = await inflateRaw(compressedData);
    } else {
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }

    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEocd(buffer: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const DsCtor = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!DsCtor) throw new Error('DecompressionStream is not available');

  const ds = new DsCtor('deflate-raw');
  const writer = ds.writable.getWriter();
  // Copy into a fresh ArrayBuffer-backed view so the type matches
  // BufferSource (which excludes SharedArrayBuffer-backed views).
  writer.write(new Uint8Array(compressed));
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let p = 0;
  for (const chunk of chunks) {
    result.set(chunk, p);
    p += chunk.length;
  }
  return result;
}

/** Find and return the text content of SKILL.md inside a ZIP blob. */
export async function findSkillMdInZip(blob: Blob): Promise<string | null> {
  const entries = await readZipEntries(blob);
  for (const [name, data] of entries) {
    if (/(^|\/)SKILL\.md$/i.test(name)) {
      return new TextDecoder().decode(data);
    }
  }
  return null;
}

/** Derive the skill folder name from a ZIP entry path like "my-skill/SKILL.md". */
export function deriveSkillNameFromZipPath(path: string): string {
  const parts = path.split('/');
  // If the path has at least two segments, the first is the folder name.
  if (parts.length >= 2) return parts[0] ?? '';
  // Otherwise, strip the extension from the filename.
  return parts[0]?.replace(/\.md$/i, '') ?? '';
}
