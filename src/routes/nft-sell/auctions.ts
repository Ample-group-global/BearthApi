import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";
import {
  auctionCreateWave,
  auctionCreateToken,
  auctionSettle,
  auctionCancel,
  auctionGet,
  auctionTimeRemaining,
  auctionSetTreasury,
  auctionPause,
  auctionUnpause,
  auctionPendingWithdrawal,
  auctionCount,
} from "../../services/auction.contract.service";

const router = Router();

// GET /api/nft-sell/auctions — list all auction sessions
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_auction_sessions_list()", []);
    res.json({ auctions: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions — create auction session
// Body: { wave_number?, token_id?, auction_mode, platform, contract_address?,
//         opensea_listing_id?, start_price_eth?, reserve_price_eth?,
//         auction_end_time?, notes? }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      wave_number, token_id, auction_mode, platform,
      contract_address, opensea_listing_id,
      start_price_eth, reserve_price_eth, auction_end_time, notes,
    } = req.body as {
      wave_number?: number; token_id?: number;
      auction_mode: string; platform: string;
      contract_address?: string; opensea_listing_id?: string;
      start_price_eth?: string; reserve_price_eth?: string;
      auction_end_time?: string; notes?: string;
    };

    if (!auction_mode || !platform)
      return res.status(400).json({ error: "auction_mode and platform required" });
    if (auction_mode !== "wave" && auction_mode !== "token")
      return res.status(400).json({ error: "auction_mode must be 'wave' or 'token'" });
    if (platform !== "bearth" && platform !== "opensea")
      return res.status(400).json({ error: "platform must be 'bearth' or 'opensea'" });

    const { rows } = await pool.query("SELECT nft_auction_session_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [null, wave_number ?? null, token_id ?? null, auction_mode, platform, contract_address ?? null, opensea_listing_id ?? null, start_price_eth ? parseFloat(start_price_eth) : null, reserve_price_eth ? parseFloat(reserve_price_eth) : null, auction_end_time ?? null]);
    res.status(201).json({ auction: rows[0]?.nft_auction_session_upsert });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/auctions/:id — get single auction session
router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_auction_sessions WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Auction session not found" });
    res.json({ auction: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/auctions/:id — update auction session (opensea listing, notes, status)
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const {
      wave_number, token_id, auction_mode, platform,
      contract_address, opensea_listing_id,
      start_price_eth, reserve_price_eth, auction_end_time, notes,
    } = req.body as Record<string, string | number | undefined>;

    const { rows } = await pool.query("SELECT nft_auction_session_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [req.params.id, wave_number ?? null, token_id ?? null, auction_mode ?? null, platform ?? null, contract_address ?? null, opensea_listing_id ?? null, start_price_eth ? parseFloat(String(start_price_eth)) : null, reserve_price_eth ? parseFloat(String(reserve_price_eth)) : null, auction_end_time ?? null]);
    res.json({ auction: rows[0]?.nft_auction_session_upsert });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/:id/sync-bid — update current bid from external source
// Body: { current_bid_eth: string, current_bidder: string }
router.post("/:id/sync-bid", requireAdmin, async (req, res, next) => {
  try {
    const { current_bid_eth, current_bidder } = req.body as {
      current_bid_eth: string; current_bidder: string;
    };
    if (!current_bid_eth || !current_bidder)
      return res.status(400).json({ error: "current_bid_eth and current_bidder required" });

    const { rows } = await pool.query("SELECT nft_auction_session_sync_bid($1,$2,$3)", [req.params.id, parseFloat(current_bid_eth), current_bidder.toLowerCase()]);
    res.json({ ok: true, session: rows[0]?.nft_auction_session_sync_bid });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/:id/settle — settle auction: record winner + mark status
// Body: { winner_wallet: string, winning_bid_eth: string, settlement_tx_hash?: string }
router.post("/:id/settle", requireAdmin, async (req, res, next) => {
  try {
    const { winner_wallet, winning_bid_eth, settlement_tx_hash } = req.body as {
      winner_wallet: string; winning_bid_eth: string; settlement_tx_hash?: string;
    };
    if (!winner_wallet || !winning_bid_eth)
      return res.status(400).json({ error: "winner_wallet and winning_bid_eth required" });

    const { rows } = await pool.query("SELECT nft_auction_session_settle($1,$2,$3,$4)", [req.params.id, winner_wallet.toLowerCase(), parseFloat(winning_bid_eth), settlement_tx_hash ?? null]);
    res.json({ ok: true, session: rows[0]?.nft_auction_session_settle });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/auctions/:id — cancel auction session
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    await pool.query("UPDATE nft_auction_sessions SET status='cancelled', updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── BearthAuction.sol on-chain routes ─────────────────────────────────────────
// These interact with the deployed BearthAuction contract directly.
// Requires AUCTION_CONTRACT_ADDRESS env var.

// GET /api/nft-sell/auctions/on-chain/count — total on-chain auctions created
router.get("/on-chain/count", async (_req, res, next) => {
  try {
    const count = await auctionCount();
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/auctions/on-chain/:id — read auction state from contract
router.get("/on-chain/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: "Invalid auction id" });
    const [auction, timeLeft] = await Promise.all([
      auctionGet(id),
      auctionTimeRemaining(id),
    ]);
    res.json({ auction, timeRemainingSeconds: timeLeft });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/auctions/on-chain/:id/pending — pending withdrawal for a wallet
// Query: ?wallet=0x...
router.get("/on-chain/:id/pending", async (req, res, next) => {
  try {
    const wallet = req.query.wallet as string;
    if (!wallet) return res.status(400).json({ error: "wallet query param required" });
    const pending = await auctionPendingWithdrawal(wallet);
    res.json({ wallet, pendingEth: pending });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/on-chain/wave — create on-chain WAVE auction
// Body: { waveNum, startTime (unix), endTime (unix), reservePriceEth, title }
router.post("/on-chain/wave", requireAdmin, async (req, res, next) => {
  try {
    const { waveNum, startTime, endTime, reservePriceEth, title } = req.body as {
      waveNum: number; startTime: number; endTime: number;
      reservePriceEth: string; title: string;
    };
    if (!waveNum || !startTime || !endTime || !title)
      return res.status(400).json({ error: "waveNum, startTime, endTime, title required" });

    const { receipt, auctionId } = await auctionCreateWave({
      waveNum, startTime, endTime,
      reservePriceEth: reservePriceEth ?? "0",
      title,
    });
    res.status(201).json({ ok: true, txHash: receipt.hash, onChainAuctionId: Number(auctionId) });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/on-chain/token — create on-chain TOKEN auction
// Body: { tokenId, startTime (unix), endTime (unix), reservePriceEth, title }
router.post("/on-chain/token", requireAdmin, async (req, res, next) => {
  try {
    const { tokenId, startTime, endTime, reservePriceEth, title } = req.body as {
      tokenId: number; startTime: number; endTime: number;
      reservePriceEth: string; title: string;
    };
    if (!tokenId || !startTime || !endTime || !title)
      return res.status(400).json({ error: "tokenId, startTime, endTime, title required" });

    const { receipt, auctionId } = await auctionCreateToken({
      tokenId, startTime, endTime,
      reservePriceEth: reservePriceEth ?? "0",
      title,
    });
    res.status(201).json({ ok: true, txHash: receipt.hash, onChainAuctionId: Number(auctionId) });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/on-chain/:id/settle — settle finished auction on-chain
// NFT goes to highest bidder; ETH goes to treasury. If no bids → auto-cancelled.
router.post("/on-chain/:id/settle", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: "Invalid auction id" });
    const receipt = await auctionSettle(id);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/on-chain/:id/cancel — cancel open auction before end time
router.post("/on-chain/:id/cancel", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: "Invalid auction id" });
    const receipt = await auctionCancel(id);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/auctions/on-chain/treasury — update treasury wallet on BearthAuction
// Body: { treasury: string }
router.put("/on-chain/treasury", requireAdmin, async (req, res, next) => {
  try {
    const { treasury } = req.body as { treasury: string };
    if (!treasury) return res.status(400).json({ error: "treasury address required" });
    const receipt = await auctionSetTreasury(treasury);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/on-chain/pause — pause BearthAuction contract
router.post("/on-chain/pause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await auctionPause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/auctions/on-chain/unpause — unpause BearthAuction contract
router.post("/on-chain/unpause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await auctionUnpause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
