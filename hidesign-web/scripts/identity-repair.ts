// Operator-only recovery tool. Node 24. Never run automatically on startup.
// Usage: DATABASE_URL=... node scripts/identity-repair.ts --plan plan.json
//        DATABASE_URL=... node scripts/identity-repair.ts --apply plan.json
//        DATABASE_URL=... node scripts/identity-repair.ts --rollback receipt.json
// Plan and receipt files contain identifiers; keep them private and out of Git.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { planIdentityRepairs, type IdentitySnapshot, type Repair } from './identity-repair-plan.ts';
const require = createRequire(import.meta.url);
const [mode, filename, option, ownersFile, ...extra] = process.argv.slice(2);
if (!['--plan', '--apply', '--rollback'].includes(mode) || !filename || !process.env.DATABASE_URL
  || extra.length || (option && (mode !== '--plan' || option !== '--confirmed-personal-owners' || !ownersFile))) {
  throw new Error('Supply DATABASE_URL and --plan, --apply, or --rollback followed by a private JSON file');
}
const knex = require('knex')({ client: 'pg', connection: process.env.DATABASE_URL });
const tables = ['workspace_members', 'resources', 'resource_versions', 'team_projects', 'workspace_project_shares', 'folder_shares', 'folders'] as const;
try {
  await knex.transaction(async (trx: any) => {
    await trx.raw(mode === '--plan'
      ? 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
      : 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const database = (await trx.raw('SELECT current_database() AS name')).rows[0].name;
    if (mode === '--plan') {
      const snapshot = Object.fromEntries(await Promise.all(tables.map(async table => [table, await trx(table).select('*')]))) as unknown as IdentitySnapshot;
      const confirmedPersonalOwners = ownersFile ? JSON.parse(readFileSync(ownersFile, 'utf8')) : [];
      writeFileSync(filename, JSON.stringify({ version: 1, database, confirmedPersonalOwners, ...planIdentityRepairs(snapshot, confirmedPersonalOwners) }, null, 2), { mode: 0o600, flag: 'wx' });
      return;
    }
    const plan = JSON.parse(readFileSync(filename, 'utf8'));
    if (plan.version !== 1 || plan.database !== database || !Array.isArray(plan.repairs)) throw new Error('Invalid plan or wrong database');
    // Bound operator batch; wait at most five seconds, then leave all rows alone.
    await trx.raw("SET LOCAL lock_timeout = '5s'");
    await trx.raw("SET LOCAL statement_timeout = '60s'");
    if (mode === '--apply') {
      const snapshot = Object.fromEntries(await Promise.all(tables.map(async table => [table, await trx(table).select('*')]))) as unknown as IdentitySnapshot;
      const fresh = planIdentityRepairs(snapshot, plan.confirmedPersonalOwners).repairs;
      for (const repair of plan.repairs as Repair[]) {
        if (fresh.some(candidate => JSON.stringify(candidate) === JSON.stringify(repair))) continue;
        const rows = snapshot[repair.table];
        if (!rows?.some(row => Object.entries(repair.key).every(([key, value]) => row[key] === value) && Object.entries(repair.after).every(([key, value]) => row[key] === value))) throw new Error('Plan is stale or changed; regenerate and review it');
      }
    }
    let changed = 0;
    for (const repair of (mode === '--rollback' ? [...plan.repairs].reverse() : plan.repairs) as Repair[]) {
      if (!['resources', 'team_projects', 'workspace_project_shares', 'folders', 'workspace_members'].includes(repair.table)) throw new Error('Invalid repair table');
      const allowed = repair.table === 'workspace_members' ? ['username'] : repair.table === 'folders' ? ['owner_member_id'] : repair.table === 'workspace_project_shares' ? ['home_workspace_id'] : ['owner_member_id', 'resource_id'];
      if ([...Object.keys(repair.before), ...Object.keys(repair.after)].some(key => !allowed.includes(key))) throw new Error('Invalid repair columns');
      const keyColumns = repair.table === 'workspace_members' ? ['workspace_id', 'workspace_member_id'] : [repair.table === 'folders' ? 'folder_id' : 'id'];
      if (Object.keys(repair.key).length !== keyColumns.length || keyColumns.some(key => !Object.hasOwn(repair.key, key))) throw new Error('Invalid repair key');
      const before = mode === '--rollback' ? repair.after : repair.before;
      const after = mode === '--rollback' ? repair.before : repair.after;
      const current = await trx(repair.table).where(repair.key).forUpdate().first();
      if (current && Object.keys(after).every(key => (current[key] ?? null) === after[key])) continue;
      if (!current || Object.keys(before).some(key => (current[key] ?? null) !== before[key])) throw new Error('Concurrent change detected; no repair applied');
      await trx(repair.table).where(repair.key).update(after);
      changed++;
    }
    // An identical retry must not fail merely because the first run's private
    // receipt already exists. Preserve it, and leave every row untouched.
    if (changed === 0) return;
    // Write before commit: failure to persist the recovery receipt aborts SQL.
    writeFileSync(filename + (mode === '--apply' ? '.receipt.json' : '.rollback.json'), JSON.stringify({ ...plan, executedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' });
  });
  console.log(mode === '--plan' ? 'Review the plan and unresolved records before applying.' : 'Transaction completed; retain the plan and receipt for recovery.');
} finally { await knex.destroy(); }
