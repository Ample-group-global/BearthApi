import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as nftService from "../../services/nft.service";
import pool from "../../pool";
import { repairTreasuryMintsForWave } from "../../services/reveal.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft.view");
    const revealedRaw   = req.query.revealed    as string | undefined;
    const mintedRaw     = req.query.minted      as string | undefined;
    const sortDirRaw    = req.query.sort_dir    as string | undefined;
    const waveNumRaw    = req.query.wave_number as string | undefined;
    const mintTypeRaw   = req.query.mint_type   as string | undefined;
    const rarityTierRaw = req.query.rarity_tier as string | undefined;

    const VALID_MINT_TYPES   = new Set(["free", "paid", "admin", "treasury"]);
    const VALID_RARITY_TIERS = new Set(["legendary", "epic", "rare", "common"]);

    const result = await nftService.listNft({
      search:             (req.query.search          as string) ?? null,
      deliveryStatusCode: (req.query.delivery_status as string) ?? null,
      stageCode:          (req.query.stage           as string) ?? null,
      revealed:           revealedRaw === "true" ? true : revealedRaw === "false" ? false : null,
      minted:             mintedRaw   === "true" ? true : mintedRaw   === "false" ? false : null,
      waveId:             (req.query.wave_id         as string) ?? null,
      waveNumber:         waveNumRaw ? Number(waveNumRaw) : null,
      mintedFrom:         (req.query.minted_from     as string) ?? null,
      mintedTo:           (req.query.minted_to       as string) ?? null,
      mintType:           (mintTypeRaw   && VALID_MINT_TYPES.has(mintTypeRaw.toLowerCase()))     ? mintTypeRaw.toLowerCase()   : null,
      rarityTier:         (rarityTierRaw && VALID_RARITY_TIERS.has(rarityTierRaw.toLowerCase())) ? rarityTierRaw.toLowerCase() : null,
      limit:              Number(req.query.limit  ?? 20),
      offset:             Number(req.query.offset ?? 0),
      sortBy:             (req.query.sort_by         as string) ?? null,
      sortDir:            sortDirRaw === "desc" ? "desc" : sortDirRaw === "asc" ? "asc" : null,
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

// POST /api/nfts/:id/treasury-move
// Per-token treasury flow for a reserved (unminted) NFT.
// Calls contractTreasuryClose for the NFT's wave (mints all unsold in wave to recipient).
// Body: { recipient?: string } â€” 0x address or omit to use contract's treasury wallet.
router.post("/:id/treasury-move", async (req, res, next) => {
  try {
    requirePermission(req, "nft.edit");

    // Validate NFT is reserved and unminted
    const { rows } = await pool.query<{ wave_number: number | null; delivery_status_code: string; token_id: number | null }>(
      `SELECT w.wave_number, lv.code AS delivery_status_code, nr.token_id
         FROM v_nft_records nr
         LEFT JOIN nft_waves w ON nr.wave_id = w.id
         LEFT JOIN lookup_values lv ON lv.id = nr.delivery_status_id
        WHERE nr.id = $1::uuid`,
      [req.params.id],
    );
    if (!rows[0]) { res.status(404).json({ error: "NFT record not found" }); return; }
    const { wave_number, delivery_status_code, token_id } = rows[0];
    if (delivery_status_code !== "treasury_pending") {
      res.status(400).json({ error: `NFT is not in treasury_pending status (current: ${delivery_status_code})` }); return;
    }
    if (token_id != null) {
      res.status(400).json({ error: "NFT already minted â€” use the reveal or treasury-move endpoint instead" }); return;
    }
    if (wave_number == null) {
      res.status(400).json({ error: "NFT has no wave assigned" }); return;
    }

    const { recipient } = req.body as { recipient?: string };
    if (recipient && !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      res.status(400).json({ error: "recipient must be a valid Ethereum address" }); return;
    }

    const deliveryCode = recipient ? "transferred" : "treasury_wallet";

    const { contractTreasuryClose } = await import("../../services/contract.service");
    // Call contract — if wave already closed on-chain (prior session), skip tx and just sync DB
    let txHash: string | null = null;
    try {
      const receipt = await contractTreasuryClose(wave_number, recipient ?? null);
      txHash = receipt.hash;
    } catch (err) {
      const msg = String((err as any)?.reason ?? (err as any)?.message ?? "");
      if (!msg.includes("WaveAlreadyClosed") && !msg.includes("already been closed")) throw err;
      // Wave already closed on-chain — fall through to DB sync
    }

    // Update DB: all unminted treasury_pending NFTs in this wave -> treasury_wallet/transferred
    await pool.query(
      `UPDATE nft_records nr
          SET delivery_status_id = (SELECT id FROM lookup_values WHERE category = 'delivery_status' AND code = $2),
              delivered_at       = NOW(),
              updated_at         = NOW()
        WHERE nr.wave_id = (SELECT id FROM nft_waves WHERE wave_number = $1)
          AND nr.token_id IS NULL
          AND nr.delivery_status_id IN (
            SELECT id FROM lookup_values WHERE category = 'delivery_status' AND code IN ('treasury_pending','pool_assigned')
          )`,
      [wave_number, deliveryCode],
    );
    // Fire-and-forget repair: assigns token_ids from on-chain Transfer events,
    // marks is_revealed=true, syncs artwork — fixes what nft_record_sync_mint misses
    repairTreasuryMintsForWave(wave_number).catch(e =>
      console.error(`[treasury-move] repair background error:`, e)
    );

    res.json({ ok: true, txHash, waveNumber: wave_number });
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
