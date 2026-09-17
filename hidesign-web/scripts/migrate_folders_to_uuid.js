const { createKnex } = require('../app/utils/knex.js');

const dbConfig = {
  host: '10.17.68.13',
  port: '5432',
  user: 'yapovichi',
  password: 'e6a22c32a1fb66309c8b9497952b4639',
  database: 'hidesign',
};

const knex = createKnex(dbConfig);

// 旧表 folder_id/folder_pid 为 VARCHAR(64)，数据由 createFolderId() 生成的
// 短字母数字 ID（非 UUID）。直接 ALTER COLUMN ... TYPE UUID 会因格式不兼容
// 而失败，因此先 DROP 再用新 schema 重建。
const sql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DROP TABLE IF EXISTS folder_projects;
DROP TABLE IF EXISTS folders;

CREATE TABLE IF NOT EXISTS folders (
  folder_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
  folder_pid       UUID,
  workspace_id     VARCHAR(64)  NOT NULL,
  folder_name      VARCHAR(255) NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (folder_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (folder_pid) REFERENCES folders(folder_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folder_projects (
  folder_id        UUID         NOT NULL,
  project_id       VARCHAR(64)  NOT NULL,
  workspace_id     VARCHAR(64)  NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (folder_id, project_id),
  FOREIGN KEY (folder_id) REFERENCES folders(folder_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE
);
`;

async function main() {
  await knex.raw(sql);
  console.log('迁移成功: folders + folder_projects 已重建为 UUID 类型');

  const rows = await knex.raw(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name IN ('folders', 'folder_projects')
    ORDER BY table_name, ordinal_position
  `);
  console.table(rows.rows);

  await knex.destroy();
}

main().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
