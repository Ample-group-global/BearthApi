import { Router } from "express";
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
import { pollCid } from "../../utils/pollCid";
import { ZipStream } from "../../utils/zipStream";
import { S3MultipartWritable } from "../../utils/s3MultipartWritable";

const router = Router();

interface ExportState {
  status: 'running' | 'done' | 'error';
  progress: number;
  total: number;
  phase: string;
  error?: string;
}

const exportJobs = new Map<string, ExportState>();
let exportRunning = false;

// Tracks pre-built ZIP location for each export job so the download endpoint
// can return a pre-signed URL instead of streaming from scratch.
// key = jobId, value = { bucket, zipKey }
const zipRegistry = new Map<string, { bucket: string; zipKey: string }>();

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
  // Deduplicates concurrent fetches of the same key — if 25 workers all need
  // the same layer simultaneously, only 1 S3 GET fires; others await the same promise.
  const pending = new Map<string, Promise<Buffer | null>>();
  const bucket = layersBucket();

  return async function fetchLayerBuf(filePath: string): Promise<Buffer | null> {
    if (cache.has(filePath)) return cache.get(filePath)!;
    if (pending.has(filePath)) return pending.get(filePath)!;
    if (!bucket) return null;

    const promise = getS3Client()
      .send(new GetObjectCommand({ Bucket: bucket, Key: filePath }))
      .then(res => streamToBuffer(res.Body))
      .then(buf => { if (buf) cache.set(filePath, buf); return buf ?? null; })
      .catch(() => null)
      .finally(() => pending.delete(filePath));

    pending.set(filePath, promise);
    return promise;
  };
}

