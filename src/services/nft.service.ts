import pool from "../pool";
import { toCamel } from "../utils/camel";

const SORT_COLS: Record<string, string> = {
  serial_number:   "nr.serial_number",
  token_id:        "nr.token_id",
  wave:            "w.wave_number",
  price_eth:       "COALESCE(nr.price_eth, w.default_price_eth)",
  stage:           "ns.name",
  type:            "nt.name",
  is_revealed:     "nr.is_revealed",
  delivery_status: "ds.code",
  delivered_at:    "nr.delivered_at",
};

export async function listNft(params: {
  search?: string | null;
  deliveryStatusCode?: string | null;
  stageCode?: string | null;
  revealed?: boolean | null;
  waveId?: string | null;
  limit?: number;
  offset?: number;
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
}) {
  const {
    search = null, deliveryStatusCode = null, stageCode = null,
    revealed = null, waveId = null, limit = 20, offset = 0,
    sortBy = null, sortDir = null,
  } = params;

  const sortCol = sortBy && SORT_COLS[sortBy] ? SORT_COLS[sortBy] : null;
  const dir     = sortDir === "desc" ? "DESC" : "ASC";
  const orderBy = sortCol
    ? `${sortCol} ${dir} NULLS LAST`
    : "nr.token_id ASC NULLS LAST, nr.serial_number ASC";

  const { rows } = await pool.query(
    `SELECT
       nr.id, nr.serial_number, nr.token_id,
       nr.image_ipfs_hash, nr.metadata_uri, nr.blind_box_uri,
       nr.is_revealed, nr.revealed_at,
       nr.notes, nr.delivered_at, nr.created_at, nr.updated_at,
       nr.stage_id, ns.name AS stage_name,
       nr.nft_type_id, nt.name AS type_name,
       nr.delivery_status_id, ds.code AS delivery_status_code, ds.name AS delivery_status_name,
       nr.wave_id, w.wave_number, w.name AS wave_name,
       nr.price_eth,
       COALESCE(nr.price_eth, w.default_price_eth) AS effective_price_eth,
       COUNT(*) OVER() AS total_count
     FROM nft_records nr
     LEFT JOIN nft_stages        ns ON nr.stage_id           = ns.id
     LEFT JOIN nft_types         nt ON nr.nft_type_id        = nt.id
     LEFT JOIN delivery_statuses ds ON nr.delivery_status_id = ds.id
     LEFT JOIN nft_waves          w ON nr.wave_id             = w.id
     WHERE ($1::TEXT    IS NULL OR nr.serial_number ILIKE '%' || $1 || '%' OR nr.token_id::TEXT = $1)
       AND ($2::VARCHAR IS NULL OR ds.code = $2)
       AND ($3::VARCHAR IS NULL OR ns.code = $3)
       AND ($4::BOOLEAN IS NULL OR nr.is_revealed = $4)
       AND ($5::UUID    IS NULL OR nr.wave_id = $5::UUID)
     ORDER BY ${orderBy}
     LIMIT $6 OFFSET $7`,
    [search, deliveryStatusCode, stageCode, revealed, waveId, limit, offset]
  );
  const { rows: statsRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE NOT nr.is_revealed)    AS blind_count,
      COUNT(*) FILTER (WHERE nr.is_revealed)         AS revealed_count,
      COUNT(*) FILTER (WHERE ds.code = 'delivered')  AS delivered_count
    FROM nft_records nr
    LEFT JOIN delivery_statuses ds ON nr.delivery_status_id = ds.id
  `);
  const st = statsRows[0] ?? {};

  return {
    nftRecords:    toCamel(rows),
    total:         Number(rows[0]?.total_count ?? 0),
    blindCount:    Number(st.blind_count     ?? 0),
    revealedCount: Number(st.revealed_count  ?? 0),
    deliveredCount:Number(st.delivered_count ?? 0),
    limit,
    offset,
  };
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
