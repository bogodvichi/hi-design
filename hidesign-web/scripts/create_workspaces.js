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
CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id        VARCHAR(64)  NOT NULL,
  workspace_name      VARCHAR(255) NOT NULL,
  owner_username      VARCHAR(128) NOT NULL,
  owner_displayname   VARCHAR(128),
  owner_email         VARCHAR(255),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id)
);
`;

async function main() {
  await knex.raw(sql);
  console.log('建表成功');

  const rows = await knex.raw(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'workspaces'
    ORDER BY ordinal_position
  `);
  console.table(rows.rows);

  await knex.destroy();
}

main().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
