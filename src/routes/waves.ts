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
      "SELECT id, wave_number, status, scheduled_start, scheduled_end FROM nft_waves WHERE id = $1::uuid",
      [id],
    );
    if (!existing.length) return res.status(404).json({ error: "Wave not found" });

    const wave       = existing[0];
    const waveNumber = Number(wave.wave_number);
    const existingStart = wave.scheduled_start ? new Date(wave.scheduled_start) : null;
    const existingEnd   = wave.scheduled_end   ? new Date(wave.scheduled_end)   : null;
    const now = new Date();

    const startVal = clearSchedule ? null : (scheduledStart ?? null);
    const endVal   = clearSchedule ? null : (scheduledEnd   ?? null);

    // effective end = incoming value if provided, otherwise the current DB value
    const effectiveEnd = endVal ? new Date(endVal) : existingEnd;

    // Rule 6: once scheduled_start has arrived the schedule is LOCKED — no date changes
    // Only trigger if non-null dates are being set (null = keep existing, not a change)
    const isDateChange = clearSchedule === true ||
      (scheduledStart   !== undefined && scheduledStart   !== null) ||
      (scheduledEnd     !== undefined && scheduledEnd     !== null) ||
      (revealScheduledAt !== undefined && revealScheduledAt !== null);
    if (isDateChange && existingStart && now >= existingStart) {
      return res.status(409).json({
        error: `Wave ${waveNumber} schedule is locked — the start date (${existingStart.toISOString()}) has already arrived. No date changes are allowed.`,
      });
    }

    // Sequential gate — Wave N's start must be strictly after Wave N-1's end.
    // We enforce date ordering only (not "Wave N-1 must be physically closed"),
    // so all waves can be pre-scheduled upfront as long as timestamps are valid.
    if (waveNumber > 1 && (startVal || endVal)) {
      const { rows: prevRows } = await pool.query(
        "SELECT scheduled_end FROM nft_waves WHERE wave_number = $1",
        [waveNumber - 1],
      );
      const prevEnd = prevRows[0]?.scheduled_end ? new Date(prevRows[0].scheduled_end) : null;
      if (!prevEnd) {
        return res.status(409).json({
          error: `Wave ${waveNumber - 1} has no schedule yet — set Wave ${waveNumber - 1} schedule first.`,
        });
      }
      if (startVal && new Date(startVal) <= prevEnd) {
        return res.status(409).json({
          error: `Wave ${waveNumber} start must be strictly after Wave ${waveNumber - 1} end (${prevEnd.toISOString()}).`,
        });
      }
    }

    // start < end (within same wave)
    if (startVal && endVal && new Date(startVal) >= new Date(endVal)) {
      return res.status(400).json({ error: "Scheduled end must be after start" });
    }

    // Rule 4: reveal_scheduled_at must be strictly AFTER the wave's own end
    if (revealScheduledAt && effectiveEnd && new Date(revealScheduledAt) <= effectiveEnd) {
      return res.status(400).json({ error: "Reveal date must be strictly after wave end date" });
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
