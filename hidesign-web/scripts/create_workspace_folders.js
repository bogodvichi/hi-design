const { createKnex } = require('../app/utils/knex.js');

const dbConfig = {
  host: '10.17.68.13',
  port: '5432',
  user: 'yapovichi',
  password: 'e6a22c32a1fb66309c8b9497952b4639',
  database: 'hidesign',
};

const knex = createKnex(dbConfig);

const sql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
`;

async function main() {
  await knex.raw(sql);
  console.log('建表成功: folders (folder_id/folder_pid 为 UUID, folder_id 由数据库默认生成)');

  const rows = await knex.raw(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'folders'
    ORDER BY ordinal_position
  `);
  console.table(rows.rows);

  await knex.destroy();
}

main().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
