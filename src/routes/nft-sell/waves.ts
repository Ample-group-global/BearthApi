import { Router } from "express";
import { ethers } from "ethers";
import pool from "../../pool";
import {
  contractSetWaveSchedule,
  contractSetWavePrice,
  contractMintToTreasury,
  contractBurnUnsold,
  contractMintAndTransfer,
  contractGetWaveInfo,
  contractSetDutchAuction,
  contractGetCurrentDutchPrice,
  contractSetWaveMerkleRoot,
  resyncFromBlock,
} from "../../services/contract.service";
import { buildMerkleTree } from "../../merkle";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/waves — list all 7 waves (DB mirror)
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_wave_get_all()", []);
    const waves = rows[0]?.nft_wave_get_all ?? [];
    res.json({ waves });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/waves/:num — single wave (DB + on-chain)
router.get("/:num", async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });

    const { rows } = await pool.query("SELECT nft_wave_get($1)", [num]);
    const wave = rows[0]?.nft_wave_get;
    let onChain = null;
    if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL) {
      try {
        const info = await contractGetWaveInfo(num);
        onChain = {
          price:     ethers.formatEther(info.price),
          qty:       Number(info.qty),
          soldCount: Number(info.soldCount),
          startTime: Number(info.startTime),
          endTime:   Number(info.endTime),
          closed:    info.closed,
          active:    info.active,
          revealed:  info.revealed,
        };
      } catch { onChain = null; }
    }
    res.json({ wave, onChain });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/schedule — set wave start/end time
