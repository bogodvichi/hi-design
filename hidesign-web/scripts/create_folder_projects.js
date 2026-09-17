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
  console.log('建表成功: folder_projects (folder_id 为 UUID)');

  const rows = await knex.raw(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'folder_projects'
    ORDER BY ordinal_position
  `);
  console.table(rows.rows);

  await knex.destroy();
}

main().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
