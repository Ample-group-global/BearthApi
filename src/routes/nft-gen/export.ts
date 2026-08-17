import { Router } from "express";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { Readable } from "stream";
import sharp from "sharp";
import { requirePermission } from "../../adminAuth";
import pool from "../../pool";
import { getS3Client } from "../../clients/s3";
import { batchUpdateItemIpfsCids, syncGeneratedItemsToNftRecords } from "../../services/nft-gen.service";

const router = Router();

interface ExportState {
  status: 'running' | 'done' | 'error';
  progress: number;
  total: number;
  phase: string;
  error?: string;
}

const exportJobs = new Map<string, ExportState>();

interface PreviewState {
  status: 'running' | 'done' | 'error';
  progress: number;
  total: number;
  phase: string;
  validCount: number;
  invalidItems: Array<{ edition: number; reason: string }>;
  error?: string;
}

const previewJobs = new Map<string, PreviewState & { dir: string }>();

// ── Layer fetcher ─────────────────────────────────────────────────────────────
async function streamToBuffer(body: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = body as Readable;
    readable.on("data", (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("error", reject);
  });
}
function layersBucket(): string | null {
  return process.env.LAYERS_BUCKET || process.env.FILEBASE_LAYERS_BUCKET || null;
}

function makeLayerFetcher() {
  const cache = new Map<string, Buffer>();
  const bucket = layersBucket();

  return async function fetchLayerBuf(filePath: string): Promise<Buffer | null> {
    if (cache.has(filePath)) return cache.get(filePath)!;
    if (!bucket) return null;
    let buf: Buffer | null = null;
    try {
      const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: filePath }));
      buf = await streamToBuffer(res.Body);
    } catch { buf = null; }

    if (buf) cache.set(filePath, buf);
    return buf;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasLayerSource(): boolean {
  return !!layersBucket();
}

// ── POST / — start server-side export ────────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.upload_ipfs");

    const {
      jobId, bucket,
      format = "png", width = 512, height = 512,
      collectionName = "", description = "", nameFormat = "", externalUrl = "",
    } = req.body ?? {};

    if (!jobId) { res.status(422).json({ error: "jobId is required." }); return; }
    if (!bucket) { res.status(422).json({ error: "bucket is required." }); return; }

    if (!hasLayerSource()) {
      res.status(500).json({ error: "No layer source configured. Set LAYERS_BUCKET (Filebase bucket name)." });
      return;
    }

    const { rows: jobRows } = await pool.query(
      "SELECT id FROM nft_generation_jobs WHERE id = $1::uuid",
      [jobId],
    );
    if (!jobRows.length) { res.status(404).json({ error: "Job not found." }); return; }

    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*) AS cnt FROM nft_generated_items WHERE job_id = $1::uuid",
      [jobId],
    );
    const total = Number(countRows[0]?.cnt ?? 0);
    if (total === 0) { res.status(422).json({ error: "No generated items for this job. Generate NFTs first." }); return; }

    const exportId = randomUUID();
    exportJobs.set(exportId, { status: "running", progress: 0, total, phase: "Starting…" });

    runExport(exportId, jobId, {
      bucket,
      format: String(format),
      width: Number(width),
      height: Number(height),
      total,
      collectionName: String(collectionName),
      description: String(description),
      nameFormat: String(nameFormat),
      externalUrl: String(externalUrl),
    }).catch(err => {
      const s = exportJobs.get(exportId);
      if (s) { s.status = "error"; s.error = String(err?.message ?? err); }
    });

    res.status(202).json({ exportId, total });
  } catch (e) { next(e); }
});

// ── POST /preview — start server-side image validation/preview ────────────────

router.post("/preview", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const { jobId, width = 512, height = 512 } = req.body ?? {};
    if (!jobId) { res.status(422).json({ error: "jobId is required." }); return; }

    if (!hasLayerSource()) {
      res.status(500).json({ error: "No layer source configured. Set LAYERS_BUCKET (Filebase bucket name)." });
      return;
    }

    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*) AS cnt FROM nft_generated_items WHERE job_id = $1::uuid",
      [jobId],
    );
    const total = Number(countRows[0]?.cnt ?? 0);
    if (total === 0) { res.status(422).json({ error: "No generated items for this job." }); return; }

    const previewId = randomUUID();

    // Thumbnails are a scratch cache, not layer source data — always OS temp dir.
    const previewDir = path.join(os.tmpdir(), "bearth-previews", previewId);
    fs.mkdirSync(previewDir, { recursive: true });

    previewJobs.set(previewId, {
      status: "running", progress: 0, total,
      phase: "Starting…", validCount: 0, invalidItems: [], dir: previewDir,
    });

    runPreview(previewId, jobId, { width: Number(width), height: Number(height), total, previewDir })
      .catch(err => {
        const s = previewJobs.get(previewId);
        if (s) { s.status = "error"; s.error = String(err?.message ?? err); }
      });

    res.status(202).json({ previewId, total });
  } catch (e) { next(e); }
});

