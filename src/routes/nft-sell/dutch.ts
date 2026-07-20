import { Router } from "express";
import { ethers } from "ethers";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";
import {
  contractSetDutchAuction,
  contractGetCurrentDutchPrice,
} from "../../services/contract.service";

const router = Router();

// GET /api/nft-sell/dutch — list waves with Dutch Auction enabled
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_waves_dutch_list()", []);
    res.json({ waves: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/dutch — configure Dutch Auction for a wave (admin)
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

    const startWei = ethers.parseEther(start_price_eth.toString());
    const floorWei = ethers.parseEther(floor_price_eth.toString());
    const decrementWei = ethers.parseEther(decrement_eth.toString());

    const receipt = await contractSetDutchAuction(
      wave_num,
      startWei,
      floorWei,
      decrementWei,
      interval_secs
    );

    await pool.query("SELECT nft_wave_set_dutch_config($1,$2,$3,$4,$5,$6)", [wave_num, start_price_eth, floor_price_eth, decrement_eth, interval_secs, true]);

    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/dutch/:waveNum/price — get current Dutch price from contract
router.get("/:waveNum/price", async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNum, 10);

    if (isNaN(waveNum)) {
      return res.status(400).json({ error: "waveNum must be a number" });
    }

    const result = await contractGetCurrentDutchPrice(waveNum);

    res.json({
      wave_num: waveNum,
      currentPriceEth: ethers.formatEther(result.currentPrice),
      isFloor: result.isFloor,
      auctionStarted: result.auctionStarted,
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
