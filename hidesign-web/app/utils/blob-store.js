'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Blob storage on local disk. Blobs are stored as raw files keyed by their
// sha256 digest. Path layout: <blobDir>/<first2>/<digest> to avoid having
// too many files in a single directory.
//
// The blobs table holds the storage_path column; this module owns the
// filesystem side. A future S3 backend would swap this module out.

let blobDir = '';

function init(dir) {
  blobDir = dir;
}

function getDir() {
  if (!blobDir) {
    throw new Error('blob store not initialized — call init first');
  }
  return blobDir;
}

function blobPath(digest) {
  const prefix = digest.slice(0, 2);
  return path.join(getDir(), prefix, digest);
}

async function exists(digest) {
  try {
    await fs.access(blobPath(digest));
    return true;
  } catch {
    return false;
  }
}

async function writeBlob(digest, data) {
  const p = blobPath(digest);
  await fs.mkdir(path.dirname(p), { recursive: true });
  // Verify the content matches the declared digest.
  const actual = crypto.createHash('sha256').update(data).digest('hex');
  if (actual !== digest) {
    throw new Error(`blob digest mismatch: declared ${digest}, actual ${actual}`);
  }
  await fs.writeFile(p, data);
}

async function readBlob(digest) {
  return fs.readFile(blobPath(digest));
}

module.exports = {
  init,
  getDir,
  blobPath,
  exists,
  writeBlob,
  readBlob,
};