// Wraps fetchLayerBuf with a resize cache keyed per file path.
// Workers call this instead of doing sharp(raw).resize() per NFT —
// each unique layer is resized exactly once regardless of how many
// editions share the same trait, dropping thread-pool pressure by ~8x.
function makeResizedFetcher(
  fetchLayerBuf: (fp: string) => Promise<Buffer | null>,
  width: number,
  height: number,
) {
  const cache = new Map<string, Buffer>();
  const pending = new Map<string, Promise<Buffer | null>>();

  return async function fetchLayerResized(filePath: string): Promise<Buffer | null> {
    if (cache.has(filePath)) return cache.get(filePath)!;
    if (pending.has(filePath)) return pending.get(filePath)!;

    const promise = fetchLayerBuf(filePath)
      .then(async raw => {
        if (!raw) return null;
        const buf = await sharp(raw).resize(width, height).toBuffer();
        cache.set(filePath, buf);
        return buf;
      })
      .catch(() => null)
      .finally(() => pending.delete(filePath));

    pending.set(filePath, promise);
    return promise;
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
      format = "png", width, height,
      collectionName = "", description = "", nameFormat = "", externalUrl = "",
      syncToRecords = true,
    } = req.body ?? {};

    if (!jobId) { res.status(422).json({ error: "jobId is required." }); return; }
    if (!bucket) { res.status(422).json({ error: "bucket is required." }); return; }
    if (exportRunning) {
      res.status(409).json({ error: "An export is already running. Wait for it to complete before starting a new one." });
      return;
    }
    if (!width || Number(width) < 1) { res.status(422).json({ error: "width is required and must be >= 1 px." }); return; }
    if (!height || Number(height) < 1) { res.status(422).json({ error: "height is required and must be >= 1 px." }); return; }

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

    exportRunning = true;
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
      syncToRecords: syncToRecords !== false,
    }).catch(err => {
      const s = exportJobs.get(exportId);
      if (s) { s.status = "error"; s.error = String(err?.message ?? err); }
    }).finally(() => {
      exportRunning = false;
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

// ── GET /download-zip/:jobId — offline bulk download (images + metadata) ──────
// Streams a ZIP64 archive directly to the browser: images/<edition>.<ext> +
// metadata/<edition>.json per NFT. ZIP64 supports archives >4 GB (required
// for large collections at high resolution). Higher batch/concurrency than the
// background export worker to minimise wall-clock time for the user.

const DOWNLOAD_BATCH     = 50;   // editions per outer loop iteration (50 × 8 layer S3 reads)
const DOWNLOAD_CONCURRENCY = 20; // concurrent Sharp composites per batch

router.get("/download-zip/:jobId", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    // Disable idle timeout — large archives stream for many minutes
    req.socket?.setTimeout(0);
    const { jobId } = req.params;
    const ext = (req.query.format as string) === "webp" ? "webp" : "png";
    const width = Math.max(1, Number(req.query.width) || 512);
    const height = Math.max(1, Number(req.query.height) || 512);
    const collectionName = String(req.query.collectionName ?? "");
    const description = String(req.query.description ?? "");
    const nameFormat = String(req.query.nameFormat ?? "");
    const externalUrl = String(req.query.externalUrl ?? "");

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
    console.log(`[download-zip] job ${jobId}: ${total} NFTs, width=${width} height=${height} — starting ZIP64 stream`);

    const safeName = (collectionName || "bearth-nft-collection").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);

    const zip = new ZipStream(res);
    const fetchLayerBuf = makeLayerFetcher();

    try {
      for (let offset = 0; offset < total; offset += DOWNLOAD_BATCH) {
        const batchEnd = Math.min(offset + DOWNLOAD_BATCH, total);
        const rows = await fetchEditionRows(jobId, offset, batchEnd);

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
        const results: Array<{ editionNum: number; imgBuf: Buffer; metaJson: string }> = [];
        let cursor = 0;

        // Composite with bounded concurrency (CPU/IO-bound) — an unbounded
        // Promise.all over a full 200-item batch can burst past the S3
        // client's socket pool (confirmed live: requests queuing up under
        // load). Write to the ZIP stream only after each batch settles —
        // ZipStream tracks a running byte offset and is not safe for
        // concurrent writes.
        async function processOne() {
          while (cursor < editions.length) {
            const editionNum = editions[cursor++];
            const editionData = byEdition.get(editionNum)!;
            const validLayers = editionData.layers.filter(l => l.file_path);
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
              }).toFormat(ext).toBuffer();
            } else {
              const [base, ...rest] = resized;
              imgBuf = await sharp(base)
                .composite(rest.map(buf => ({ input: buf, blend: "over" as const })))
                .toFormat(ext)
                .toBuffer();
            }

            const nftName = applyNameFormat(nameFormat || (collectionName ? `${collectionName} #{{id}}` : "#{{id}}"), editionNum);
            const traitAttributes = validLayers.map(l => ({ trait_type: l.trait_type, value: l.trait_value }));
            const baseUrl = (externalUrl.trim() || "https://www.imbearth.com").replace(/\/$/, "");
            const metaJson = JSON.stringify({
              name: nftName,
              description,
              image: `images/${editionNum}.${ext}`,
              external_url: `${baseUrl}/${editionNum}`,
              attributes: [
                ...traitAttributes,
                { trait_type: "Rarity Score", value: (editionData.rarityScore || 0).toFixed(2) },
                { trait_type: "Rarity Rank",  value: `#${editionData.rarityRank || editionNum}` },
                { trait_type: "Rarity Tier",  value: editionData.rarityTier || "Common" },
              ],
            }, null, 2);

            results.push({ editionNum, imgBuf, metaJson });
          }
        }
        await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, processOne));

        for (const r of results) {
          zip.addFile(`images/${r.editionNum}.${ext}`, r.imgBuf);
          zip.addFile(`metadata/${r.editionNum}.json`, Buffer.from(r.metaJson, "utf8"));
        }
      }

      zip.finish();
    } catch (streamErr) {
      // Headers/bytes are already flushed at this point — a JSON error
      // response is no longer possible. Destroy the connection so the
      // browser reports a failed/incomplete download instead of silently
      // saving a truncated, corrupt ZIP.
      console.error(`[download-zip] failed mid-stream for job ${jobId}:`, streamErr);
      res.destroy(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
    }
  } catch (e) { next(e); }
});

// ── POST /sync-records — sync a completed job's items into nft_records ───────
// Must be declared before /:exportId to prevent Express treating "sync-records"
// as an export job ID. Synchronous (pure DB work, typically < 2s for 9999 items).
router.post("/sync-records", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.upload_ipfs");
    const { jobId } = req.body ?? {};
    if (!jobId?.trim()) { res.status(422).json({ error: "jobId is required." }); return; }
    const { rows } = await pool.query(
      "SELECT id, status FROM nft_generation_jobs WHERE id = $1::uuid",
      [jobId],
    );
    if (!rows.length) { res.status(404).json({ error: "Job not found." }); return; }
    if (rows[0].status !== "completed") {
      res.status(409).json({ error: `Job status is '${rows[0].status}' — must be 'completed' before syncing to NFT Records.` });
      return;
    }
    const synced = await syncGeneratedItemsToNftRecords(jobId);
    res.json({ synced });
  } catch (e) { next(e); }
});

