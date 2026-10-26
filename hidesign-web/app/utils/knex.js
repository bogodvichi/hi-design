let knex;

function createKnex(config = {}) {
  if (!knex) {
    knex = require('knex')({
      client: 'pg',
      connection: {
        ...config,
        // Fail fast when the DB host is unreachable instead of hanging
        // for the full pool acquire timeout.
        connectionTimeoutMillis: 5000,
      },
      // Each Egg worker owns a pool. Keep idle connections releasable and
      // budget the aggregate across every service sharing this database.
      // The start script uses four workers: at most eight connections/service.
      // PostgreSQL 53300 is an error code, not the connection capacity.
      pool: {
        min: 0,
        max: 2,
        idleTimeoutMillis: 30000,
        // Propagate connection creation errors so callers see the real
        // failure (e.g. DB unreachable) instead of a generic pool timeout.
        propagateCreateError: true,
        // Fail fast when the pool is exhausted instead of hanging for
        // the default 60s — 10s is enough for normal query completion.
        acquireTimeoutMillis: 10000,
        // Give up creating a new physical connection after 10s instead of
        // the default 30s, so the pool can report the error sooner.
        createTimeoutMillis: 10000,
      },
    });
    console.log('KNEX 初始化完成');
  }
  return knex;
}

module.exports = {
  createKnex,
};
