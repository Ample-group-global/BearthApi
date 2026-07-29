import { Router } from "express";
import pool from "../../pool";
import { contractBreedMint } from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/burn/ratios — list burn ratios (common→rare etc.)
router.get("/ratios", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_burn_ratios_list()", []);
    res.json({ ratios: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/burn/ratios — upsert a burn ratio
// Body: { from_rarity: string, to_rarity: string, burn_count: number }
router.put("/ratios", requireAdmin, async (req, res, next) => {
  try {
    const { from_rarity, to_rarity, burn_count } = req.body as {
      from_rarity: string; to_rarity: string; burn_count: number;
    };

    if (!from_rarity || !to_rarity || !burn_count)
      return res.status(400).json({ error: "from_rarity, to_rarity and burn_count required" });
    if (burn_count < 2)
      return res.status(400).json({ error: "burn_count must be at least 2" });

    const { rows } = await pool.query("SELECT nft_burn_ratio_upsert($1,$2,$3)", [from_rarity, to_rarity, burn_count]);
    res.json({ ok: true, ratio: rows[0]?.nft_burn_ratio_upsert });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/burn/execute — execute breedMint on-chain + update DB
// Body: { burn_nft_record_ids: string[], recipient_wallet: string, outputRarity: number }
// outputRarity: 1=Common 2=Rare 3=Epic 4=Legendary
router.post("/execute", requireAdmin, async (req, res, next) => {
  try {
    const { burn_nft_record_ids, recipient_wallet, outputRarity } = req.body as {
      burn_nft_record_ids: string[]; recipient_wallet: string; outputRarity: number;
    };

    if (!burn_nft_record_ids?.length)
      return res.status(400).json({ error: "burn_nft_record_ids array required" });
    if (!recipient_wallet)
      return res.status(400).json({ error: "recipient_wallet required" });
    if (!outputRarity || ![1, 2, 3, 4].includes(outputRarity))
      return res.status(400).json({ error: "outputRarity must be 1 (Common), 2 (Rare), 3 (Epic), or 4 (Legendary)" });

    // Fetch token IDs for the given record UUIDs
    const { rows: nftRows } = await pool.query("SELECT id, token_id, rarity_tier FROM nft_records WHERE id=ANY($1::uuid[]) AND is_burned=FALSE", [burn_nft_record_ids]);

    if (nftRows.length !== burn_nft_record_ids.length)
      return res.status(400).json({ error: "One or more NFT records not found or already burned" });

    const tokenIds = nftRows.map((r: { token_id: number }) => r.token_id);

    // Execute on-chain breed: burn input tokens, mint one upgraded token to recipient
    const receipt = await contractBreedMint(recipient_wallet, outputRarity, tokenIds);

    // Mark burned records in DB
    await pool.query("SELECT nft_records_mark_burned($1,$2)", [burn_nft_record_ids, receipt.hash]);

    // The Minted event will create the upgraded NFT record via syncEvent → nft_record_sync_mint
    // We also link the upgraded record back to what was burned
    const { rows: upgradedRows } = await pool.query("SELECT id FROM nft_records WHERE mint_tx_hash=$1 ORDER BY created_at DESC LIMIT 1", [receipt.hash]);
    if (upgradedRows[0]?.id) {
      await pool.query("SELECT nft_record_mark_upgraded($1,$2,$3)", [upgradedRows[0].id, burn_nft_record_ids, receipt.hash]);
    }

    res.json({
      ok: true,
      txHash: receipt.hash,
      burned_count: tokenIds.length,
      upgraded_record_id: upgradedRows[0]?.id ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/burn/history — list burned NFTs and their upgrades
router.get("/history", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        nr.id, nr.token_id, nr.serial_number, nr.rarity_tier,
        nr.burn_tx_hash, nr.burned_at, nr.upgraded_from
      FROM nft_records nr
      WHERE nr.is_burned = TRUE
      ORDER BY nr.burned_at DESC
      LIMIT 200
    `, []);
    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
