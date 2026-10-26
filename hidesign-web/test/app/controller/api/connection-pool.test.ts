import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('default worker pools fit the shared 100-connection database and release idle sessions', () => {
  const root = new URL('../../../../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const workers = Number(/--workers=(\d+)/.exec(pkg.scripts.start)?.[1]);
  assert.equal(workers, 4);
  const module = { exports: {} as any };
  let options: any;
  let created = 0;
  const pool = {};
  runInNewContext(readFileSync(new URL('app/utils/knex.js', root), 'utf8'), {
    module, console: { log() {} }, require(name: string) {
      assert.equal(name, 'knex');
      return (config: unknown) => { created++; options = config; return pool; };
    },
  });
  assert.equal(module.exports.createKnex({ host: 'database' }), pool);
  assert.equal(module.exports.createKnex({ host: 'database' }), pool);
  assert.equal(created, 1);
  assert.equal(options.pool.min, 0);
  assert.equal(options.pool.max, 2);
  assert.ok(2 * workers * options.pool.max < 100 - 3);
  assert.equal(options.connection.host, 'database');
});
