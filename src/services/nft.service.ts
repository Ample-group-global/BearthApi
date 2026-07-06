import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listNft(params: {
  search?: string | null;
  deliveryStatusCode?: string | null;
  stageCode?: string | null;
  revealed?: boolean | null;
  waveId?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { search = null, deliveryStatusCode = null, stageCode = null, revealed = null, waveId = null, limit = 20, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_list($1, $2, $3, $4, $5, $6, $7)",
    [search, deliveryStatusCode, stageCode, revealed, waveId, limit, offset]
  );
  return { nftRecords: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

export async function getNft(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_get($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function createNft(params: {
  serialNumber: string; stageId: string;
  nftTypeId?: string; deliveryStatusId?: string; notes?: string;
}) {
  const { serialNumber, stageId, nftTypeId, deliveryStatusId, notes } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_create($1, $2, $3, $4, $5)",
    [serialNumber, stageId, nftTypeId ?? null, deliveryStatusId ?? null, notes ?? null]
  );
  return rows[0] ?? null;
}

export async function updateNft(id: string, params: {
  stageId?: string; nftTypeId?: string; deliveryStatusId?: string; notes?: string;
  waveId?: string; priceEth?: number | null; clearPriceEth?: boolean;
}) {
  const { stageId, nftTypeId, deliveryStatusId, notes, waveId, priceEth, clearPriceEth } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_update($1::uuid, $2, $3, $4, $5, $6, $7, $8)",
    [id, stageId ?? null, nftTypeId ?? null, deliveryStatusId ?? null, notes ?? null,
     waveId ?? null, priceEth ?? null, clearPriceEth ?? false]
  );
  return rows[0] ?? null;
}

export async function confirmNftDelivery(id: string, deliveryStatusId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM nft_confirm_delivery($1::uuid, $2)", [id, deliveryStatusId]
  );
  return rows[0] ?? null;
}

export async function bulkCreateNft(records: Array<{
  serialNumber: string;
  stageId?: string | null; stageName?: string | null; stageCode?: string | null;
  nftTypeId?: string | null; nftTypeName?: string | null;
  deliveryStatusId?: string | null; deliveryStatusCode?: string | null;
  notes?: string | null;
}>) {
  // Pre-fetch lookup tables once
  const [stagesRes, typesRes, statusRes] = await Promise.all([
    pool.query("SELECT id, code, name FROM nft_stages"),
    pool.query("SELECT id, code, name FROM nft_types"),
    pool.query("SELECT id, code, name FROM delivery_statuses"),
  ]);
  const stages   = stagesRes.rows;
  const types    = typesRes.rows;
  const statuses = statusRes.rows;

  const resolveId = (
    rows: Array<{ id: string; code: string; name: string }>,
    id?: string | null, name?: string | null, code?: string | null
  ): string | undefined => {
    if (id) return id;
    const q = (s: string) => s?.toLowerCase().trim();
    if (code) { const r = rows.find(x => q(x.code) === q(code)); if (r) return r.id; }
    if (name) { const r = rows.find(x => q(x.name) === q(name)); if (r) return r.id; }
    return undefined;
  };

  const results: Array<{ nftRecord: unknown; error?: string }> = [];
  for (const rec of records) {
    try {
      const stageId          = resolveId(stages,   rec.stageId,          rec.stageName,           rec.stageCode);
      const nftTypeId        = resolveId(types,    rec.nftTypeId,        rec.nftTypeName,          undefined);
      const deliveryStatusId = resolveId(statuses, rec.deliveryStatusId, undefined,                rec.deliveryStatusCode);
      const row = await createNft({
        serialNumber: rec.serialNumber,
        stageId:      stageId ?? "",
        nftTypeId,
        deliveryStatusId,
        notes: rec.notes ?? undefined,
      });
      results.push({ nftRecord: row });
    } catch (e: any) {
      results.push({ nftRecord: null, error: e.message ?? "Insert failed" });
    }
  }
  return results;
}
