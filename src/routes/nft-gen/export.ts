import { Router }                           from "express";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID }                          from "crypto";
import path                                    from "path";
import fs                                      from "fs";
import sharp                                   from "sharp";
import { requirePermission }                   from "../../adminAuth";
import pool                                    from "../../pool";
import { getS3Client }                         from "../../clients/s3";
import { batchUpdateItemIpfsCids }             from "../../services/nft-gen.service";

const router = Router();

interface ExportState {
  status:   'running' | 'done' | 'error';
  progress: number;
  total:    number;
  phase:    string;
  error?:   string;
}

const exportJobs = new Map<string, ExportState>();

// ── POST / — start server-side export ────────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.upload_ipfs");

    const {
      jobId, bucket,
      format = "png", width = 512, height = 512,
      collectionName = "", description = "", nameFormat = "", externalUrl = "",
    } = req.body ?? {};

    if (!jobId)  { res.status(422).json({ error: "jobId is required."  }); return; }
    if (!bucket) { res.status(422).json({ error: "bucket is required." }); return; }

    const layersDir = process.env.LAYERS_DIR;
    if (!layersDir || !fs.existsSync(layersDir)) {
      res.status(500).json({ error: "LAYERS_DIR env var is not configured or path does not exist on this server." });
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
      width:  Number(width),
      height: Number(height),
      total,
      layersDir,
      collectionName: String(collectionName),
      description:    String(description),
      nameFormat:     String(nameFormat),
      externalUrl:    String(externalUrl),
    }).catch(err => {
      const s = exportJobs.get(exportId);
      if (s) { s.status = "error"; s.error = String(err?.message ?? err); }
    });

    res.status(202).json({ exportId, total });
  } catch (e) { next(e); }
});

// ── GET /:exportId — poll status ──────────────────────────────────────────────

router.get("/:exportId", (req, res) => {
  const state = exportJobs.get(req.params.exportId);
  if (!state) { res.status(404).json({ error: "Export job not found." }); return; }
  res.json(state);
});

// ── Background worker ─────────────────────────────────────────────────────────

const BATCH       = 10;
const CONCURRENCY = 5;

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
  jobId:    string,
  opts: {
    bucket: string; format: string; width: number; height: number; total: number;
    layersDir: string; collectionName: string; description: string; nameFormat: string; externalUrl: string;
  },
) {
  const { bucket, format, width, height, total, layersDir, collectionName, description, nameFormat, externalUrl } = opts;
  const ext  = format === "webp" ? "webp" : "png";
  const mime = ext === "webp" ? "image/webp" : "image/png";
  const state = exportJobs.get(exportId)!;
  const s3    = getS3Client();
  const resolvedLayersDir = path.resolve(layersDir);

  const bufCache = new Map<string, Buffer>();

  function readLayerBuf(filePath: string): Buffer | null {
    if (bufCache.has(filePath)) return bufCache.get(filePath)!;
    const abs = path.resolve(resolvedLayersDir, filePath);
    if (!abs.startsWith(resolvedLayersDir) || !fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    bufCache.set(filePath, buf);
    return buf;
  }

  for (let offset = 0; offset < total; offset += BATCH) {
    const batchEnd = Math.min(offset + BATCH, total);
    state.phase = `Compositing ${offset + 1}–${batchEnd} of ${total}…`;

    const { rows } = await pool.query<{
      edition_number: number;
      trait_type:     string;
      trait_value:    string;
      file_path:      string | null;
      sort_order:     number;
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
      ORDER BY gi.edition_number, nl.sort_order
    `, [jobId, offset, batchEnd]);

    type LayerRow = { trait_type: string; trait_value: string; file_path: string | null; sort_order: number };
    const byEdition = new Map<number, LayerRow[]>();
    for (const row of rows) {
      if (!byEdition.has(row.edition_number)) byEdition.set(row.edition_number, []);
      byEdition.get(row.edition_number)!.push(row);
    }

    const editions = [...byEdition.keys()].sort((a, b) => a - b);
    const ipfsUpdates: Array<{
      editionNumber: number; ipfsImageCid: string; ipfsMetadataCid: string; imagePath: string;
    }> = [];

    let cursor = 0;

    async function processOne() {
      while (cursor < editions.length) {
        const editionNum = editions[cursor++];
        const layerRows  = byEdition.get(editionNum)!;

        // ── 1. Composite ──────────────────────────────────────────────────────
        const validLayers = layerRows.filter(l => l.file_path);
        const resized: Buffer[] = [];
        for (const layer of validLayers) {
          const raw = readLayerBuf(layer.file_path!);
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
        const nftName    = applyNameFormat(nameFormat || (collectionName ? `${collectionName} #{{id}}` : "#{{id}}"), editionNum);
        const attributes = validLayers.map(l => ({ trait_type: l.trait_type, value: l.trait_value }));

        const metaJson = JSON.stringify({
          name:        nftName,
          description,
          image:       imgCid ? `ipfs://${imgCid}` : `ipfs://PLACEHOLDER_CID/${editionNum}.${ext}`,
          edition:     editionNum,
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

  state.status = "done";
  state.phase  = `Complete — ${total} NFTs exported to Filebase`;
}

function applyNameFormat(fmt: string, id: number): string {
  return fmt.replace(/\{\{id\}\}/g, String(id));
}

export default router;
