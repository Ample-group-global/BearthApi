import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listReferrers(search?: string | null) {
  const { rows } = await pool.query("SELECT * FROM referrers_list($1)", [search ?? null]);
  return toCamel(rows);
}

export async function createReferrer(params: {
  firstName: string; lastName?: string; phone?: string; email?: string;
}) {
  const { firstName, lastName, phone, email } = params;
  const { rows } = await pool.query(
    "SELECT * FROM referrers_create($1, $2, $3, $4)",
    [firstName, lastName ?? null, phone ?? null, email ?? null]
  );
  return rows[0] ?? null;
}
