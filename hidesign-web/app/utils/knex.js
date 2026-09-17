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
      // 限制连接池上限,避免多 worker 进程叠加后打满 PostgreSQL max_connections(53300)。
      // egg-scripts 默认按 CPU 核数启动 worker,每个 worker 各持一份单例 knex,
      // 故 max=2 × N 核仍有余量留给 daemon 及运维会话。min=0 空闲时不占连接。
      // 远程共享 PG (10.17.68.13) 的 max_connections 有限,多应用共用时
      // max=10 容易打满(53300),降到 2 即可满足单 worker 的并发查询需求。
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
