import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as svc from "../../services/nft-gen.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const result = await svc.listCollections({
      limit:  Number(req.query.limit  ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { userId } = requirePermission(req, "nft_gen.manage_collections");
    const { name } = req.body ?? {};
    if (!name?.trim()) { res.status(422).json({ error: "Collection name is required." }); return; }
    const collection = await svc.createCollection({ ...req.body, createdBy: userId });
    res.status(201).json({ collection });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const data = await svc.getCollection(req.params.id);
    if (!data) { res.status(404).json({ error: "Collection not found." }); return; }
    res.json(data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_collections");
    const collection = await svc.updateCollection(req.params.id, req.body ?? {});
    if (!collection) { res.status(404).json({ error: "Collection not found." }); return; }
    res.json({ collection });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_collections");
    const result = await svc.deleteCollection(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

// ── Layers nested under collection ──────────────────────────────────────────

router.get("/:id/layers", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const layers = await svc.listLayers(req.params.id);
    res.json({ layers });
  } catch (e) { next(e); }
});

router.post("/:id/layers", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const { name } = req.body ?? {};
    if (!name?.trim()) { res.status(422).json({ error: "Layer name is required." }); return; }
    const layer = await svc.createLayer({ collectionId: req.params.id, ...req.body });
    res.status(201).json({ layer });
  } catch (e) { next(e); }
});

router.put("/:id/layers/reorder", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: "items array is required." }); return;
    }
    const result = await svc.reorderLayers(req.params.id, items);
    res.json(result);
  } catch (e) { next(e); }
});

// ── Jobs nested under collection ─────────────────────────────────────────────

router.post("/:id/jobs", async (req, res, next) => {
  try {
    const { userId } = requirePermission(req, "nft_gen.generate");
    const { editionSize } = req.body ?? {};
    if (!editionSize || Number(editionSize) <= 0) {
      res.status(422).json({ error: "editionSize must be greater than 0." }); return;
    }
    const job = await svc.createJob({ collectionId: req.params.id, editionSize: Number(editionSize), createdBy: userId });
    res.status(201).json({ job });
  } catch (e) { next(e); }
});

export default router;
