import { Router } from "express";
import { ethers } from "ethers";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/dutch — list waves with Dutch Auction enabled
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_waves_dutch_list()", []);
    const waves = rows.map((w: Record<string, unknown>) => ({
      wave_num:        w.wave_number,
      name:            w.name,
      status:          w.status ?? "disabled",
      start_price_eth: w.dutch_start_price_eth,
      floor_price_eth: w.dutch_floor_price_eth,
      decrement_eth:   w.dutch_decrement_eth,
      interval_secs:   w.dutch_interval_secs,
      quantity:        w.quantity,
      sold_count:      w.sold_count,
    }));
    res.json({ waves });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/dutch — configure Dutch Auction for a wave (off-chain only)
// Body: { wave_num, start_price_eth, floor_price_eth, decrement_eth, interval_secs }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { wave_num, start_price_eth, floor_price_eth, decrement_eth, interval_secs } =
      req.body as {
        wave_num: number;
        start_price_eth: number;
        floor_price_eth: number;
        decrement_eth: number;
        interval_secs: number;
      };

    if (
      wave_num == null ||
      start_price_eth == null ||
      floor_price_eth == null ||
      decrement_eth == null ||
      interval_secs == null
    ) {
      return res
        .status(400)
        .json({ error: "wave_num, start_price_eth, floor_price_eth, decrement_eth and interval_secs required" });
    }

    if (
      isNaN(Number(start_price_eth)) ||
      isNaN(Number(floor_price_eth)) ||
      isNaN(Number(decrement_eth)) ||
      isNaN(Number(interval_secs))
    ) {
      return res.status(400).json({ error: "Price and interval fields must be numeric" });
    }

    // Dutch auction is off-chain: store config in DB only.
    // Use PUT /api/nft-sell/waves/:num/price separately to push the start price on-chain.
    await pool.query("SELECT nft_wave_set_dutch_config($1,$2,$3,$4,$5,$6)", [wave_num, start_price_eth, floor_price_eth, decrement_eth, interval_secs, true]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/dutch/:waveNum/price — get current Dutch price (off-chain calculation)
router.get("/:waveNum/price", async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNum, 10);

    if (isNaN(waveNum)) {
      return res.status(400).json({ error: "waveNum must be a number" });
    }

    const { rows } = await pool.query("SELECT * FROM nft_waves_dutch_list()", []);
    const wave = rows.find((r: Record<string, unknown>) => Number(r.wave_number) === waveNum);

    if (!wave?.dutch_start_price_eth) {
      return res.json({
        wave_num:          waveNum,
        current_price_eth: null,
        is_floor:          false,
        auction_started:   false,
      });
    }

    const start        = parseFloat(wave.dutch_start_price_eth as string);
    const floor        = parseFloat(wave.dutch_floor_price_eth as string);
    const decrement    = parseFloat(wave.dutch_decrement_eth as string);
    const intervalSecs = Number(wave.dutch_interval_secs);

    const startTime = wave.dutch_updated_at
      ? new Date(wave.dutch_updated_at as string).getTime() / 1000
      : Date.now() / 1000;
    const elapsed      = Date.now() / 1000 - startTime;
    const steps        = Math.max(0, Math.floor(elapsed / intervalSecs));
    const currentPrice = Math.max(start - steps * decrement, floor);

    res.json({
      wave_num:          waveNum,
      current_price_eth: currentPrice.toFixed(4),
      current_price_wei: ethers.parseEther(currentPrice.toFixed(4)).toString(),
      is_floor:          currentPrice <= floor,
      auction_started:   true,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/dutch/:waveNum — disable Dutch Auction for a wave (admin)
router.delete("/:waveNum", requireAdmin, async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNum, 10);

    if (isNaN(waveNum)) {
      return res.status(400).json({ error: "waveNum must be a number" });
    }

    await pool.query("SELECT nft_wave_set_dutch_config($1,$2,$3,$4,$5,$6)", [waveNum, null, null, null, null, false]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