// ── GET /preview/:previewId — poll preview status ─────────────────────────────

router.get("/preview/:previewId", (req, res) => {
  const state = previewJobs.get(req.params.previewId);
  if (!state) { res.status(404).json({ error: "Preview job not found." }); return; }
  const { dir, ...rest } = state;
  res.json(rest);
});

// ── GET /preview/:previewId/img/:edition — serve a thumbnail PNG ──────────────

router.get("/preview/:previewId/img/:edition", (req, res) => {
  const state = previewJobs.get(req.params.previewId);
  if (!state) { res.status(404).json({ error: "Preview job not found." }); return; }
  const edition = parseInt(req.params.edition, 10);
  if (isNaN(edition) || edition < 1) { res.status(400).json({ error: "Invalid edition." }); return; }
  const imgPath = path.join(state.dir, `${edition}.png`);
  if (!fs.existsSync(imgPath)) { res.status(404).json({ error: "Thumbnail not ready." }); return; }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  fs.createReadStream(imgPath).pipe(res);
});

// ── GET /:exportId — poll status ──────────────────────────────────────────────

router.get("/:exportId", (req, res) => {
  const state = exportJobs.get(req.params.exportId);
  if (!state) { res.status(404).json({ error: "Export job not found." }); return; }
  res.json(state);
});

// ── Background workers ────────────────────────────────────────────────────────

const BATCH = 10;
const CONCURRENCY = 5;
const PREVIEW_THUMB = 64;
const PREVIEW_CONCURRENCY = 20;
const PREVIEW_BATCH = 200;

async function pollCid(s3: ReturnType<typeof getS3Client>, bucket: string, key: string, maxMs = 3000): Promise<string> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 80));
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const cid = head.Metadata?.cid ?? "";
      if (cid) return cid;
    } catch { /* not ready yet */ }
  }
  return "";
}

