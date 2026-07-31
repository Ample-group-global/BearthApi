import { Router } from "express";
import { ethers } from "ethers";
import pool from "../../pool";
import {
  contractSetWaveSchedule,
  contractSetWavePrice,
  contractTreasuryClose,
  contractAuctionMint,
  contractGetWaveInfo,
  contractSetAllowlistRoot,
  contractRevealWave,
  resyncFromBlock,
} from "../../services/contract.service";
import { buildMerkleTree } from "../../merkle";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/waves — list all 7 waves (DB mirror)
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_wave_get_all() AS waves");
    res.json({ waves: rows[0]?.waves ?? [] });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/waves/schedule-status — auto-trigger timeline for scheduler page
router.get("/schedule-status", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM v_wave_schedule_status");
    res.json({ waves: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/waves/treasury-nfts — list all treasury-held tokens (unsold → owner wallet)
router.get("/treasury-nfts", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_treasury_nfts_list()", []);
    const nfts = rows[0]?.nft_treasury_nfts_list ?? [];
    res.json({ nfts });
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

// GET /api/nft-sell/waves/:num — single wave (DB + on-chain)
router.get("/:num", async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });

    const { rows } = await pool.query("SELECT nft_wave_get($1) AS wave", [num]);
    const wave = rows[0]?.wave;
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

// POST /api/nft-sell/waves/:num/reveal — admin manually reveals a specific wave
// Body: { uri: string }  e.g. "ipfs://Qm.../collection-metadata.json"
router.post("/:num/reveal", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { uri } = req.body as { uri: string };
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });
    if (!uri?.startsWith("ipfs://"))
      return res.status(400).json({ error: "uri must start with ipfs://" });

    const receipt = await contractRevealWave(num, uri);
    await pool.query("SELECT nft_wave_sync_reveal($1,$2,$3)", [num, uri, receipt.hash]).catch(() => null);
    res.json({ ok: true, txHash: receipt.hash, waveNumber: num });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/waves/:num/treasury-close
// Mints all unsold NFTs to recipient wallet (defaults to contract's treasuryWallet).
// Call after wave end time. Owner can sell these tokens later on any platform.
// Body: { recipient?: string }  — optional Ethereum address; omit to use contract treasuryWallet
router.post("/:num/treasury-close", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 7)
      return res.status(400).json({ error: "Wave number must be 1–7" });

    const { recipient } = req.body as { recipient?: string };
    if (recipient && !/^0x[0-9a-fA-F]{40}$/.test(recipient))
      return res.status(400).json({ error: "recipient must be a valid Ethereum address (0x + 40 hex chars)" });

    const receipt = await contractTreasuryClose(num, recipient ?? null);
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

// POST /api/nft-sell/waves/:num/auction-mint — mint & transfer after auction (Waves 3–7)
// Body: { to: string, qty: number }
router.post("/:num/auction-mint", requireAdmin, async (req, res, next) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { to, qty } = req.body as { to: string; qty: number };
    if (isNaN(num) || num < 3 || num > 7)
      return res.status(400).json({ error: "auctionMint is for Waves 3–7 only" });
    if (!to || !qty || qty < 1)
      return res.status(400).json({ error: "to (address) and qty (>=1) required" });
    const receipt = await contractAuctionMint(to, num, qty);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});


// ── Strategy extensions ────────────────────────────────────────────────────────

// GET /api/nft-sell/waves/:num/holder-snapshot — list current holders for a wave
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

// POST /api/nft-sell/waves/:num/holder-merkle — generate Merkle from holders + set allowlist root on-chain
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
      const receipt = await contractSetAllowlistRoot(root);
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
