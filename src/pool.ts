import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString:            url,
    ssl:                         { rejectUnauthorized: false },
    max:                         4,
    min:                         1,
    idleTimeoutMillis:           15_000,
    connectionTimeoutMillis:     8_000,
    keepAlive:                   true,
    keepAliveInitialDelayMillis: 5_000,
  });
  _pool.on("error", (err) => {
    console.warn("[pool] idle client error:", err.message);
  });
  // Ping every 10s; recreate pool if ping fails (Railway drops idle connections)
  const schedulePing = () => setTimeout(async () => {
    const p = _pool;
    if (!p) return; // pool was already reset
    try {
      await p.query("SELECT 1");
    } catch {
      console.warn("[pool] ping failed — recreating pool");
      _pool = null;
      p.end().catch(() => {});
      getPool(); // immediately create fresh pool
    }
    schedulePing(); // reschedule regardless of outcome
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
