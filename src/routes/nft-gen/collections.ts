import path   from "path";
import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import pool from "../../pool";
import * as svc from "../../services/nft-gen.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const result = await svc.listCollections({
      limit: Number(req.query.limit ?? 50),
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
router.get("/:id/layers-organise", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.view");
    const { rows: layerRows } = await pool.query(
      "SELECT * FROM nft_gen_layers_list($1::uuid)", [req.params.id]
    );
    const active = layerRows
      .filter((l: any) => l.is_active)
      .sort((a: any, b: any) => a.sort_order - b.sort_order);

    if (!active.length) { res.json({ layers: [] }); return; }

    const layerIds = active.map((l: any) => l.id);
    const { rows: traitRows } = await pool.query(
      "SELECT * FROM nft_traits WHERE layer_id = ANY($1::uuid[]) AND is_active = true",
      [layerIds]
    );

    const layers = active.map((l: any) => {
      const traits = traitRows.filter((t: any) => t.layer_id === l.id);
      return {
        id:        l.id,
        folder:    l.name,
        label:     l.display_name ?? l.name,
        count:     traits.length,
        optional:  l.layer_rarity_pct != null && Number(l.layer_rarity_pct) < 100,
        bypassDna: l.bypass_dna ?? false,
        rarityPct: Number(l.layer_rarity_pct ?? 100),
        sortOrder: Number(l.sort_order ?? 0),
        assets: traits.map((t: any) => ({
          id:            t.id,
          stem:          path.basename(t.file_path, path.extname(t.file_path)),
          name:          t.name,
          rel:           t.file_path,
          defaultWeight: Number(t.rarity_weight ?? 1),
        })),
      };
    });
    res.json({ layers });
  } catch (e) { next(e); }
});

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

router.post("/:id/layers/reconcile", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.manage_layers");
    const { activeNames } = req.body ?? {};
    if (!Array.isArray(activeNames)) {
      res.status(422).json({ error: "activeNames must be an array." }); return;
    }
    const result = await svc.reconcileLayers(req.params.id, activeNames);
    res.json(result);
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