// ── GET /presigned-zip/:jobId — instant pre-signed download URL ───────────────
// Returns a 24-hour Filebase pre-signed URL to the ZIP built during the last
// server-side export for this job. Falls back gracefully when no pre-built ZIP
// exists (UI will use the streaming download-zip endpoint instead).
router.get("/presigned-zip/:jobId", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const { jobId } = req.params;

    // 1. Check in-memory registry first (fastest path, no S3 round-trip).
    const reg = zipRegistry.get(jobId);
    if (reg) {
      const url = await getSignedUrl(
        getS3Client(),
        new GetObjectCommand({ Bucket: reg.bucket, Key: reg.zipKey }),
        { expiresIn: 86400 }, // 24 hours
      );
      res.json({ ready: true, url, bucket: reg.bucket, key: reg.zipKey });
      return;
    }

    // 2. Not in memory (e.g. server restarted) — check S3 directly.
    //    Requires the caller to pass ?bucket= so we know where to look.
    const bucket = String(req.query.bucket ?? "");
    if (!bucket) { res.json({ ready: false, reason: "no_registry" }); return; }

    const zipKey = `downloads/${jobId}.zip`;
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: zipKey }));
      // Object exists — register it and return a signed URL.
      zipRegistry.set(jobId, { bucket, zipKey });
      const url = await getSignedUrl(
        getS3Client(),
        new GetObjectCommand({ Bucket: bucket, Key: zipKey }),
        { expiresIn: 86400 },
      );
      res.json({ ready: true, url, bucket, key: zipKey });
    } catch {
      res.json({ ready: false, reason: "not_built_yet" });
    }
  } catch (e) { next(e); }
});

// ── GET /:exportId — poll status ──────────────────────────────────────────────

router.get("/:exportId", (req, res) => {
  const state = exportJobs.get(req.params.exportId);
  if (!state) { res.status(404).json({ error: "Export job not found." }); return; }
  res.json(state);
});

// ── Background workers ────────────────────────────────────────────────────────

const BATCH = 100;
const CONCURRENCY = 25;
const PREVIEW_THUMB = 64;
const PREVIEW_CONCURRENCY = 20;
const PREVIEW_BATCH = 200;

interface EditionRow {
  edition_number: number;
  trait_type: string;
  trait_value: string;
  file_path: string | null;
  sort_order: number;
  rarity_score: string | null;
  rarity_rank: string | null;
  rarity_tier: string | null;
}

// Shared by runExport and runPreview — identical join/filter/order, only
// the composited output differs. Rarity columns are always selected (same
// table, no extra join cost); runPreview just doesn't read them.
async function fetchEditionRows(jobId: string, offset: number, batchEnd: number): Promise<EditionRow[]> {
  const { rows } = await pool.query<EditionRow>(`
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
             nl.sort_order
  `, [jobId, offset, batchEnd]);
  return rows;
}

