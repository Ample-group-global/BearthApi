import { Router } from "express";
import pool from "../pool";
import { requireAdmin } from "../adminAuth";
import { _syncRevealedMetadata } from "../services/reveal.service";

const router = Router();

// PUT /api/waves/:id — update wave DB fields (schedule, price, status, tier prices, reveal date)
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      defaultPriceEth,
      saleMethod,
      scheduledStart,
      scheduledEnd,
      status,
      notes,
      clearSchedule,
      revealScheduledAt,
      tierPrices,
    } = req.body as {
      defaultPriceEth?:    number | null;
      saleMethod?:         string | null;
      scheduledStart?:     string | null;
      scheduledEnd?:       string | null;
      status?:             string | null;
      notes?:              string | null;
      clearSchedule?:      boolean;
      revealScheduledAt?:  string | null;
      tierPrices?:         { legendary?: number; epic?: number; rare?: number; common?: number } | null;
    };

    if (!id) return res.status(400).json({ error: "Wave id required" });

    const { rows: existing } = await pool.query(
      "SELECT id, wave_number, status FROM nft_waves WHERE id = $1::uuid",
      [id],
    );
    if (!existing.length) return res.status(404).json({ error: "Wave not found" });

    const wave = existing[0];

    const startVal = clearSchedule ? null : (scheduledStart ?? null);
    const endVal   = clearSchedule ? null : (scheduledEnd   ?? null);

    if (startVal && endVal && new Date(startVal) >= new Date(endVal)) {
      return res.status(400).json({ error: "Scheduled end must be after start" });
    }

    if (revealScheduledAt && endVal && new Date(revealScheduledAt) < new Date(endVal)) {
      return res.status(400).json({ error: "Reveal date must be after wave end date" });
    }

    await pool.query(
      `UPDATE nft_waves SET
        default_price_eth    = COALESCE($2, default_price_eth),
        sale_method          = COALESCE($3, sale_method),
        scheduled_start      = $4,
        scheduled_end        = $5,
        status               = COALESCE($6, status),
        notes                = COALESCE($7, notes),
        reveal_scheduled_at  = $8,
        tier_prices          = COALESCE($9::jsonb, tier_prices),
        wave_start_triggered = CASE WHEN $4 IS DISTINCT FROM scheduled_start THEN FALSE ELSE wave_start_triggered END,
        wave_end_triggered   = CASE WHEN $5 IS DISTINCT FROM scheduled_end   THEN FALSE ELSE wave_end_triggered   END,
        wave_reveal_triggered= CASE WHEN $8 IS DISTINCT FROM reveal_scheduled_at THEN FALSE ELSE wave_reveal_triggered END,
        updated_at           = NOW()
       WHERE id = $1::uuid`,
      [
        id,
        defaultPriceEth ?? null,
        saleMethod      ?? null,
        startVal,
        endVal,
        status          ?? null,
        notes           ?? null,
        revealScheduledAt ?? null,
        tierPrices ? JSON.stringify(tierPrices) : null,
      ],
    );

    const { rows } = await pool.query("SELECT * FROM nft_waves WHERE id = $1::uuid", [id]);
    res.json({ ok: true, wave: rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/waves/:waveNumber/sync-metadata — re-fetch IPFS metadata for all tokens in a revealed wave
router.post("/:waveNumber/sync-metadata", requireAdmin, async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNumber, 10);
    if (isNaN(waveNum)) { res.status(400).json({ error: "Invalid wave number" }); return; }
    await _syncRevealedMetadata(waveNum);
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS synced FROM nft_records WHERE on_chain_wave_num = $1 AND image_ipfs_hash IS NOT NULL`,
      [waveNum],
    );
    res.json({ ok: true, waveNumber: waveNum, synced: Number(rows[0].synced) });
  } catch (err) { next(err); }
});

export default router;
