import { Pool } from "pg";
import { logger } from "./logger";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString:            url,
    ssl:                         (url.includes("localhost") || url.includes("127.0.0.1"))
                                   ? false
                                   : { rejectUnauthorized: false },
    // Keep total connections well under Railway's per-database limit (~25).
    // auth-pool.ts holds 2 more → total from this process = 7 max.
    max:                         5,
    min:                         1,
    idleTimeoutMillis:           0,
    connectionTimeoutMillis:     30_000,
    keepAlive:                   true,
    keepAliveInitialDelayMillis: 5_000,
  });
  _pool.on("error", (err) => {
    logger.warn("[pool] idle client error", err);
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
