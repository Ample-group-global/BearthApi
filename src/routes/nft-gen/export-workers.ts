import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs";
import os from "os";
import sharp from "sharp";
import pool from "../../pool";
import { getS3Client } from "../../clients/s3";
import { batchUpdateItemIpfsCids, syncGeneratedItemsToNftRecords } from "../../services/nft-gen.service";
import { pollCid } from "../../utils/pollCid";
import { ZipStream } from "../../utils/zipStream";
import { S3MultipartWritable } from "../../utils/s3MultipartWritable";
import {
  EditionRow, LayerRow, EditionData,
  fetchEditionRows, applyNameFormat,
  makeLayerFetcher, makeResizedFetcher,
  streamToBuffer,
} from "./export-helpers";
import { exportMeta, refreshCidMeta, previewMeta, zipRegistry } from "./export-state";

export const BATCH             = 500;
export const CONCURRENCY       = 50;
const META_CONCURRENCY         = 20;
const REFRESH_CONCURRENCY      = 20;
const PREVIEW_THUMB            = 64;
const PREVIEW_CONCURRENCY      = 20;
const PREVIEW_BATCH            = 200;

export async function runExport(
  exportId: string,
  jobId: string,
  opts: {
    bucket: string; format: string; width: number; height: number; total: number;
    collectionName: string; description: string; nameFormat: string; externalUrl: string;
    syncToRecords: boolean; resumeFrom: number;
  },
) {
  const { bucket, format, width, height, total, collectionName, description, nameFormat, externalUrl, syncToRecords, resumeFrom } = opts;
  const ext = format === "webp" ? "webp" : "png";
  const mime = ext === "webp" ? "image/webp" : "image/png";
  const state = exportMeta.jobs.get(exportId)!;
  const s3 = getS3Client();
  const fetchLayerBuf = makeLayerFetcher();
  // Pre-resize cache: each unique layer PNG is resized exactly once regardless
  // of how many editions share the same trait, dropping sharp thread-pool pressure ~8x.
  const fetchLayerResized = makeResizedFetcher(fetchLayerBuf, width, height);

  const safeName = (collectionName || "bearth-nft-collection").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const zipKey  = `downloads/${jobId}.zip`;
  let   zipS3: S3MultipartWritable | null = null;
  let   zipOut: ZipStream | null = null;
  let   zipOk   = false;
  // Pre-built ZIP is skipped on resume — a partial ZIP starting mid-collection would be
  // missing already-uploaded files. Streaming download-zip endpoint works as fallback.
  if (resumeFrom === 0) {
    zipS3  = new S3MultipartWritable(s3, bucket, zipKey);
    zipOut = new ZipStream(zipS3);
  }

  // ── PHASE 1: Composite images and upload to Filebase ─────────────────────
  // No metadata uploaded here. Filebase assigns IPFS CIDs asynchronously after
  // upload — we collect them in Phase 2 so metadata is written once with the
  // correct CID (no "pending" placeholder, no separate Refresh CIDs step).
  const loopStart = Math.floor(resumeFrom / BATCH) * BATCH;
  for (let offset = loopStart; offset < total; offset += BATCH) {
    const batchEnd = Math.min(offset + BATCH, total);
    state.phase = `Phase 1 — Compositing ${offset + 1}–${batchEnd} of ${total}…`;

    const rows = await fetchEditionRows(jobId, offset, batchEnd);

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

    // Pre-warm: resize all unique layer PNGs once before workers start compositing.
    // Concurrency=10 caps memory during the first batch (each 2000×2000 resize ~16–20 MB).
    const uniquePaths = [...new Set(rows.map(r => r.file_path).filter(Boolean))] as string[];
    const PREWARM_C = 10;
    for (let p = 0; p < uniquePaths.length; p += PREWARM_C) {
      await Promise.all(uniquePaths.slice(p, p + PREWARM_C).map(fp => fetchLayerResized(fp)));
    }

    let cursor = 0;

    async function processOneImage() {
      while (cursor < editions.length) {
        const editionNum = editions[cursor++];
        // Skip editions already uploaded before this resume point.
        if (editionNum <= resumeFrom) continue;

        const editionData = byEdition.get(editionNum)!;
        const layerRows = editionData.layers;

        // ── Composite ────────────────────────────────────────────────────────
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
          }).toFormat(ext === "webp" ? "webp" : "png", ext === "webp" ? { quality: 95, effort: 4 } : {}).toBuffer();
        } else {
          const [base, ...rest] = resized;
          imgBuf = await sharp(base)
            .composite(rest.map(buf => ({ input: buf, blend: "over" as const })))
            .toFormat(ext === "webp" ? "webp" : "png", ext === "webp" ? { quality: 95, effort: 4 } : {})
            .toBuffer();
        }

        // ── Upload image only — metadata written in Phase 2 with real CID ──
        const imgKey = `images/${editionNum}.${ext}`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: imgKey, Body: imgBuf, ContentType: mime }));

        if (zipOut) zipOut.addFile(`images/${editionNum}.${ext}`, imgBuf);

        state.progress++;
        state.phase = `Phase 1 — Uploading images… ${state.progress} / ${total}`;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, processOneImage));
  }

  // ── PHASE 2: Resolve CIDs and upload metadata once with correct image URI ─
  // By the time Phase 2 reaches any edition, its image was uploaded at least
  // (META_CONCURRENCY × seconds_per_meta) ago during Phase 1, so Filebase has
  // had ample time to assign the CID. pollCid resolves on the first attempt for
  // early editions; the very last ones may need 1–2 retries but always within 30s.
  const ipfsUpdates: Array<{ editionNumber: number; ipfsImageCid: string; ipfsMetadataCid: string; imagePath: string }> = [];
  let metaDone = 0;

  for (let offset = 0; offset < total; offset += BATCH) {
    const batchEnd = Math.min(offset + BATCH, total);

    const rows2 = await fetchEditionRows(jobId, offset, batchEnd);

    const byEdition2 = new Map<number, EditionData>();
    for (const row of rows2) {
      if (!byEdition2.has(row.edition_number)) {
        byEdition2.set(row.edition_number, {
          layers: [],
          rarityScore: parseFloat(row.rarity_score ?? '0') || 0,
          rarityRank: parseInt(row.rarity_rank ?? '0', 10) || 0,
          rarityTier: row.rarity_tier ?? 'Common',
        });
      }
      byEdition2.get(row.edition_number)!.layers.push(row);
    }

    const editions2 = [...byEdition2.keys()].sort((a, b) => a - b);
    let cursor2 = 0;

    async function processOneMeta() {
      while (cursor2 < editions2.length) {
        const editionNum = editions2[cursor2++];
        const { layers, rarityScore, rarityRank, rarityTier } = byEdition2.get(editionNum)!;

        const imgKey  = `images/${editionNum}.${ext}`;
        const metaKey = `metadata/${editionNum}.json`;

        // Wait for Filebase to assign the IPFS CID to this image.
        // 30s timeout is a safety net — in practice it resolves in <5s because
        // Phase 1 uploaded this image well before Phase 2 reaches it.
        const imgCid = await pollCid(s3, bucket, imgKey, 30_000);

        const nftName = applyNameFormat(nameFormat || (collectionName ? `${collectionName} #{{id}}` : "#{{id}}"), editionNum);
        const validLayers = layers.filter(l => l.file_path);
        const traitAttributes = validLayers.map(l => ({ trait_type: l.trait_type, value: l.trait_value }));
        const baseUrl = (externalUrl.trim() || "https://www.imbearth.com").replace(/\/$/, "");

        const metaJson = JSON.stringify({
          name: nftName,
          description,
          // Correct CID embedded here — no placeholder, no refresh step needed.
          image: imgCid ? `ipfs://${imgCid}` : `ipfs://pending/${imgKey}`,
          external_url: baseUrl,
          attributes: [
            ...traitAttributes,
            { trait_type: "Rarity Score", value: rarityScore.toFixed(2) },
            { trait_type: "Rarity Rank",  value: `#${rarityRank}` },
            { trait_type: "Rarity Tier",  value: rarityTier || "Common" },
          ],
        }, null, 2);

        // Upload metadata exactly once — with the correct image CID.
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: metaKey, Body: metaJson, ContentType: "application/json" }));

        // Best-effort metadata CID (for DB). No retry — it's fine if empty here;
        // the important field (image in JSON) is already correct.
        let metaCid = "";
        try {
          const metaHead = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: metaKey }));
          metaCid = (metaHead.Metadata?.["cid"] ?? "").trim();
        } catch { /* not yet assigned — acceptable */ }

        if (zipOut) zipOut.addFile(`metadata/${editionNum}.json`, Buffer.from(metaJson, "utf8"));

        if (imgCid) {
          ipfsUpdates.push({ editionNumber: editionNum, ipfsImageCid: imgCid, ipfsMetadataCid: metaCid, imagePath: imgKey });
        }

        metaDone++;
        state.phase = `Phase 2 — Metadata uploaded… ${metaDone} / ${total}`;
      }
    }

    await Promise.all(Array.from({ length: META_CONCURRENCY }, processOneMeta));

    if (ipfsUpdates.length > 0) {
      await batchUpdateItemIpfsCids({ jobId, items: ipfsUpdates });
      ipfsUpdates.length = 0;
    }
  }

  // ── Finalise pre-built ZIP and upload to Filebase (full run only) ────────
  if (zipOut && zipS3) {
    state.phase = "Finalising download ZIP…";
    try {
      zipOut.finish();
      await zipS3.complete();
      zipRegistry.set(jobId, { bucket, zipKey });
      zipOk = true;
      console.log(`[runExport] pre-built ZIP uploaded: s3://${bucket}/${zipKey}`);
    } catch (zipErr) {
      console.error(`[runExport] pre-built ZIP failed (streaming fallback still works):`, zipErr);
      await zipS3.abort().catch(() => {});
    }
  }

  let synced = 0;
  if (syncToRecords) {
    state.phase = "Syncing to NFT Records…";
    synced = await syncGeneratedItemsToNftRecords(jobId);
  }

  const uploadedCount = total - resumeFrom;
  state.status = "done";
  state.phase = syncToRecords
    ? `Complete — ${uploadedCount} NFTs uploaded${resumeFrom > 0 ? ` (${total} total in bucket)` : ''}${zipOk ? ' · ZIP ready' : ''}, ${synced} synced to NFT Records`
    : `Complete — ${uploadedCount} NFTs uploaded${resumeFrom > 0 ? ` (${total} total in bucket)` : ''}${zipOk ? ' · ZIP ready for instant download' : ''} (test run — nft_records not updated)`;
}

