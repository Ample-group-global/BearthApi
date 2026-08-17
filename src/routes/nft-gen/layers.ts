import multer from "multer";
import { Router } from "express";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { requirePermission } from "../../adminAuth";
import * as svc from "../../services/nft-gen.service";
import { getS3Client } from "../../clients/s3";
import { deleteObjectsChunked } from "../../utils/deleteObjects";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
router.post("/clear-bucket", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const bucket = process.env.FILEBASE_LAYERS_BUCKET || "bearth-layers";
    const s3 = getS3Client();
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }));

      const keys = (list.Contents ?? []).map(o => o.Key!).filter(Boolean);
      if (keys.length) deleted += await deleteObjectsChunked(s3, bucket, keys);

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    res.json({ ok: true, bucket, deleted });
  } catch (e) { next(e); }
});

// ── POST /upload — receive layer PNGs from BearthAdmin, save to Filebase S3 ──
router.post("/upload", upload.array("files"), async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");

    const layer = (req.body?.layer ?? "") as string;
    const subpaths = ([] as string[]).concat(req.body?.subpaths ?? []);
    const files = (req.files ?? []) as Express.Multer.File[];

    // Must preserve the folder name exactly as uploaded (spaces included) —
    // the DB's trait.file_path and every read-side fetch (/api/thumb,
    // /api/layer-img, layers-organise) use the original folder name
    // untouched. Previously this stripped spaces (e.g. "01_BEAR HEAD" ->
    // "01_BEARHEAD"), so the upload landed at a key nothing ever looked for
    // — confirmed live 2026-08-17: two whole layers uploaded successfully
    // per the API response but were permanently unreachable as 404s,
    // because the write path and every read path disagreed on the key.
    const safe = layer.trim().replace(/[^a-zA-Z0-9\-_ ]/g, "");
    if (!safe) { res.status(400).json({ error: "layer name required" }); return; }
    const added: string[] = [];
    const s3Uploaded: string[] = [];
    const s3Failures: string[] = [];

    // S3 PUTs don't touch the DB pool, so these can run at higher concurrency
    // than DB-bound work — bounded batches instead of one sequential loop so
    // a large layer (50+ files) doesn't upload one file at a time.
    const S3_CONCURRENCY = 12;
    for (let i = 0; i < files.length; i += S3_CONCURRENCY) {
      await Promise.all(files.slice(i, i + S3_CONCURRENCY).map(async (file, j) => {
        const idx = i + j;
        const sub = (subpaths[idx] ?? "").replace(/\.\./g, "").replace(/^\//, "");
        const base = file.originalname.split(/[\\/]/).pop() ?? file.originalname;
        const safeName = base.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        if (!safeName.match(/\.(png|webp|jpg|jpeg|gif)$/i)) return;
        const rel = sub ? `${safe}/${sub}` : `${safe}/${safeName}`;
        try {
          // Generates + stores the display thumbnail right here, from the
          // buffer already in memory — Organize/Preview never have to resize
          // this file on the fly.
          await svc.uploadLayerImageWithThumb(rel, file.buffer);
          s3Uploaded.push(rel);
          added.push(rel);
        } catch {
          s3Failures.push(rel);
        }
      }));
    }

    res.json({ ok: true, added, s3Uploaded, s3Failures });
  } catch (e) { next(e); }
});

router.get("/image", async (req, res, next) => {
  try {
    const rel = req.query.rel as string | undefined;
    if (!rel || rel.includes("..") || rel.startsWith("/")) {
      res.status(400).json({ error: "Invalid rel path." });
      return;
    }
    // Only the Organize/Preview thumb strip calls this route, displayed at a few
    // hundred px — default to a resized thumbnail instead of the full 2000x2000
    // original (?full=1 opts back into the original for any future caller that
    // genuinely needs it).
    const buf = req.query.full
      ? await svc.fetchLayerImage(rel)
      : await svc.fetchLayerThumb(rel);
    if (!buf) { res.status(404).json({ error: "Image not found." }); return; }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const data = await svc.getLayer(req.params.id);
    if (!data) { res.status(404).json({ error: "Layer not found." }); return; }
    res.json(data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const layer = await svc.updateLayer(req.params.id, req.body ?? {});
    if (!layer) { res.status(404).json({ error: "Layer not found." }); return; }
    res.json({ layer });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const result = await svc.deleteLayer(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

// ── Traits nested under layer ────────────────────────────────────────────────

router.get("/:id/traits", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const traits = await svc.listTraits(req.params.id);
    res.json({ traits });
  } catch (e) { next(e); }
});

router.post("/:id/traits/reconcile", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const { activeFilePaths } = req.body ?? {};
    if (!Array.isArray(activeFilePaths)) {
      res.status(422).json({ error: "activeFilePaths must be an array." }); return;
    }
    const result = await svc.reconcileTraits(req.params.id, activeFilePaths);
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/:id/traits/bulk", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const { traits } = req.body ?? {};
    if (!Array.isArray(traits) || !traits.length) {
      res.status(422).json({ error: "traits must be a non-empty array." }); return;
    }
    const VALID_TIERS = ["legendary", "epic", "rare", "common"];
    for (const t of traits) {
      if (!t?.name?.trim()) { res.status(422).json({ error: "Every trait needs a name." }); return; }
      if (!t?.filePath?.trim()) { res.status(422).json({ error: "Every trait needs a filePath." }); return; }
      const tier = (t.rarityTier ?? "common").toLowerCase();
      if (!VALID_TIERS.includes(tier)) {
        res.status(422).json({ error: "rarityTier must be one of: legendary, epic, rare, common." }); return;
      }
      t.rarityTier = tier;
    }
    const created = await svc.createTraitsBulk(req.params.id, traits);
    res.status(201).json({ traits: created, count: created.length });
  } catch (e) { next(e); }
});

router.post("/:id/traits", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const { name, filePath } = req.body ?? {};
    if (!name?.trim()) { res.status(422).json({ error: "Trait name is required." }); return; }
    if (!filePath?.trim()) { res.status(422).json({ error: "File path is required." }); return; }
    const VALID_TIERS = ["legendary", "epic", "rare", "common"];
    const tier = (req.body.rarityTier ?? "common").toLowerCase();
    if (!VALID_TIERS.includes(tier)) {
      res.status(422).json({ error: "rarityTier must be one of: legendary, epic, rare, common." }); return;
    }
    const trait = await svc.createTrait({ layerId: req.params.id, ...req.body, rarityTier: tier });
    res.status(201).json({ trait });
  } catch (e) { next(e); }
});

export default router;
