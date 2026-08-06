import { Pool } from "pg";
import { logger } from "./logger";

// Dedicated small pool for authentication queries only.
// Kept separate from the main pool so blockchain sync / wave-auto-trigger
// activity can never starve login requests — even when the main pool is fully
// occupied, auth always has up to 2 connections available.
let _authPool: Pool | null = null;

export function getAuthPool(): Pool {
  if (_authPool) return _authPool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _authPool = new Pool({
    connectionString:        url,
    ssl:                     (url.includes("localhost") || url.includes("127.0.0.1"))
                               ? false
                               : { rejectUnauthorized: false },
    max:                         2,
    min:                         1,        // keep 1 warm — Railway proxy can be slow on cold connect
    idleTimeoutMillis:           0,        // never drop the warm connection
    connectionTimeoutMillis:     30_000,   // match main pool; 8s was too short for Railway
    keepAlive:                   true,
    keepAliveInitialDelayMillis: 5_000,
  });
  _authPool.on("error", (err) => {
    logger.warn("[auth-pool] idle client error", err);
  });
  return _authPool;
}

const authPool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getAuthPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default authPool;
