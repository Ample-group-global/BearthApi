import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listReconciliation(params: {
  status?: string | null; orderId?: string | null; limit?: number; offset?: number;
}) {
  const { status = null, orderId = null, limit = 100, offset = 0 } = params;
  const { rows } = await pool.query("SELECT * FROM reconciliation_list($1, $2, $3, $4)", [status, orderId, limit, offset]);
  return { entries: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

export async function getReconciliation(id: string) {
  const { rows } = await pool.query("SELECT * FROM reconciliation_get($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function confirmReconciliation(id: string, notes?: string) {
  const { rows } = await pool.query("SELECT * FROM reconciliation_confirm($1::uuid, $2)", [id, notes ?? null]);
  return rows[0] ?? null;
}

export async function cancelReconciliation(id: string, notes?: string) {
  const { rows } = await pool.query("SELECT * FROM reconciliation_cancel($1::uuid, $2)", [id, notes ?? null]);
  return rows[0] ?? null;
}
