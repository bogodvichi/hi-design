const { createKnex } = require('../app/utils/knex.js');

const dbConfig = {
  host: '10.17.68.13',
  port: '5432',
  user: 'yapovichi',
  password: 'e6a22c32a1fb66309c8b9497952b4639',
  database: 'hidesign',
};

const knex = createKnex(dbConfig);

async function main() {
  await knex.raw(`
    ALTER TABLE workspace_members
    ADD CONSTRAINT fk_workspace_members_workspace
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(workspace_id)
    ON DELETE CASCADE;
  `);
  console.log('级联删除配置成功');

  const rows = await knex.raw(`
    SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
           ccu.table_name AS foreign_table, ccu.column_name AS foreign_column,
           rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    LEFT JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    LEFT JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'workspace_members'
      AND tc.constraint_type = 'FOREIGN KEY';
  `);
  console.table(rows.rows);

  await knex.destroy();
}

main().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
