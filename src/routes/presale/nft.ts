import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as nftService from "../../services/nft.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft.view");
    const revealedRaw = req.query.revealed as string | undefined;
    const result = await nftService.listNft({
      search:             (req.query.search          as string) ?? null,
      deliveryStatusCode: (req.query.delivery_status as string) ?? null,
      stageCode:          (req.query.stage           as string) ?? null,
      revealed:           revealedRaw === "true" ? true : revealedRaw === "false" ? false : null,
      waveId:             (req.query.wave_id         as string) ?? null,
      limit:              Number(req.query.limit  ?? 20),
      offset:             Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft.edit");
    const { serialNumber, stageId, nftTypeId, deliveryStatusId, notes } = req.body ?? {};
    const nftRecord = await nftService.createNft({ serialNumber, stageId, nftTypeId, deliveryStatusId, notes });
    res.status(201).json({ nftRecord });
  } catch (e) { next(e); }
});

router.post("/bulk", async (req, res, next) => {
  try {
    requirePermission(req, "nft.edit");
    const records = Array.isArray(req.body) ? req.body : [];
    if (!records.length) { res.status(400).json({ error: "No records provided" }); return; }
    const results = await nftService.bulkCreateNft(records);
    const succeeded = results.filter(r => !r.error).length;
    const failed    = results.filter(r => r.error).length;
    res.status(201).json({ created: succeeded, failed, results });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft.view");
    const nftRecord = await nftService.getNft(req.params.id);
    if (!nftRecord) { res.status(404).json({ error: "NFT record not found" }); return; }
    res.json({ nftRecord });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.action === "confirm_delivery") {
      requirePermission(req, "nft.confirm_delivery");
      const nftRecord = await nftService.confirmNftDelivery(req.params.id, body.deliveryStatusId ?? null);
      res.json({ nftRecord }); return;
    }
    requirePermission(req, "nft.edit");
    const { stageId, nftTypeId, deliveryStatusId, notes, waveId, priceEth, clearPriceEth } = body;
    const nftRecord = await nftService.updateNft(req.params.id, {
      stageId, nftTypeId, deliveryStatusId, notes,
      waveId, priceEth: priceEth !== undefined ? Number(priceEth) || null : undefined,
      clearPriceEth: clearPriceEth ?? false,
    });
    res.json({ nftRecord });
  } catch (e) { next(e); }
});

export default router;
