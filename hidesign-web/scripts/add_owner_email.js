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
  // 幂等添加 owner_email 列：已存在则跳过，不存在则 ALTER TABLE。
  const exists = await knex.raw(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'owner_email'
  `);
  if (exists.rows.length > 0) {
    console.log('owner_email 列已存在，跳过');
  } else {
    await knex.raw(`
      ALTER TABLE workspaces
      ADD COLUMN owner_email VARCHAR(255);
    `);
    console.log('owner_email 列添加成功');
  }

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
