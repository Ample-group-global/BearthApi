import pool from "../pool";
import { toCamel } from "../utils/camel";
import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "https://s3.filebase.com",
  region:   "us-east-1",
  credentials: {
    accessKeyId:     process.env.FILEBASE_ACCESS_KEY!,
    secretAccessKey: process.env.FILEBASE_SECRET_KEY!,
  },
  forcePathStyle: true,
});

const FILEBASE_GATEWAY = "https://amgbearth.myfilebase.com/ipfs";
const SYNC_CONCURRENCY = 100;

// ── Collections ──────────────────────────────────────────────────────────────

export async function listCollections(params: { limit?: number; offset?: number }) {
  const { limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_collections_list($1, $2)",
    [limit, offset],
  );
  return { collections: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

export async function getCollection(id: string) {
  const { rows } = await pool.query("SELECT nft_gen_collection_get($1::uuid) AS data", [id]);
  return rows[0]?.data ?? null;
}

export async function createCollection(params: {
  name: string; description?: string; symbol?: string; network?: string;
  royaltyBps?: number; creatorWallet?: string; formatWidth?: number; formatHeight?: number;
  smoothing?: boolean; bgGenerate?: boolean; bgStaticColor?: string;
  shuffleOutput?: boolean; dnaTolerance?: number; createdBy?: string;
}) {
  const {
    name, description, symbol, network, royaltyBps, creatorWallet,
    formatWidth, formatHeight, smoothing, bgGenerate, bgStaticColor,
    shuffleOutput, dnaTolerance, createdBy,
  } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_collection_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [name, description ?? null, symbol ?? null, network ?? "eth", royaltyBps ?? 0, creatorWallet ?? null, formatWidth ?? 512, formatHeight ?? 512, smoothing ?? false, bgGenerate ?? false, bgStaticColor ?? null, shuffleOutput ?? true, dnaTolerance ?? 10000, createdBy ?? null],
  );
  return rows[0] ?? null;
}

export async function updateCollection(id: string, params: {
  name?: string; description?: string; symbol?: string; network?: string;
  royaltyBps?: number; creatorWallet?: string; formatWidth?: number; formatHeight?: number;
  smoothing?: boolean; bgGenerate?: boolean; bgStaticColor?: string;
  shuffleOutput?: boolean; dnaTolerance?: number; baseUri?: string; status?: string;
}) {
  const {
    name, description, symbol, network, royaltyBps, creatorWallet,
    formatWidth, formatHeight, smoothing, bgGenerate, bgStaticColor,
    shuffleOutput, dnaTolerance, baseUri, status,
  } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_collection_update($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [id, name ?? null, description ?? null, symbol ?? null, network ?? null, royaltyBps ?? null, creatorWallet ?? null, formatWidth ?? null, formatHeight ?? null, smoothing ?? null, bgGenerate ?? null, bgStaticColor ?? null, shuffleOutput ?? null, dnaTolerance ?? null, baseUri ?? null, status ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteCollection(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_collection_delete($1::uuid)", [id]);
  return rows[0] ?? null;
}

// ── Layers ───────────────────────────────────────────────────────────────────

export async function listLayers(collectionId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_layers_list($1::uuid)",
    [collectionId],
  );
  return toCamel(rows);
}

export async function getLayer(id: string) {
  const { rows } = await pool.query("SELECT nft_gen_layer_get($1::uuid) AS data", [id]);
  return rows[0]?.data ?? null;
}

export async function createLayer(params: {
  collectionId: string; name: string; displayName?: string;
  bypassDna?: boolean; sortOrder?: number; layerRarityPct?: number;
}) {
  const { collectionId, name, displayName, bypassDna, sortOrder, layerRarityPct } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_layer_create($1, $2, $3, $4, $5, $6)",
    [collectionId, name, displayName ?? null, bypassDna ?? false, sortOrder ?? null, layerRarityPct ?? 100],
  );
  return rows[0] ?? null;
}

export async function updateLayer(id: string, params: {
  name?: string; displayName?: string;
  bypassDna?: boolean; sortOrder?: number; layerRarityPct?: number; isActive?: boolean;
}) {
  const { name, displayName, bypassDna, sortOrder, layerRarityPct, isActive } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_layer_update($1, $2, $3, $4, $5, $6, $7)",
    [id, name ?? null, displayName ?? null, bypassDna ?? null, sortOrder ?? null, layerRarityPct ?? null, isActive ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteLayer(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_layer_delete($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function reconcileLayers(collectionId: string, activeNames: string[]) {
  const { rows } = await pool.query(
    "SELECT nft_gen_layers_reconcile($1::uuid, $2::text[]) AS deactivated",
    [collectionId, activeNames],
  );
  return { deactivated: Number(rows[0]?.deactivated ?? 0) };
}

export async function reorderLayers(collectionId: string, items: { id: string; sortOrder: number }[]) {
  const ids = items.map(i => i.id);
  const orders = items.map(i => i.sortOrder);
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_layers_reorder($1::uuid, $2::uuid[], $3::int[])",
    [collectionId, ids, orders],
  );
  return rows[0] ?? null;
}

// ── Traits ───────────────────────────────────────────────────────────────────

export async function listTraits(layerId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_traits_list($1::uuid)",
    [layerId],
  );
  return toCamel(rows);
}

export async function createTrait(params: {
  layerId: string; name: string; filePath: string;
  rarityTier?: string; storageProvider?: string;
}) {
  const { layerId, name, filePath, rarityTier, storageProvider } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_trait_create($1, $2, $3, $4, $5)",
    [layerId, name, filePath, rarityTier ?? "common", storageProvider ?? "filebase"],
  );
  return rows[0] ?? null;
}

export async function updateTrait(id: string, params: {
  name?: string; filePath?: string; storageProvider?: string;
  rarityTier?: string; isActive?: boolean;
}) {
  const { name, filePath, storageProvider, rarityTier, isActive } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_trait_update($1, $2, $3, $4, $5, $6)",
    [id, name ?? null, filePath ?? null, storageProvider ?? null, rarityTier ?? null, isActive ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteTrait(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_trait_delete($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function reconcileTraits(layerId: string, activeFilePaths: string[]) {
  const { rows } = await pool.query(
    "SELECT nft_gen_traits_reconcile($1::uuid, $2::text[]) AS deactivated",
    [layerId, activeFilePaths],
  );
  return { deactivated: Number(rows[0]?.deactivated ?? 0) };
}

// ── Generation Jobs ──────────────────────────────────────────────────────────

export async function createJob(params: { collectionId: string; editionSize: number; createdBy?: string }) {
  const { collectionId, editionSize, createdBy } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_job_create($1::uuid, $2, $3)",
    [collectionId, editionSize, createdBy ?? null],
  );
  return rows[0] ?? null;
}

export async function getJob(id: string) {
  const { rows } = await pool.query("SELECT nft_gen_job_get($1::uuid) AS data", [id]);
  return rows[0]?.data ?? null;
}

export async function startJob(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_job_start($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function updateJobProgress(id: string, progress: number) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_job_update_progress($1::uuid, $2)", [id, progress]);
  return rows[0] ?? null;
}

export async function completeJob(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_job_complete($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function failJob(id: string, errorMessage: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_job_fail($1::uuid, $2)", [id, errorMessage]);
  return rows[0] ?? null;
}

export async function deleteFailedJob(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM nft_generation_jobs WHERE id = $1::uuid AND status = 'failed'",
    [id]
  );
  const deleted = (rowCount ?? 0) > 0;
  if (deleted) {
    // Reclaim disk space from cascaded deletes — fire-and-forget, non-blocking
    pool.query("VACUUM nft_generated_items, nft_item_traits").catch(() => {});
  }
  return deleted;
}

// ── Generated Items ──────────────────────────────────────────────────────────

export async function insertItem(params: {
  jobId: string; editionNumber: number; dnaHash: string;
  imagePath?: string; metadataJson?: object;
}) {
  const { jobId, editionNumber, dnaHash, imagePath, metadataJson } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_item_insert($1::uuid, $2, $3, $4, $5)",
    [jobId, editionNumber, dnaHash, imagePath ?? null, metadataJson ? JSON.stringify(metadataJson) : null],
  );
  return rows[0] ?? null;
}

export async function insertItemTrait(params: {
  itemId: string; traitId: string | null; traitType: string; traitValue: string; rarityTier?: string;
}) {
  const { itemId, traitId, traitType, traitValue, rarityTier } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_item_trait_insert($1::uuid, $2::uuid, $3, $4, $5)",
    [itemId, traitId ?? null, traitType, traitValue, rarityTier ?? null],
  );
  return rows[0] ?? null;
}

export async function insertItemsBatch(params: {
  jobId: string;
  items: Array<{
    editionNumber: number;
    dnaHash: string;
    score?: number;
    rank?: number;
    tier?: string;
    traits?: Array<{ traitType: string; traitValue: string; rarityTier?: string }>;
  }>;
}) {
  const { jobId, items } = params;
  if (!items.length) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ON CONFLICT DO NOTHING → idempotent: safe to retry the same batch
    await client.query(
      `INSERT INTO nft_generated_items (job_id, edition_number, dna_hash, metadata_json)
       SELECT $1::uuid, t.edition_number, t.dna_hash, t.metadata_json::jsonb
       FROM UNNEST($2::int[], $3::text[], $4::text[]) AS t(edition_number, dna_hash, metadata_json)
       ON CONFLICT (job_id, edition_number) DO NOTHING`,
      [
        jobId,
        items.map(i => i.editionNumber),
        items.map(i => i.dnaHash),
        items.map(i => JSON.stringify({ score: i.score, rank: i.rank, tier: i.tier })),
      ],
    );

    // SELECT all items for this batch — includes rows that conflicted (already existed)
    const { rows: itemRows } = await client.query(
      `SELECT id, edition_number FROM nft_generated_items
       WHERE job_id = $1::uuid AND edition_number = ANY($2::int[])`,
      [jobId, items.map(i => i.editionNumber)],
    );

    const editionToId: Record<number, string> = {};
    for (const row of itemRows) editionToId[row.edition_number] = row.id;

    const itemIds: string[]            = [];
    const traitTypes: string[]         = [];
    const traitValues: string[]        = [];
    const rarityTiers: (string|null)[] = [];

    for (const item of items) {
      const itemId = editionToId[item.editionNumber];
      if (!itemId) continue;
      for (const t of (item.traits ?? [])) {
        itemIds.push(itemId);
        traitTypes.push(t.traitType);
        traitValues.push(t.traitValue);
        rarityTiers.push(t.rarityTier ?? null);
      }
    }

    if (itemIds.length > 0) {
      // ON CONFLICT DO NOTHING → idempotent: uq_nft_item_traits_item_trait (item_id, trait_type)
      await client.query(
        `INSERT INTO nft_item_traits (item_id, trait_type, trait_value, rarity_tier)
         SELECT t.item_id::uuid, t.trait_type, t.trait_value, t.rarity_tier
         FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[]) AS t(item_id, trait_type, trait_value, rarity_tier)
         ON CONFLICT (item_id, trait_type) DO NOTHING`,
        [itemIds, traitTypes, traitValues, rarityTiers],
      );

      // Backfill trait_id where still missing — safe to re-run (WHERE trait_id IS NULL)
      const allItemUuids = itemRows.map(r => r.id);
      await client.query(
        `UPDATE nft_item_traits nit
         SET trait_id    = nt.id,
             rarity_tier = nt.rarity_tier
         FROM nft_generated_items gi,
              nft_generation_jobs j,
              nft_layers nl,
              nft_traits nt
         WHERE nit.item_id = ANY($1::uuid[])
           AND gi.id        = nit.item_id
           AND j.id         = gi.job_id
           AND nl.collection_id = j.collection_id
           AND nl.display_name  = nit.trait_type
           AND nt.layer_id  = nl.id
           AND nt.name      = nit.trait_value
           AND nit.trait_id IS NULL`,
        [allItemUuids],
      );
    }

    await client.query("COMMIT");
    return itemRows.map(r => ({ itemId: r.id as string, editionNumber: r.edition_number as number }));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function listItems(params: { jobId: string; limit?: number; offset?: number }) {
  const { jobId, limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(`
    SELECT
      gi.id, gi.edition_number, gi.dna_hash, gi.image_path,
      gi.ipfs_image_cid, gi.ipfs_metadata_cid,
      (gi.metadata_json->>'rank')::int       AS rank,
      (gi.metadata_json->>'score')::numeric  AS score,
      gi.metadata_json->>'tier'              AS tier,
      COUNT(DISTINCT it.id)                  AS trait_count,
      gi.created_at,
      COUNT(*) OVER()                        AS total_count
    FROM nft_generated_items gi
    LEFT JOIN nft_item_traits it ON it.item_id = gi.id
    WHERE gi.job_id = $1::uuid
    GROUP BY gi.id
    ORDER BY gi.edition_number ASC
    LIMIT $2 OFFSET $3
  `, [jobId, limit, offset]);
  return { items: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

export async function updateItemIpfs(id: string, params: { ipfsImageCid: string; ipfsMetadataCid: string }) {
  const { ipfsImageCid, ipfsMetadataCid } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_item_update_ipfs($1::uuid, $2, $3)",
    [id, ipfsImageCid, ipfsMetadataCid],
  );
  return rows[0] ?? null;
}

export async function getRarityReport(jobId: string) {
  const { rows } = await pool.query("SELECT nft_gen_rarity_report($1::uuid) AS data", [jobId]);
  return rows[0]?.data ?? null;
}

// ── Upload Batches ───────────────────────────────────────────────────────────

export async function createUploadBatch(params: {
  jobId: string; provider: string; batchType: string; totalItems: number;
}) {
  const { jobId, provider, batchType, totalItems } = params;
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_upload_batch_create($1::uuid, $2, $3, $4)",
    [jobId, provider, batchType, totalItems],
  );
  return rows[0] ?? null;
}

export async function getUploadBatch(id: string) {
  const { rows } = await pool.query("SELECT nft_gen_upload_batch_get($1::uuid) AS data", [id]);
  return rows[0]?.data ?? null;
}

export async function startUploadBatch(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_upload_batch_start($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function progressUploadBatch(id: string, uploadedItems: number) {
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_upload_batch_progress($1::uuid, $2)",
    [id, uploadedItems],
  );
  return rows[0] ?? null;
}

export async function completeUploadBatch(id: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_upload_batch_complete($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function failUploadBatch(id: string, error: string) {
  const { rows } = await pool.query("SELECT * FROM nft_gen_upload_batch_fail($1::uuid, $2)", [id, error]);
  return rows[0] ?? null;
}

export async function batchUpdateItemIpfsCids(params: {
  jobId: string;
  items: Array<{ editionNumber: number; ipfsImageCid: string; ipfsMetadataCid: string; imagePath?: string }>;
}) {
  const { jobId, items } = params;
  if (!items.length) return 0;
  const hasImagePaths = items.some(i => i.imagePath);
  const { rows } = await pool.query(
    "SELECT nft_gen_items_batch_update_ipfs($1::uuid, $2::int[], $3::text[], $4::text[], $5::text[]) AS updated",
    [
      jobId,
      items.map(i => i.editionNumber),
      items.map(i => i.ipfsImageCid),
      items.map(i => i.ipfsMetadataCid),
      hasImagePaths ? items.map(i => i.imagePath ?? null) : null,
    ],
  );
  return rows[0]?.updated ?? 0;
}

// ── Sync generated items → nft_records ───────────────────────────────────────
// Called after Filebase export completes. Promotes every item that has both
// ipfs_image_cid and ipfs_metadata_cid into nft_records so they appear on the
// NFT Records page and are available for wave selling.
// Idempotent: ON CONFLICT updates the IPFS fields if re-run.

export async function syncGeneratedItemsToNftRecords(jobId: string): Promise<number> {
  // Resolve stage and delivery-status IDs once from lookup_values
  const { rows: lookupRows } = await pool.query(
    `SELECT id, category, code FROM lookup_values
     WHERE (category = 'nft_stage'       AND code = 'genesis')
        OR (category = 'delivery_status' AND code = 'pending')`,
  );
  const genesisStageId    = lookupRows.find((r: { category: string; code: string }) => r.category === 'nft_stage'       && r.code === 'genesis')?.id as string | undefined;
  const pendingStatusId   = lookupRows.find((r: { category: string; code: string }) => r.category === 'delivery_status' && r.code === 'pending')?.id as string | undefined;

  if (!genesisStageId || !pendingStatusId) {
    throw new Error("Required lookup values (nft_stage:genesis, delivery_status:pending) not found");
  }

  const { rows: items } = await pool.query(
    `SELECT edition_number, ipfs_image_cid, ipfs_metadata_cid, metadata_json
     FROM nft_generated_items
     WHERE job_id = $1::uuid
       AND ipfs_image_cid    IS NOT NULL
       AND ipfs_metadata_cid IS NOT NULL
     ORDER BY edition_number ASC`,
    [jobId],
  );

  if (!items.length) return 0;

  const rows = items.map(item => {
    const meta = typeof item.metadata_json === 'string'
      ? JSON.parse(item.metadata_json) as Record<string, unknown>
      : (item.metadata_json as Record<string, unknown>) ?? {};
    const traits: Record<string, string> = {};
    if (Array.isArray(meta.attributes)) {
      for (const attr of meta.attributes as Array<{ trait_type?: string; value?: unknown }>) {
        if (attr.trait_type && attr.value !== undefined) traits[attr.trait_type] = String(attr.value);
      }
    }
    return {
      serial_number:       `#${item.edition_number}`,
      stage_id:            genesisStageId,
      delivery_status_id:  pendingStatusId,
      image_ipfs_hash:     item.ipfs_image_cid,
      metadata_ipfs_hash:  item.ipfs_metadata_cid,
      metadata_uri:        `ipfs://${item.ipfs_metadata_cid}`,
      traits,
    };
  });

  const { rowCount } = await pool.query(
    `INSERT INTO nft_records (serial_number, stage_id, delivery_status_id, image_ipfs_hash, metadata_ipfs_hash, metadata_uri, traits)
     SELECT
       x.serial_number,
       x.stage_id::uuid,
       x.delivery_status_id::uuid,
       x.image_ipfs_hash,
       x.metadata_ipfs_hash,
       x.metadata_uri,
       x.traits
     FROM json_to_recordset($1::json) AS x(
       serial_number text, stage_id text, delivery_status_id text,
       image_ipfs_hash text, metadata_ipfs_hash text, metadata_uri text, traits jsonb
     )
     ON CONFLICT (serial_number) DO UPDATE SET
       image_ipfs_hash    = EXCLUDED.image_ipfs_hash,
       metadata_ipfs_hash = EXCLUDED.metadata_ipfs_hash,
       metadata_uri       = EXCLUDED.metadata_uri,
       traits             = EXCLUDED.traits,
       updated_at         = NOW()`,
    [JSON.stringify(rows)],
  );

  return rowCount ?? items.length;
}

// ── Sync directly from a Filebase bucket ─────────────────────────────────────
// Bucket layout:
//   images/{n}.png                         — NFT image for edition #n
//   metadata/{n}.json                      — NFT metadata for edition #n
//   AssetBlindbox/bearthblindboximage1.png — shared blind box image
//
// CIDs come from Filebase x-amz-meta-cid header. Traits from metadata JSON body.

async function filebaseHead(bucket: string, key: string): Promise<string | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return r.Metadata?.cid ?? null;
  } catch { return null; }
}

async function filebaseGetJson(
  bucket: string, key: string,
): Promise<{ cid: string | null; body: Record<string, unknown> }> {
  try {
    const r    = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const cid  = r.Metadata?.cid ?? null;
    const text = await r.Body?.transformToString();
    return { cid, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  } catch { return { cid: null, body: {} }; }
}

function parseFilebaseTraits(json: Record<string, unknown>): Record<string, unknown> {
  const raw = (json.attributes ?? json.traits ?? {}) as unknown;
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      (raw as Record<string, unknown>[]).map(a => [a.trait_type ?? a.traitType, a.value ?? a.traitValue]),
    );
  }
  return (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
}

export async function syncFromFilebaseBucket(bucket: string): Promise<{ synced: number; skipped: number }> {
  const { rows: lv } = await pool.query(
    `SELECT id, code FROM lookup_values
     WHERE (category = 'nft_stage' AND code = 'genesis')
        OR (category = 'delivery_status' AND code = 'pending')`,
  );
  const genesisStageId  = lv.find(r => r.code === "genesis")?.id  as string | undefined;
  const pendingStatusId = lv.find(r => r.code === "pending")?.id  as string | undefined;
  if (!genesisStageId || !pendingStatusId) throw new Error("Required lookup values not found");

  const bbCid    = await filebaseHead(bucket, "AssetBlindbox/bearthblindboximage1.png");
  const blindUri = bbCid ? `${FILEBASE_GATEWAY}/${bbCid}` : null;

  const imageKeys: string[] = [];
  let listToken: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: "images/", MaxKeys: 1000, ContinuationToken: listToken,
    }));
    imageKeys.push(
      ...(r.Contents?.filter(o => !o.Key!.endsWith("/") && o.Key!.endsWith(".png")).map(o => o.Key!) ?? []),
    );
    listToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (listToken);

  const editions = imageKeys
    .map(k => parseInt(k.replace("images/", "").replace(".png", ""), 10))
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  type ItemRow = {
    serial_number: string; stage_id: string; delivery_status_id: string;
    image_ipfs_hash: string; metadata_ipfs_hash: string; metadata_uri: string;
    blind_box_uri: string | null; traits: Record<string, unknown>;
  };

  const fbRows: ItemRow[] = [];
  let skipped = 0;

  for (let i = 0; i < editions.length; i += SYNC_CONCURRENCY) {
    const batch = editions.slice(i, i + SYNC_CONCURRENCY);
    const results = await Promise.all(batch.map(async n => {
      const [imageCid, { cid: metaCid, body: metaJson }] = await Promise.all([
        filebaseHead(bucket, `images/${n}.png`),
        filebaseGetJson(bucket, `metadata/${n}.json`),
      ]);
      if (!imageCid || !metaCid) return null;
      return {
        serial_number:      `#${n}`,
        stage_id:           genesisStageId,
        delivery_status_id: pendingStatusId,
        image_ipfs_hash:    imageCid,
        metadata_ipfs_hash: metaCid,
        metadata_uri:       `ipfs://${metaCid}`,
        blind_box_uri:      blindUri,
        traits:             parseFilebaseTraits(metaJson),
      } as ItemRow;
    }));
    for (const r of results) { if (r) fbRows.push(r); else skipped++; }
  }

  if (!fbRows.length) return { synced: 0, skipped };

  let totalSynced = 0;
  for (let i = 0; i < fbRows.length; i += 2000) {
    const chunk = fbRows.slice(i, i + 2000);
    const { rowCount } = await pool.query(
      `INSERT INTO nft_records
         (serial_number, stage_id, delivery_status_id, image_ipfs_hash, metadata_ipfs_hash,
          metadata_uri, blind_box_uri, traits)
       SELECT x.serial_number, x.stage_id::uuid, x.delivery_status_id::uuid,
              x.image_ipfs_hash, x.metadata_ipfs_hash, x.metadata_uri, x.blind_box_uri, x.traits
       FROM json_to_recordset($1::json) AS x(
         serial_number text, stage_id text, delivery_status_id text,
         image_ipfs_hash text, metadata_ipfs_hash text, metadata_uri text,
         blind_box_uri text, traits jsonb
       )
       ON CONFLICT (serial_number) DO UPDATE SET
         image_ipfs_hash    = EXCLUDED.image_ipfs_hash,
         metadata_ipfs_hash = EXCLUDED.metadata_ipfs_hash,
         metadata_uri       = EXCLUDED.metadata_uri,
         blind_box_uri      = EXCLUDED.blind_box_uri,
         traits             = EXCLUDED.traits,
         updated_at         = NOW()`,
      [JSON.stringify(chunk)],
    );
    totalSynced += rowCount ?? 0;
  }

  return { synced: totalSynced, skipped };
}

// ── Sync ALL jobs (nft_generated_items → nft_records) ────────────────────────
// Sync ALL jobs — finds every item with both IPFS CIDs across all generation jobs.
// Uses a single batch INSERT with unnest for performance.
export async function syncAllGeneratedItemsToNftRecords(): Promise<number> {
  const { rows: lookupRows } = await pool.query(
    `SELECT id, category, code FROM lookup_values
     WHERE (category = 'nft_stage'       AND code = 'genesis')
        OR (category = 'delivery_status' AND code = 'pending')`,
  );
  const genesisStageId  = lookupRows.find((r: { category: string; code: string }) => r.category === 'nft_stage'       && r.code === 'genesis')?.id as string | undefined;
  const pendingStatusId = lookupRows.find((r: { category: string; code: string }) => r.category === 'delivery_status' && r.code === 'pending')?.id as string | undefined;

  if (!genesisStageId || !pendingStatusId) {
    throw new Error("Required lookup values (nft_stage:genesis, delivery_status:pending) not found");
  }

  const { rows: items } = await pool.query(
    `SELECT DISTINCT ON (edition_number)
       edition_number, ipfs_image_cid, ipfs_metadata_cid, metadata_json
     FROM nft_generated_items
     WHERE ipfs_image_cid    IS NOT NULL
       AND ipfs_metadata_cid IS NOT NULL
     ORDER BY edition_number ASC, created_at DESC`,
  );

  if (!items.length) return 0;

  const rows = items.map(item => {
    const meta = typeof item.metadata_json === 'string'
      ? JSON.parse(item.metadata_json) as Record<string, unknown>
      : (item.metadata_json as Record<string, unknown>) ?? {};
    const traits: Record<string, string> = {};
    if (Array.isArray(meta.attributes)) {
      for (const attr of meta.attributes as Array<{ trait_type?: string; value?: unknown }>) {
        if (attr.trait_type && attr.value !== undefined) traits[attr.trait_type] = String(attr.value);
      }
    }
    return {
      serial_number:      `#${item.edition_number}`,
      stage_id:           genesisStageId,
      delivery_status_id: pendingStatusId,
      image_ipfs_hash:    item.ipfs_image_cid,
      metadata_ipfs_hash: item.ipfs_metadata_cid,
      metadata_uri:       `ipfs://${item.ipfs_metadata_cid}`,
      traits,
    };
  });

  const { rowCount } = await pool.query(
    `INSERT INTO nft_records (serial_number, stage_id, delivery_status_id, image_ipfs_hash, metadata_ipfs_hash, metadata_uri, traits)
     SELECT
       x.serial_number,
       x.stage_id::uuid,
       x.delivery_status_id::uuid,
       x.image_ipfs_hash,
       x.metadata_ipfs_hash,
       x.metadata_uri,
       x.traits
     FROM json_to_recordset($1::json) AS x(
       serial_number text, stage_id text, delivery_status_id text,
       image_ipfs_hash text, metadata_ipfs_hash text, metadata_uri text, traits jsonb
     )
     ON CONFLICT (serial_number) DO UPDATE SET
       image_ipfs_hash    = EXCLUDED.image_ipfs_hash,
       metadata_ipfs_hash = EXCLUDED.metadata_ipfs_hash,
       metadata_uri       = EXCLUDED.metadata_uri,
       traits             = EXCLUDED.traits,
       updated_at         = NOW()`,
    [JSON.stringify(rows)],
  );

  return rowCount ?? items.length;
}

export async function fetchLayerImage(rel: string): Promise<Buffer | null> {
  if (!rel || rel.includes('..') || rel.startsWith('/')) return null;
  const bucket = process.env.FILEBASE_LAYERS_BUCKET || 'bearth-layers';
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: rel }));
    if (!resp.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
