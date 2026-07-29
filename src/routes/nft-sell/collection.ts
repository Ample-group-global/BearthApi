import { Router } from "express";
import { ethers } from "ethers";
import pool from "../../pool";
import {
  contractRevealAll,
  contractRevealWave,
  contractSetPhase,
  contractSetMerkleRoot,
  contractSetTreasuryWallet,
  contractWithdraw,
  contractReserveMint,
  contractSetSBT,
  contractPause,
  contractUnpause,
  contractSetTokenPrice,
  contractSetRarityBatch,
  contractGetCollectionInfo,
  contractSetContractURI,
  contractEmergencyTransfer,
} from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/collection — full collection config (DB + on-chain)
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_collection_config_get()", []);
    let onChain = null;
    if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL) {
      try {
        const info = await contractGetCollectionInfo();
        onChain = {
          currentPhase:         Number(info.currentPhase),
          maxSupply:            Number(info.maxSupply),
          totalMinted:          Number(info.totalMinted),
          sbt:                  info.sbt,
          purchaseLimitEnabled: info.purchaseLimitEnabled,
          normalMaxPerWallet:   Number(info.normalMaxPerWallet),
        };
      } catch {
        onChain = null;
      }
    }
    res.json({ config: rows[0]?.nft_collection_config_get ?? null, onChain });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/provenance — not supported; provenance is set via contractURI
router.post("/provenance", requireAdmin, (_req, res) => {
  res.status(501).json({ error: "setProvenanceHash was removed from BearthGenesisNFT. Use PUT /api/nft-sell/collection/contract-uri instead." });
});

