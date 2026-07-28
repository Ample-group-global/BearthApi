import pool from "../pool";
import { toCamel } from "../utils/camel";

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

    // Bulk insert all items in ONE query via UNNEST
    const { rows: itemRows } = await client.query(
      `INSERT INTO nft_generated_items (job_id, edition_number, dna_hash, metadata_json)
       SELECT $1::uuid, t.edition_number, t.dna_hash, t.metadata_json::jsonb
       FROM UNNEST($2::int[], $3::text[], $4::text[]) AS t(edition_number, dna_hash, metadata_json)
       RETURNING id, edition_number`,
      [
        jobId,
        items.map(i => i.editionNumber),
        items.map(i => i.dnaHash),
        items.map(i => JSON.stringify({ score: i.score, rank: i.rank, tier: i.tier })),
      ],
    );

    const editionToId: Record<number, string> = {};
    for (const row of itemRows) editionToId[row.edition_number] = row.id;

    // Collect all traits then bulk insert in ONE query via UNNEST
    const itemIds: string[]         = [];
    const traitTypes: string[]      = [];
    const traitValues: string[]     = [];
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
      await client.query(
        `INSERT INTO nft_item_traits (item_id, trait_type, trait_value, rarity_tier)
         SELECT t.item_id::uuid, t.trait_type, t.trait_value, t.rarity_tier
         FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[]) AS t(item_id, trait_type, trait_value, rarity_tier)`,
        [itemIds, traitTypes, traitValues, rarityTiers],
      );

      // Backfill trait_id and rarity_tier from nft_traits via layer display_name match
      const insertedItemUuids = itemRows.map(r => r.id);
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
        [insertedItemUuids],
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
  const { rows } = await pool.query(
    "SELECT * FROM nft_gen_items_list($1::uuid, $2, $3)",
    [jobId, limit, offset],
  );
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
