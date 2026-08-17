import fs from "fs";
import path from "path";
import multer from "multer";
import { Router } from "express";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { requirePermission } from "../../adminAuth";
import * as svc from "../../services/nft-gen.service";
import { getS3Client } from "../../clients/s3";
import { getLayersDir } from "../../utils/layers-dir";

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
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map(k => ({ Key: k })), Quiet: true },
        }));
        deleted += keys.length;
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    res.json({ ok: true, bucket, deleted });
  } catch (e) { next(e); }
});

// ── POST /upload — receive layer PNGs from BearthAdmin, save to disk + S3 ────
router.post("/upload", upload.array("files"), async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");

    const layer = (req.body?.layer ?? "") as string;
    const subpaths = ([] as string[]).concat(req.body?.subpaths ?? []);
    const files = (req.files ?? []) as Express.Multer.File[];

    const safe = layer.replace(/[^a-zA-Z0-9\-_]/g, "");
    if (!safe) { res.status(400).json({ error: "layer name required" }); return; }
    const layersDir = getLayersDir();
    const added: string[] = [];
    const s3Uploaded: string[] = [];
    const s3Failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sub = (subpaths[i] ?? "").replace(/\.\./g, "").replace(/^\//, "");
      const base = file.originalname.split(/[\\/]/).pop() ?? file.originalname;
      const safeName = base.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      if (!safeName.match(/\.(png|webp|jpg|jpeg|gif)$/i)) continue;
      const rel = sub ? `${safe}/${sub}` : `${safe}/${safeName}`;
      const targetDir = path.join(layersDir, safe, path.dirname(sub || safeName));
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(layersDir, rel), file.buffer);
      try {
        await svc.uploadLayerImage(rel, file.buffer);
        s3Uploaded.push(rel);
      } catch {
        s3Failures.push(rel);
      }

      added.push(rel);
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
    const buf = await svc.fetchLayerImage(rel);
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