async function runExport(
  exportId: string,
  jobId: string,
  opts: {
    bucket: string; format: string; width: number; height: number; total: number;
    collectionName: string; description: string; nameFormat: string; externalUrl: string;
  },
) {
  const { bucket, format, width, height, total, collectionName, description, nameFormat, externalUrl } = opts;
  const ext = format === "webp" ? "webp" : "png";
  const mime = ext === "webp" ? "image/webp" : "image/png";
  const state = exportJobs.get(exportId)!;
  const s3 = getS3Client();
  const fetchLayerBuf = makeLayerFetcher();

  for (let offset = 0; offset < total; offset += BATCH) {
    const batchEnd = Math.min(offset + BATCH, total);
    state.phase = `Compositing ${offset + 1}–${batchEnd} of ${total}…`;

    const { rows } = await pool.query<{
      edition_number: number;
      trait_type: string;
      trait_value: string;
      file_path: string | null;
      sort_order: number;
      rarity_score: string | null;
      rarity_rank: string | null;
      rarity_tier: string | null;
    }>(`
      SELECT gi.edition_number, nit.trait_type, nit.trait_value, nt.file_path, nl.sort_order,
             (gi.metadata_json->>'score') AS rarity_score,
             (gi.metadata_json->>'rank')  AS rarity_rank,
             (gi.metadata_json->>'tier')  AS rarity_tier
      FROM   nft_generated_items gi
      JOIN   nft_item_traits        nit ON nit.item_id        = gi.id
      JOIN   nft_generation_jobs    j   ON j.id               = gi.job_id
      JOIN   nft_layers             nl  ON nl.collection_id   = j.collection_id
                                      AND nl.display_name     = nit.trait_type
      LEFT JOIN nft_traits          nt  ON nt.layer_id        = nl.id
                                      AND nt.name             = nit.trait_value
      WHERE  gi.job_id = $1::uuid
        AND  gi.edition_number >  $2
        AND  gi.edition_number <= $3
      ORDER BY gi.edition_number,
               CAST(SPLIT_PART(nl.name, '-', 1) AS INTEGER),
               nl.sort_order
    `, [jobId, offset, batchEnd]);

    type LayerRow = { trait_type: string; trait_value: string; file_path: string | null; sort_order: number };
    type EditionData = { layers: LayerRow[]; rarityScore: number; rarityRank: number; rarityTier: string };
    const byEdition = new Map<number, EditionData>();
    for (const row of rows) {
      if (!byEdition.has(row.edition_number)) {
        byEdition.set(row.edition_number, {
          layers: [],
          rarityScore: parseFloat(row.rarity_score ?? '0') || 0,
          rarityRank: parseInt(row.rarity_rank ?? '0', 10) || 0,
          rarityTier: row.rarity_tier ?? 'Common',
        });
      }
      byEdition.get(row.edition_number)!.layers.push(row);
    }

    const editions = [...byEdition.keys()].sort((a, b) => a - b);
    const ipfsUpdates: Array<{
      editionNumber: number; ipfsImageCid: string; ipfsMetadataCid: string; imagePath: string;
    }> = [];

    let cursor = 0;

    async function processOne() {
      while (cursor < editions.length) {
        const editionNum = editions[cursor++];
        const editionData = byEdition.get(editionNum)!;
        const layerRows = editionData.layers;
        const { rarityScore, rarityRank, rarityTier } = editionData;

        // ── 1. Composite ──────────────────────────────────────────────────────
        const validLayers = layerRows.filter(l => l.file_path);
        const resized: Buffer[] = [];
        for (const layer of validLayers) {
          const raw = await fetchLayerBuf(layer.file_path!);
          if (!raw) continue;
          resized.push(await sharp(raw).resize(width, height).toBuffer());
        }

        let imgBuf: Buffer;
        if (resized.length === 0) {
          imgBuf = await sharp({
            create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
          }).toFormat(ext === "webp" ? "webp" : "png").toBuffer();
        } else {
          const [base, ...rest] = resized;
          imgBuf = await sharp(base)
            .composite(rest.map(buf => ({ input: buf, blend: "over" as const })))
            .toFormat(ext === "webp" ? "webp" : "png")
            .toBuffer();
        }

        // ── 2. Upload image ───────────────────────────────────────────────────
        const imgKey = `images/${editionNum}.${ext}`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: imgKey, Body: imgBuf, ContentType: mime }));
        const imgCid = await pollCid(s3, bucket, imgKey);

        // ── 3. Build + upload metadata ────────────────────────────────────────
        const nftName = applyNameFormat(nameFormat || (collectionName ? `${collectionName} #{{id}}` : "#{{id}}"), editionNum);
        const attributes = validLayers.map(l => ({ trait_type: l.trait_type, value: l.trait_value }));
        const rarityPercentage = total > 0 ? Math.round((rarityRank / total) * 10000) / 100 : 0;

        const metaJson = JSON.stringify({
          name: nftName,
          description,
          image: imgCid ? `ipfs://${imgCid}` : `ipfs://PLACEHOLDER_CID/${editionNum}.${ext}`,
          edition: editionNum,
          rarity_rank: rarityRank || editionNum,
          rarity_score: rarityScore || 0,
          rarity_tier: rarityTier || 'Common',
          rarity_percentage: rarityPercentage,
          ...(externalUrl.trim() ? { external_url: `${externalUrl.trim().replace(/\/$/, "")}/${editionNum}` } : {}),
          attributes,
        }, null, 2);

        const metaKey = `metadata/${editionNum}.json`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: metaKey, Body: metaJson, ContentType: "application/json" }));
        const metaCid = await pollCid(s3, bucket, metaKey);

        ipfsUpdates.push({ editionNumber: editionNum, ipfsImageCid: imgCid, ipfsMetadataCid: metaCid, imagePath: imgKey });
        state.progress++;
        state.phase = `Uploading… ${state.progress} / ${total}`;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, processOne));

    if (ipfsUpdates.length > 0) {
      await batchUpdateItemIpfsCids({ jobId, items: ipfsUpdates });
    }
  }

  // Promote all IPFS-synced items into nft_records for wave selling
  state.phase = "Syncing to NFT Records…";
  const synced = await syncGeneratedItemsToNftRecords(jobId);

  state.status = "done";
  state.phase = `Complete — ${total} NFTs exported to Filebase, ${synced} synced to NFT Records`;
}

