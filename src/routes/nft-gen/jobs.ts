import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as svc from "../../services/nft-gen.service";

const router = Router();

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const data = await svc.getJob(req.params.id);
    if (!data) { res.status(404).json({ error: "Job not found." }); return; }
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/:id/start", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.generate");
    const result = await svc.startJob(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

router.patch("/:id/progress", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.generate");
    const { progress } = req.body ?? {};
    if (progress === undefined || Number(progress) < 0 || Number(progress) > 100) {
      res.status(422).json({ error: "progress must be between 0 and 100." }); return;
    }
    const result = await svc.updateJobProgress(req.params.id, Number(progress));
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/:id/complete", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.generate");
    const result = await svc.completeJob(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/:id/fail", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.generate");
    const { errorMessage } = req.body ?? {};
    if (!errorMessage) { res.status(422).json({ error: "errorMessage is required." }); return; }
    const result = await svc.failJob(req.params.id, errorMessage);
    res.json(result);
  } catch (e) { next(e); }
});

// ── Items under job ───────────────────────────────────────────────────────────

router.get("/:id/items", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const result = await svc.listItems({
      jobId:  req.params.id,
      limit:  Number(req.query.limit  ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/:id/rarity", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const data = await svc.getRarityReport(req.params.id);
    res.json(data ?? { totalEditions: 0, traits: [] });
  } catch (e) { next(e); }
});

// ── Upload batches under job ──────────────────────────────────────────────────

router.post("/:id/upload-batches", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.upload_ipfs");
    const { provider, batchType, totalItems } = req.body ?? {};
    if (!provider) { res.status(422).json({ error: "provider is required." }); return; }
    if (!batchType) { res.status(422).json({ error: "batchType is required." }); return; }
    if (!totalItems || Number(totalItems) <= 0) {
      res.status(422).json({ error: "totalItems must be greater than 0." }); return;
    }
    const batch = await svc.createUploadBatch({
      jobId: req.params.id, provider, batchType, totalItems: Number(totalItems),
    });
    res.status(201).json({ batch });
  } catch (e) { next(e); }
});

export default router;
