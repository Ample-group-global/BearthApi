import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString:        url,
    ssl:                     { rejectUnauthorized: false },
    max:                     5,
    min:                     0,
    idleTimeoutMillis:       10_000,
    connectionTimeoutMillis: 30_000,
  });
  _pool.on("error", (err) => {
    console.warn("[pool] idle client error:", err.message);
  });
  return _pool;
}

// Proxy so callers use pool.query() / pool.connect() as before
const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default pool;
