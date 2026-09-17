'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const blobStore = require('./app/utils/blob-store.js');

// App lifecycle: initialize blob store on startup.
// Database tables are created manually via scripts/*.sql — see scripts/001_resource_hub.sql.
module.exports = app => {
  if (app.config.himind.mcpCaFile && !app.config.himind.mcpCaCertificate) {
    app.logger.error(
      '[himind-mcp] failed to load internal CA file %s: %s',
      app.config.himind.mcpCaFile,
      app.config.himind.mcpCaLoadError || 'unknown error'
    );
  }
  if (
    app.config.himind.mcpJwtPrivateKeyFile
    && !app.config.himind.mcpJwtPrivateKey
  ) {
    app.logger.error(
      '[himind-mcp] failed to load JWT private key file %s: %s',
      app.config.himind.mcpJwtPrivateKeyFile,
      app.config.himind.mcpJwtPrivateKeyLoadError || 'unknown error'
    );
  }
  // Init blob store directory.
  const blobDir = app.config.blobDir || path.join(app.baseDir, 'data', 'blobs');
  fs.mkdir(blobDir, { recursive: true }).then(() => {
    blobStore.init(blobDir);
    app.logger.info('[hdw] blob store initialized at %s', blobDir);
  }).catch(err => {
    app.logger.error('[hdw] blob store init failed:', err);
  });

  // 退出/重启前关闭 knex 连接池,避免连接残留导致 PostgreSQL 53300(too_many_connections)。
  app.beforeClose(async () => {
    try {
      const { createKnex } = require('./app/utils/knex.js');
      await createKnex().destroy();
      app.logger.info('[hdw] knex pool closed');
    } catch (err) {
      app.logger.error('[hdw] knex pool close failed:', err);
    }
  });
};
