import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as waveService from "../../services/wave.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft.waves.view");
    const waves = await waveService.listWaves();
    res.json({ waves });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft.waves.view");
    const wave = await waveService.getWave(req.params.id);
    if (!wave) { res.status(404).json({ error: "Wave not found" }); return; }
    res.json({ wave });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft.waves.manage");
    const body = req.body ?? {};

    const scheduledEnd        = body.scheduledEnd       ?? null;
    const revealScheduledAt   = body.revealScheduledAt !== undefined ? body.revealScheduledAt ?? null : undefined;

    if (revealScheduledAt && scheduledEnd && new Date(revealScheduledAt as string) < new Date(scheduledEnd as string)) {
      res.status(400).json({ error: "Reveal date must be after wave end date" }); return;
    }

    const wave = await waveService.updateWave(req.params.id, {
      defaultPriceEth:    body.defaultPriceEth !== undefined ? Number(body.defaultPriceEth) || null : undefined,
      saleMethod:         body.saleMethod    ?? null,
      scheduledStart:     body.scheduledStart ?? null,
      scheduledEnd,
      status:             body.status         ?? null,
      notes:              body.notes          ?? null,
      clearSchedule:      body.clearSchedule  ?? false,
      revealScheduledAt,
      tierPrices:         body.tierPrices     ?? null,
    });
    if (!wave) { res.status(404).json({ error: "Wave not found" }); return; }
    res.json({ wave });
  } catch (e) { next(e); }
});

export default router;
