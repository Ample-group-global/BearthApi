import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const parsed = new URL(url);
  _pool = new Pool({
    host:     parsed.hostname,
    port:     Number(parsed.port) || 5432,
    user:     decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    ssl:      { rejectUnauthorized: false },
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
