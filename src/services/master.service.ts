import pool from "../pool";

export async function getMasterData() {
  const { rows } = await pool.query("SELECT master_get_all() AS data");
  return rows[0]?.data ?? null;
}