async function runExport(
  exportId: string,
  jobId: string,
  opts: {
    bucket: string; format: string; width: number; height: number; total: number;
    collectionName: string; description: string; nameFormat: string; externalUrl: string;
    syncToRecords: boolean;
  },
) {
  const { bucket, format, width, height, total, collectionName, description, nameFormat, externalUrl, syncToRecords } = opts;
  const ext = format === "webp" ? "webp" : "png";
  const mime = ext === "webp" ? "image/webp" : "image/png";
  const state = exportJobs.get(exportId)!;
  const s3 = getS3Client();
  const fetchLayerBuf = makeLayerFetcher();
  // Pre-resize cache: each unique layer PNG is resized to the target dimensions
  // exactly once and cached — workers read from cache instead of calling sharp
  // per-NFT, dropping thread-pool pressure from 8 resizes+1 composite to 1 composite.
  const fetchLayerResized = makeResizedFetcher(fetchLayerBuf, width, height);

  // ── Pre-built ZIP: stream directly into Filebase via S3 multipart upload ──
  // One render pass, two outputs: individual files + ZIP, no re-download needed.
  const safeName = (collectionName || "bearth-nft-collection").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const zipKey  = `downloads/${jobId}.zip`;
  const zipS3   = new S3MultipartWritable(s3, bucket, zipKey);
  const zipOut  = new ZipStream(zipS3);
  let   zipOk   = false;

  for (let offset = 0; offset < total; offset += BATCH) {
    const batchEnd = Math.min(offset + BATCH, total);
    state.phase = `Compositing ${offset + 1}–${batchEnd} of ${total}…`;

    const rows = await fetchEditionRows(jobId, offset, batchEnd);

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

    // Pre-warm: fetch + resize all unique layer PNGs in this batch before workers start.
    // After batch 1 all layers are cached; subsequent batches resolve instantly.
    const uniquePaths = new Set<string>();
    for (const row of rows) { if (row.file_path) uniquePaths.add(row.file_path); }
    await Promise.all([...uniquePaths].map(fp => fetchLayerResized(fp)));

    let cursor = 0;

    async function processOne() {
      while (cursor < editions.length) {
        const editionNum = editions[cursor++];
        const editionData = byEdition.get(editionNum)!;
        const layerRows = editionData.layers;
        const { rarityScore, rarityRank, rarityTier } = editionData;

        // ── 1. Composite ──────────────────────────────────────────────────────
        // Layers are pre-resized and cached by makeResizedFetcher — each unique
        // layer PNG is resized exactly once. Workers hit cache here, no S3 reads
        // or sharp resize calls per NFT — only one composite per NFT remains.
        const validLayers = layerRows.filter(l => l.file_path);
        const resized: Buffer[] = [];
        for (const layer of validLayers) {
          const buf = await fetchLayerResized(layer.file_path!);
          if (buf) resized.push(buf);
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
        const imgCid = await pollCid(s3, bucket, imgKey, 500);

        // ── 3. Build + upload metadata ────────────────────────────────────────
        const nftName = applyNameFormat(nameFormat || (collectionName ? `${collectionName} #{{id}}` : "#{{id}}"), editionNum);
        const traitAttributes = validLayers.map(l => ({ trait_type: l.trait_type, value: l.trait_value }));
        const baseUrl = (externalUrl.trim() || "https://www.imbearth.com").replace(/\/$/, "");

        const metaJson = JSON.stringify({
          name: nftName,
          description,
          image: imgCid ? `ipfs://${imgCid}` : `ipfs://PLACEHOLDER_CID/${editionNum}.${ext}`,
          external_url: `${baseUrl}/${editionNum}`,
          attributes: [
            ...traitAttributes,
            { trait_type: "Rarity Score", value: rarityScore.toFixed(2) },
            { trait_type: "Rarity Rank",  value: `#${rarityRank}` },
            { trait_type: "Rarity Tier",  value: rarityTier || "Common" },
          ],
        }, null, 2);

        const metaKey = `metadata/${editionNum}.json`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: metaKey, Body: metaJson, ContentType: "application/json" }));
        const metaCid = await pollCid(s3, bucket, metaKey, 1500);

        // ── 4. Add rendered files to pre-built ZIP (S3 multipart stream) ─────
        zipOut.addFile(`images/${editionNum}.${ext}`, imgBuf);
        zipOut.addFile(`metadata/${editionNum}.json`, Buffer.from(metaJson, "utf8"));

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

  // ── Finalise pre-built ZIP and upload to Filebase ────────────────────────
  state.phase = "Finalising download ZIP…";
  try {
    zipOut.finish();                  // writes ZIP central directory to the S3 multipart stream
    await zipS3.complete();           // flushes final S3 part and completes the multipart upload
    zipRegistry.set(jobId, { bucket, zipKey });
    zipOk = true;
    console.log(`[runExport] pre-built ZIP uploaded: s3://${bucket}/${zipKey}`);
  } catch (zipErr) {
    // Non-fatal: individual files are already in Filebase.
    // User can still use the streaming download-zip fallback.
    console.error(`[runExport] pre-built ZIP failed (streaming fallback still works):`, zipErr);
    await zipS3.abort().catch(() => {});
  }

  let synced = 0;
  if (syncToRecords) {
    state.phase = "Syncing to NFT Records…";
    synced = await syncGeneratedItemsToNftRecords(jobId);
  }

  state.status = "done";
  state.phase = syncToRecords
    ? `Complete — ${total} NFTs exported to Filebase${zipOk ? ' · ZIP ready' : ''}, ${synced} synced to NFT Records`
    : `Complete — ${total} NFTs exported to Filebase${zipOk ? ' · ZIP ready for instant download' : ''} (test run — nft_records not updated)`;
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

    const rows = await fetchEditionRows(jobId, offset, batchEnd);

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