async function runPreview(
  previewId: string,
  jobId: string,
  opts: { width: number; height: number; total: number; previewDir: string },
) {
  const { total, previewDir } = opts;
  const state = previewJobs.get(previewId)!;
  const fetchLayerBuf = makeLayerFetcher();
  const resizedCache = new Map<string, Promise<Buffer>>();
  function getResized(filePath: string, raw: Buffer): Promise<Buffer> {
    if (!resizedCache.has(filePath)) {
      resizedCache.set(
        filePath,
        sharp(raw).resize(PREVIEW_THUMB, PREVIEW_THUMB, { fit: "cover" }).png().toBuffer(),
      );
    }
    return resizedCache.get(filePath)!;
  }

  for (let offset = 0; offset < total; offset += PREVIEW_BATCH) {
    const batchEnd = Math.min(offset + PREVIEW_BATCH, total);
    state.phase = `Compositing ${offset + 1}–${batchEnd} of ${total}…`;

    const { rows } = await pool.query<{
      edition_number: number;
      trait_type: string;
      trait_value: string;
      file_path: string | null;
      sort_order: number;
    }>(`
      SELECT gi.edition_number, nit.trait_type, nit.trait_value, nt.file_path, nl.sort_order
      FROM   nft_generated_items gi
      JOIN   nft_item_traits        nit ON nit.item_id        = gi.id
      JOIN   nft_generation_jobs    j   ON j.id               = gi.job_id
      JOIN   nft_layers             nl  ON nl.collection_id   = j.collection_id
                                      AND nl.display_name     = nit.trait_type
      LEFT JOIN nft_traits          nt  ON nt.layer_id        = nl.id
                                      AND nt.name             = nit.trait_value
      WHERE  gi.job_id = $1::uuid
        AND  gi.edition_number >  $2
        AND  gi.edition_number <= $3
      ORDER BY gi.edition_number,
               CAST(SPLIT_PART(nl.name, '-', 1) AS INTEGER),
               nl.sort_order
    `, [jobId, offset, batchEnd]);

    type LayerRow = { trait_type: string; trait_value: string; file_path: string | null; sort_order: number };
    const byEdition = new Map<number, LayerRow[]>();
    for (const row of rows) {
      if (!byEdition.has(row.edition_number)) byEdition.set(row.edition_number, []);
      byEdition.get(row.edition_number)!.push(row);
    }

    // Pre-warm the resized cache for all unique trait PNGs in this batch
    const uniquePaths = new Set<string>();
    for (const row of rows) { if (row.file_path) uniquePaths.add(row.file_path); }
    await Promise.all([...uniquePaths].map(async fp => {
      const raw = await fetchLayerBuf(fp);
      return raw ? getResized(fp, raw) : null;
    }));

    const editions = [...byEdition.keys()].sort((a, b) => a - b);
    let cursor = 0;

    async function processOnePreview() {
      while (cursor < editions.length) {
        const editionNum = editions[cursor++];
        const layerRows = byEdition.get(editionNum)!;
        const validLayers = layerRows.filter(l => l.file_path);

        // All resized buffers are already in cache — no expensive decode/resize per NFT
        const resized: Buffer[] = [];
        for (const layer of validLayers) {
          const raw = await fetchLayerBuf(layer.file_path!);
          if (!raw) continue;
          resized.push(await getResized(layer.file_path!, raw));
        }

        let imgBuf: Buffer;
        if (resized.length === 0) {
          imgBuf = await sharp({
            create: { width: PREVIEW_THUMB, height: PREVIEW_THUMB, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
          }).png().toBuffer();
        } else {
          const [base, ...rest] = resized;
          imgBuf = await sharp(base)
            .composite(rest.map(buf => ({ input: buf, blend: "over" as const })))
            .png()
            .toBuffer();
        }

        // Industry-standard quality check: image must have visual variance (not all-one-color)
        let invalidReason = "";
        if (validLayers.length === 0) {
          invalidReason = "No visible layers — solid black";
        } else {
          try {
            const stats = await sharp(imgBuf).stats();
            const rgbStdev = stats.channels.slice(0, 3).reduce((s, c) => s + ((c as any).stdev ?? (c as any).std ?? 0), 0);
            if (rgbStdev < 2) invalidReason = `Uniform image (rgb stdev=${rgbStdev.toFixed(1)}) — compositing may have failed`;
          } catch { invalidReason = "Could not validate image"; }
        }

        if (invalidReason) {
          state.invalidItems.push({ edition: editionNum, reason: invalidReason });
        } else {
          state.validCount++;
        }

        fs.writeFileSync(path.join(previewDir, `${editionNum}.png`), imgBuf);
        state.progress++;
        state.phase = `Validating… ${state.progress} / ${total}`;
      }
    }

    await Promise.all(Array.from({ length: PREVIEW_CONCURRENCY }, processOnePreview));
  }

  state.status = "done";
  state.phase = `Complete — ${state.validCount}/${total} valid${state.invalidItems.length ? `, ${state.invalidItems.length} issues` : ''}`;
}

function applyNameFormat(fmt: string, id: number): string {
  return fmt.replace(/\{\{id\}\}/g, String(id));
}

export default router;