// POST /api/nft-sell/collection/phase — advance phase
// Body: { phase: 0 | 1 | 2 }   0=Whitelist, 1=PaidMint, 2=Revealed
router.post("/phase", requireAdmin, async (req, res, next) => {
  try {
    const { phase } = req.body as { phase: number };
    if (phase == null || ![0, 1, 2].includes(phase))
      return res.status(400).json({ error: "phase must be 0, 1, or 2" });
    const receipt = await contractSetPhase(phase as 0 | 1 | 2);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/reveal — reveal collection with reveal URI
// Body: { revealUri: string }  e.g. "ipfs://Qm..."
// Requires: currentPhase=PaidMint AND all 7 waves closed (enforced on-chain)
router.post("/reveal", requireAdmin, async (req, res, next) => {
  try {
    const { revealUri } = req.body as { revealUri: string };
    if (!revealUri) return res.status(400).json({ error: "revealUri required" });
    const receipt = await contractRevealAll(revealUri);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/reveal-wave — reveal a single wave with its URI
// Body: { waveNum: number, uri: string }  e.g. { waveNum: 1, uri: "ipfs://Qm..." }
router.post("/reveal-wave", requireAdmin, async (req, res, next) => {
  try {
    const { waveNum, uri } = req.body as { waveNum: number; uri: string };
    if (waveNum == null || isNaN(Number(waveNum)) || waveNum < 1 || waveNum > 7)
      return res.status(400).json({ error: "waveNum must be 1–7" });
    if (!uri?.startsWith("ipfs://"))
      return res.status(400).json({ error: "uri must start with ipfs://" });

    const receipt = await contractRevealWave(Number(waveNum), uri);
    await pool.query("UPDATE nft_waves SET wave_revealed=TRUE, wave_reveal_uri=$1 WHERE wave_number=$2", [uri, Number(waveNum)]);
    await pool.query("UPDATE nft_records SET is_revealed=TRUE, revealed_at=NOW() WHERE on_chain_wave_num=$1 AND is_revealed=FALSE", [Number(waveNum)]);
    res.json({ success: true, txHash: receipt.hash, waveNum: Number(waveNum) });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/merkle-root — update whitelist merkle root
// Body: { root: string }
router.post("/merkle-root", requireAdmin, async (req, res, next) => {
  try {
    const { root } = req.body as { root: string };
    if (!root) return res.status(400).json({ error: "root required" });
    const receipt = await contractSetMerkleRoot(root);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/collection/treasury — set treasury wallet address
// Body: { wallet: string }
router.put("/treasury", requireAdmin, async (req, res, next) => {
  try {
    const { wallet } = req.body as { wallet: string };
    if (!wallet) return res.status(400).json({ error: "wallet address required" });
    const receipt = await contractSetTreasuryWallet(wallet);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/collection/sbt — toggle Soul Bound Token mode
// Body: { enabled: boolean }
router.put("/sbt", requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean")
      return res.status(400).json({ error: "enabled (boolean) required" });
    const receipt = await contractSetSBT(enabled);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/pause — pause contract (emergency)
router.post("/pause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await contractPause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/unpause — unpause contract
router.post("/unpause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await contractUnpause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/withdraw — withdraw ETH balance to treasury
router.post("/withdraw", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await contractWithdraw();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/admin-mint — admin mint to any address (no walletTotalMinted increment)
// Body: { to: string, qty: number }
router.post("/admin-mint", requireAdmin, async (req, res, next) => {
  try {
    const { to, qty } = req.body as { to: string; qty: number };
    if (!to || !qty || qty < 1)
      return res.status(400).json({ error: "to (address) and qty (>=1) required" });
    const receipt = await contractReserveMint(to, qty);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/collection/tokens/:id/rarity-price — set per-token rarity price
// Body: { priceEth: string }  e.g. "0.5"
// Only valid while token is in treasury (rarity_price_locked=false)
router.put("/tokens/:id/rarity-price", requireAdmin, async (req, res, next) => {
  try {
    const tokenId  = parseInt(req.params.id, 10);
    const priceStr = req.body.priceEth as string;

    if (isNaN(tokenId) || tokenId < 0)
      return res.status(400).json({ error: "Invalid token ID" });
    if (!priceStr || isNaN(parseFloat(priceStr)))
      return res.status(400).json({ error: "priceEth (string) required, e.g. '0.5'" });

    const priceWei = ethers.parseEther(priceStr);
    const receipt  = await contractSetTokenPrice(tokenId, priceWei);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/tokens/rarity-batch — batch-set rarity for many tokens
// Body: { items: [{ tokenId: number, rarity: 1|2|3|4 }, ...] }
// Rarity: 1=Common 2=Rare 3=Epic 4=Legendary. Max 500 tokens per call.
router.post("/tokens/rarity-batch", requireAdmin, async (req, res, next) => {
  try {
    const items = req.body.items as { tokenId: number; rarity: number }[] | undefined;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "items array required" });
    if (items.length > 500)
      return res.status(400).json({ error: "Maximum 500 tokens per batch" });

    const tokenIds = items.map(i => i.tokenId);
    const rarities  = items.map(i => i.rarity);

    const receipt = await contractSetRarityBatch(tokenIds, rarities);
    res.json({ ok: true, count: items.length, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/collection/stats — dashboard summary
// Returns: phase, minted, remaining, WL stats, Paid stats, revenue, reveal status
router.get("/stats", async (_req, res, next) => {
  try {
    const [configResult, wavesResult, onChainResult, revenueResult] = await Promise.all([
      pool.query("SELECT nft_collection_config_get()", []),
      pool.query("SELECT * FROM nft_wave_get_all()", []),
      process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL
        ? contractGetCollectionInfo().catch(() => null)
        : Promise.resolve(null),
      pool.query("SELECT * FROM nft_revenue_summary()", []).catch(() => ({ rows: [null] })),
    ]);

    const cfg   = configResult.rows[0]?.nft_collection_config_get ?? null;
    const waves: Record<string, unknown>[] = wavesResult.rows ?? [];
    const onChain = onChainResult;
    const rev   = revenueResult.rows[0] ?? null;

    const wlWave   = waves.find(w => Number(w.wave_number) === 1) ?? null;
    const paidWave = waves.find(w => Number(w.wave_number) === 2) ?? null;

    const totalMinted = onChain ? Number(onChain.totalMinted) : (cfg?.total_counter ?? 0);
    const maxSupply   = onChain ? Number(onChain.maxSupply)   : (cfg?.max_supply   ?? 9999);

    res.json({
      phase: onChain ? Number(onChain.currentPhase) : null,
      phaseName: cfg?.current_phase ?? null,
      totalMinted,
      maxSupply,
      remaining: maxSupply - totalMinted,
      mintProgress: maxSupply > 0 ? Math.round((totalMinted / maxSupply) * 100) : 0,
      whitelistMint: {
        soldCount:  Number(wlWave?.sold_count ?? 0),
        quantity:   Number(wlWave?.quantity   ?? 0),
        closed:     Boolean(wlWave?.wave_closed),
        closeAction: wlWave?.close_action ?? null,
      },
      paidMint: {
        soldCount:  Number(paidWave?.sold_count   ?? 0),
        quantity:   Number(paidWave?.quantity     ?? 0),
        priceEth:   paidWave?.default_price_eth   ?? null,
        priceLocked: Boolean(paidWave?.price_locked),
        closed:     Boolean(paidWave?.wave_closed),
        closeAction: paidWave?.close_action ?? null,
      },
      revealed:      Number(cfg?.reveal_count ?? 0),
      isRevealed:    (cfg?.current_phase ?? "") === "Revealed",
      adminRevenue: rev ? {
        totalEth:     Number(rev.admin_sales_total_eth ?? 0),
        totalSales:   Number(rev.admin_sales_count     ?? 0),
        totalQty:     Number(rev.admin_sales_qty       ?? 0),
        byMode:       rev.by_mode   ?? [],
        byStatus:     rev.by_status ?? [],
      } : null,
      onChain: onChain ? {
        purchaseLimitEnabled: onChain.purchaseLimitEnabled,
        normalMaxPerWallet:   Number(onChain.normalMaxPerWallet),
        sbt:                  onChain.sbt,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/collection/tokens — list minted NFT tokens (paginated)
// Query: ?limit=50&offset=0&owner=0x...&waveNum=1
router.get("/tokens", async (req, res, next) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit  as string ?? "50", 10), 200);
    const offset  = parseInt(req.query.offset as string ?? "0", 10);
    const owner   = req.query.owner   as string | undefined;
    const waveNum = req.query.waveNum ? parseInt(req.query.waveNum as string, 10) : null;

    const { rows } = await pool.query(`
      SELECT
        r.token_id, r.owner_address, r.wave_number,
        r.rarity_tier, r.rarity_price_eth, r.rarity_price_locked,
        r.is_revealed, r.synced_at, r.created_at
      FROM nft_records r
      WHERE ($1::VARCHAR IS NULL OR LOWER(r.owner_address) = LOWER($1))
        AND ($2::INT IS NULL OR r.wave_number = $2)
      ORDER BY r.token_id
      LIMIT $3 OFFSET $4
    `, [owner ?? null, waveNum, limit, offset]);

    const { rows: countRows } = await pool.query(`
      SELECT COUNT(*) AS total FROM nft_records
      WHERE ($1::VARCHAR IS NULL OR LOWER(owner_address) = LOWER($1))
        AND ($2::INT IS NULL OR wave_number = $2)
    `, [owner ?? null, waveNum]);

    const total = Number(countRows[0]?.total ?? 0);
    res.json({ tokens: rows, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/collection/launch-status — 3-phase launch progress
router.get("/launch-status", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_launch_status()", []);
    res.json({ phases: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/collection/contract-uri — set OpenSea collection-level metadata URI
// Body: { uri: string }  e.g. "ipfs://Qm..."
router.put("/contract-uri", requireAdmin, async (req, res, next) => {
  try {
    const { uri } = req.body as { uri: string };
    if (!uri) return res.status(400).json({ error: "uri required" });
    const receipt = await contractSetContractURI(uri);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collection/emergency-transfer — force-move an NFT (recovery tool)
// Body: { tokenId: number, from: string, to: string, reason: string }
// Requires EMERGENCY_ROLE on-chain — the operations wallet holds this role.
router.post("/emergency-transfer", requireAdmin, async (req, res, next) => {
  try {
    const { tokenId, from, to, reason } = req.body as {
      tokenId: number; from: string; to: string; reason: string;
    };
    if (!tokenId || !from || !to || !reason)
      return res.status(400).json({ error: "tokenId, from, to, and reason are all required" });
    const receipt = await contractEmergencyTransfer(Number(tokenId), from, to, reason);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/collection/events — recent contract events (audit log)
// Query: ?limit=50&eventName=Minted
router.get("/events", async (req, res, next) => {
  try {
    const limit     = Math.min(parseInt(req.query.limit as string ?? "50", 10), 200);
    const eventName = req.query.eventName as string | undefined;

    const { rows } = await pool.query(`
      SELECT id, event_name, tx_hash, block_number, log_index,
             from_address, to_address, payload, processed_at, created_at
      FROM nft_contract_events
      WHERE ($1::TEXT IS NULL OR event_name = $1)
      ORDER BY block_number DESC, log_index DESC
      LIMIT $2
    `, [eventName ?? null, limit]);
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
