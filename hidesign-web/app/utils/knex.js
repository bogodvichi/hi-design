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
      // egg-scripts 默认按 CPU 核数启动 worker,每个 worker 各持一份单例 knex。
      // max=10 × N 核仍远低于 PostgreSQL max_connections(53300),留有充足余量。
      // min=2 保持预热连接,避免冷启动延迟;空闲后 30s 回收至 min。
      pool: {
        min: 2,
        max: 20,
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
