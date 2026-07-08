import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listWaves() {
  const { rows } = await pool.query("SELECT * FROM wave_list()");
  return toCamel(rows);
}

export async function getWave(id: string) {
  const { rows } = await pool.query("SELECT * FROM wave_get($1::uuid)", [id]);
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function updateWave(id: string, params: {
  defaultPriceEth?: number | null;
  saleMethod?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  status?: string | null;
  notes?: string | null;
  clearSchedule?: boolean;
}) {
  const { defaultPriceEth, saleMethod, scheduledStart, scheduledEnd, status, notes, clearSchedule } = params;
  const { rows } = await pool.query(
    `SELECT * FROM wave_upsert($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      defaultPriceEth ?? null,
      saleMethod      ?? null,
      scheduledStart  ?? null,
      scheduledEnd    ?? null,
      status          ?? null,
      notes           ?? null,
      clearSchedule   ?? false,
    ]
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}
