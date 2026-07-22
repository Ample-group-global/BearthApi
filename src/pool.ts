import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString:        url,
    ssl:                     { rejectUnauthorized: false },
    max:                     10,
    min:                     1,
    idleTimeoutMillis:       600_000,
    connectionTimeoutMillis: 30_000,
    keepAlive:               true,
    keepAliveInitialDelayMillis: 10_000,
  });
  _pool.on("error", (err) => {
    console.warn("[pool] idle client error:", err.message);
  });
  // Keep at least one connection warm with a periodic ping
  setInterval(async () => {
    try { await _pool!.query("SELECT 1"); } catch { /* ignore — pool reconnects */ }
  }, 60_000);
  return _pool;
}

// Proxy so callers use pool.query() / pool.connect() as before
const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default pool;
