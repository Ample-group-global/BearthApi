import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString:            url,
    ssl:                         { rejectUnauthorized: false },
    max:                         10,
    min:                         1,
    idleTimeoutMillis:           15_000,
    connectionTimeoutMillis:     8_000,
    keepAlive:                   true,
    keepAliveInitialDelayMillis: 5_000,
  });
  _pool.on("error", (err) => {
    console.warn("[pool] idle client error:", err.message);
  });
  // Ping every 10s to keep Railway idle connections alive.
  // Skip ping when pool is fully loaded — a connection timeout under heavy load is NOT
  // a dead pool. Only recreate if pool truly has zero connections (all dropped by Railway).
  const schedulePing = () => setTimeout(async () => {
    const p = _pool;
    if (!p) return;
    if (p.idleCount === 0) {
      // Pool is fully busy — skip ping, reschedule
      schedulePing();
      return;
    }
    try {
      await p.query("SELECT 1");
    } catch {
      if (p.totalCount === 0) {
        console.warn("[pool] ping failed with no active connections — recreating pool");
        _pool = null;
        p.end().catch(() => {});
        getPool();
      } else {
        console.warn("[pool] ping error but pool still has connections — skipping recreation");
      }
    }
    schedulePing();
  }, 10_000);
  schedulePing();
  return _pool;
}

// Proxy so callers use pool.query() / pool.connect() as before
const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default pool;