export async function runPreview(
  previewId: string,
  jobId: string,
  opts: { width: number; height: number; total: number; previewDir: string },
) {
  const { total, previewDir } = opts;
  const state = previewMeta.jobs.get(previewId)!;
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

export async function runRefreshCids(refreshId: string, bucket: string, format: string) {
  const ext = format === "webp" ? "webp" : "png";
  const state = refreshCidMeta.jobs.get(refreshId)!;
  const s3 = getS3Client();

  // Resolve the most recent completed generation job so we can write CIDs back to the DB
  const { rows: jobRows } = await pool.query(
    `SELECT id FROM nft_generation_jobs WHERE status = 'complete' ORDER BY created_at DESC LIMIT 1`,
  );
  const jobId: string | null = jobRows[0]?.id ?? null;

  // 1. List every image key in the bucket (handles >1000 via pagination)
  state.phase = "Listing images in bucket…";
  const imageKeys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "images/",
      ContinuationToken: continuationToken,
    }));
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) imageKeys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  state.total = imageKeys.length;
  state.phase = `Found ${imageKeys.length} images — refreshing CIDs…`;

  let cursor = 0;
  // Accumulate resolved CID pairs for the DB batch write at the end
  const resolvedItems: Array<{ editionNumber: number; ipfsImageCid: string; ipfsMetadataCid: string }> = [];

  async function processOne() {
    while (cursor < imageKeys.length) {
      const imgKey = imageKeys[cursor++];
      // Extract edition number from "images/123.png" → 123
      const basename = imgKey.replace(/^images\//, "").replace(/\.\w+$/, "");
      const editionNum = parseInt(basename, 10);
      if (isNaN(editionNum)) { state.progress++; state.skipped++; continue; }

      const metaKey = `metadata/${editionNum}.json`;

      // HeadObject both image and metadata in parallel — Filebase sets x-amz-meta-cid on IPFS-backed objects
      let imgCid: string;
      let metaCid: string;
      try {
        const [imgHead, metaHead] = await Promise.all([
          s3.send(new HeadObjectCommand({ Bucket: bucket, Key: imgKey })),
          s3.send(new HeadObjectCommand({ Bucket: bucket, Key: metaKey })).catch(() => null),
        ]);
        imgCid = (imgHead.Metadata?.["cid"] ?? "").trim();
        metaCid = ((metaHead?.Metadata?.["cid"]) ?? "").trim();
      } catch {
        state.progress++; state.skipped++;
        state.phase = `Refreshing CIDs… ${state.progress} / ${state.total}`;
        continue;
      }

      if (!imgCid) {
        // CID not yet assigned by Filebase — skip for now (user can re-run later)
        state.progress++; state.skipped++;
        state.phase = `Refreshing CIDs… ${state.progress} / ${state.total}`;
        continue;
      }

      // Fetch existing metadata JSON
      let parsed: Record<string, unknown>;
      try {
        const getResp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: metaKey }));
        const raw = (await streamToBuffer(getResp.Body)).toString("utf8");
        parsed = JSON.parse(raw);
      } catch {
        state.progress++; state.skipped++;
        state.phase = `Refreshing CIDs… ${state.progress} / ${state.total}`;
        continue;
      }

      // Skip if already resolved (no pending placeholder present)
      if (!String(parsed.image ?? "").includes("pending")) {
        state.progress++; state.skipped++;
        state.phase = `Refreshing CIDs… ${state.progress} / ${state.total}`;
        continue;
      }

      // Replace placeholder with real IPFS URI and re-upload to Filebase
      parsed.image = `ipfs://${imgCid}`;
      const newMeta = JSON.stringify(parsed, null, 2);

      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: metaKey,
        Body: newMeta,
        ContentType: "application/json",
      }));

      // Collect for DB batch update (only when both CIDs are available)
      if (metaCid) {
        resolvedItems.push({ editionNumber: editionNum, ipfsImageCid: imgCid, ipfsMetadataCid: metaCid });
      }

      state.progress++;
      state.resolved++;
      state.phase = `Refreshing CIDs… ${state.progress} / ${state.total}`;
    }
  }

  await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, processOne));

  // 2. Write resolved CIDs back to nft_generated_items
  if (jobId && resolvedItems.length > 0) {
    state.phase = `Writing ${resolvedItems.length} CIDs to database…`;
    await batchUpdateItemIpfsCids({ jobId, items: resolvedItems });

    // 3. Propagate image_ipfs_hash / metadata_ipfs_hash / metadata_uri → nft_records
    state.phase = "Syncing CIDs to NFT records…";
    await syncGeneratedItemsToNftRecords(jobId);
  }

  state.status = "done";
  state.phase = `Complete — ${state.resolved} CIDs resolved${state.skipped > 0 ? `, ${state.skipped} skipped (not yet assigned)` : ""}`;
}