// Body: { startUnix: number, endUnix: number }
router.put("/:num/schedule", requireAdmin, async (req, res, next) => {
  try {
    const num       = parseInt(req.params.num, 10);
    const startUnix = parseInt(req.body.startUnix, 10);
    const endUnix   = parseInt(req.body.endUnix, 10);

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!startUnix || !endUnix || endUnix <= startUnix)
      return res.status(400).json({ error: "Valid startUnix and endUnix (end > start) required" });

    const receipt = await contractSetWaveSchedule(num, startUnix, endUnix);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/price — set wave price (only before first sale)
// Body: { priceEth: string }  e.g. "0.0303"
router.put("/:num/price", requireAdmin, async (req, res, next) => {
  try {
    const num      = parseInt(req.params.num, 10);
    const priceStr = req.body.priceEth as string;

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!priceStr || isNaN(parseFloat(priceStr)))
      return res.status(400).json({ error: "priceEth (string) required, e.g. '0.0303'" });

    const priceWei = ethers.parseEther(priceStr);
    const receipt  = await contractSetWavePrice(num, priceWei);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/:num/close-treasury — mint unsold to treasury
router.post("/:num/close-treasury", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    const receipt = await contractMintToTreasury(num);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/:num/close-burn — burn unsold NFTs
router.post("/:num/close-burn", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    const receipt = await contractBurnUnsold(num);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/:num/auction-listing — record OpenSea auction details
// Body: { listingId: string, startPriceEth: string, auctionEndTime?: string }
router.post("/:num/auction-listing", requireAdmin, async (req, res, next) => {
  try {
    const num           = parseInt(req.params.num, 10);
    const { listingId, startPriceEth, auctionEndTime } = req.body as {
      listingId: string; startPriceEth: string; auctionEndTime?: string;
    };
    if (isNaN(num) || num < 3 || num > 7)
      return res.status(400).json({ error: "Auction listings are for Waves 3–7 only" });
    if (!listingId || !startPriceEth)
      return res.status(400).json({ error: "listingId and startPriceEth required" });

    await pool.query("SELECT nft_wave_set_auction_listing($1,$2,$3,$4)", [num, listingId, parseFloat(startPriceEth), auctionEndTime ?? null]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/:num/mint-transfer — mint & transfer after auction (Waves 3–7)
// Body: { to: string, qty: number }
router.post("/:num/mint-transfer", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { to, qty } = req.body as { to: string; qty: number };
    if (isNaN(num) || num < 3 || num > 7)
      return res.status(400).json({ error: "mintAndTransfer is for Waves 3–7 only" });
    if (!to || !qty || qty < 1)
      return res.status(400).json({ error: "to (address) and qty (>=1) required" });
    const receipt = await contractMintAndTransfer(to, num, qty);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/dutch-auction — configure wave as Dutch auction
// Body: { startPriceEth: string, floorPriceEth: string, decrementEth: string, intervalSecs: number }
router.put("/:num/dutch-auction", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { startPriceEth, floorPriceEth, decrementEth, intervalSecs } = req.body as {
      startPriceEth: string; floorPriceEth: string; decrementEth: string; intervalSecs: number;
    };

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!startPriceEth || isNaN(parseFloat(startPriceEth)))
      return res.status(400).json({ error: "startPriceEth (string) required" });
    if (!floorPriceEth || isNaN(parseFloat(floorPriceEth)))
      return res.status(400).json({ error: "floorPriceEth (string) required" });
    if (!decrementEth || isNaN(parseFloat(decrementEth)))
      return res.status(400).json({ error: "decrementEth (string) required" });
    if (!intervalSecs || intervalSecs < 1)
      return res.status(400).json({ error: "intervalSecs (number >= 1) required" });

    // Reject if any sales have occurred — price is locked
    const { rows } = await pool.query("SELECT sold_count FROM nft_waves WHERE wave_number=$1", [num]);
    if ((rows[0]?.sold_count ?? 0) > 0)
      return res.status(409).json({ error: `Wave ${num} price is locked — first sale has occurred` });

    const startPriceWei = ethers.parseEther(startPriceEth);
    const floorPriceWei = ethers.parseEther(floorPriceEth);
    const decrementWei  = ethers.parseEther(decrementEth);

    const receipt = await contractSetDutchAuction(num, startPriceWei, floorPriceWei, decrementWei, intervalSecs);
    await pool.query("UPDATE nft_waves SET sale_method='dutch_auction' WHERE wave_number=$1", [num]);
    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/waves/:num/dutch-price — get current Dutch auction price (public)
router.get("/:num/dutch-price", async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });

    const { currentPrice, isFloor, auctionStarted } = await contractGetCurrentDutchPrice(num);
    res.json({
      waveNum:          num,
      currentPriceEth:  ethers.formatEther(currentPrice),
      currentPriceWei:  currentPrice.toString(),
      isFloor,
      auctionStarted,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/resync — replay all events from block 0 to rebuild DB
router.post("/resync", requireAdmin, async (req, res, next) => {
  try {
    const fromBlock = parseInt(req.body.fromBlock ?? "0", 10);
    const result    = await resyncFromBlock(fromBlock);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ── Strategy extensions ────────────────────────────────────────────────────────

// GET /api/nft-sell/waves/:num/holder-snapshot — list current holders for a wave
// Returns distinct owner addresses of NFTs minted in waves up to :num
router.get("/:num/holder-snapshot", async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });

    const { rows } = await pool.query("SELECT nft_holder_snapshot($1)", [num]);
    const addresses: string[] = rows[0]?.nft_holder_snapshot ?? [];
    res.json({ wave_number: num, holders: addresses, count: addresses.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/:num/holder-merkle — generate Merkle from holders + set on-chain
// Builds a wave-scoped Merkle root from current NFT holders, stores in DB and contract.
router.post("/:num/holder-merkle", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });

    const { rows } = await pool.query("SELECT nft_holder_snapshot($1)", [num]);
    const addresses: string[] = rows[0]?.nft_holder_snapshot ?? [];

    if (!addresses.length)
      return res.status(400).json({ error: "No holders found for snapshot" });

    const tree = buildMerkleTree(addresses);
    const root = tree.root;

    await pool.query("UPDATE nft_waves SET wave_merkle_root=$1 WHERE wave_number=$2", [root, num]);

    let txHash: string | undefined;
    if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL) {
      const receipt = await contractSetWaveMerkleRoot(num, root);
      txHash = receipt.hash;
    }

    res.json({ ok: true, wave_number: num, merkle_root: root, holder_count: addresses.length, txHash: txHash ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/holder-priority — set holder priority window in DB
// Body: { start: string (ISO), end: string (ISO) }
router.put("/:num/holder-priority", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { start, end } = req.body as { start: string; end: string };

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!start || !end)
      return res.status(400).json({ error: "start and end (ISO datetime) required" });

    const { rows } = await pool.query("SELECT nft_wave_update_holder_priority($1,$2,$3)", [num, start, end]);
    res.json({ ok: true, wave: rows[0]?.nft_wave_update_holder_priority });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/flash-sale — toggle flash sale + set discount
// Body: { is_flash_sale: boolean, flash_discount_pct?: number }
router.put("/:num/flash-sale", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { is_flash_sale, flash_discount_pct } = req.body as {
      is_flash_sale: boolean; flash_discount_pct?: number;
    };

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (is_flash_sale === undefined)
      return res.status(400).json({ error: "is_flash_sale boolean required" });
    if (is_flash_sale && (!flash_discount_pct || flash_discount_pct <= 0))
      return res.status(400).json({ error: "flash_discount_pct > 0 required when enabling flash sale" });

    const { rows } = await pool.query("SELECT nft_wave_update_flash_sale($1,$2,$3)", [num, is_flash_sale, flash_discount_pct ?? 0]);
    res.json({ ok: true, wave: rows[0]?.nft_wave_update_flash_sale });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/tier-prices — set per-rarity tier prices
// Body: { tier_prices: { legendary?: number, epic?: number, rare?: number, common?: number } }
router.put("/:num/tier-prices", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { tier_prices } = req.body as {
      tier_prices: { legendary?: number; epic?: number; rare?: number; common?: number };
    };

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!tier_prices || typeof tier_prices !== "object")
      return res.status(400).json({ error: "tier_prices object required" });

    const { rows } = await pool.query("SELECT nft_wave_update_tier_prices($1,$2)", [num, JSON.stringify(tier_prices)]);
    res.json({ ok: true, wave: rows[0]?.nft_wave_update_tier_prices });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/waves/:num/artist-config — set artist edition config
// Body: { artist_name: string, artist_wallet: string, artist_royalty_bps: number,
//         is_artist_edition?: boolean }
router.put("/:num/artist-config", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { artist_name, artist_wallet, artist_royalty_bps, is_artist_edition } = req.body as {
      artist_name: string; artist_wallet: string;
      artist_royalty_bps: number; is_artist_edition?: boolean;
    };

    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!artist_name || !artist_wallet)
      return res.status(400).json({ error: "artist_name and artist_wallet required" });
    if (artist_royalty_bps === undefined || artist_royalty_bps < 0 || artist_royalty_bps > 1000)
      return res.status(400).json({ error: "artist_royalty_bps must be 0–1000" });

    const { rows } = await pool.query("SELECT nft_wave_update_artist_config($1,$2,$3,$4,$5)", [num, artist_name, artist_wallet.toLowerCase(), artist_royalty_bps, is_artist_edition ?? true]);
    res.json({ ok: true, wave: rows[0]?.nft_wave_update_artist_config });
  } catch (err) {
    next(err);
  }
});

export default router;
