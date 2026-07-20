import { Router } from "express";
import pool from "../../pool";
import { buildMerkleTree } from "../../merkle";
import { contractSetWaveMerkleRoot } from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/collaborations — list all collaborations
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_collaborations_list()", []);
    res.json({ collaborations: rows[0]?.nft_collaborations_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collaborations — create collaboration
// Body: { name, partner_name, partner_contract_address?, wave_id?,
//         discount_pct?, priority_hours?, created_by? }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      name, partner_name, partner_contract_address,
      wave_id, discount_pct, priority_hours, created_by,
    } = req.body as {
      name: string; partner_name: string;
      partner_contract_address?: string; wave_id?: string;
      discount_pct?: number; priority_hours?: number; created_by?: string;
    };

    if (!name || !partner_name)
      return res.status(400).json({ error: "name and partner_name required" });

    const { rows } = await pool.query("SELECT nft_collaboration_upsert($1,$2,$3,$4,$5,$6,$7,$8)", [null, name, partner_name, partner_contract_address ?? null, wave_id ?? null, discount_pct ?? 0, priority_hours ?? 24, created_by ?? null]);
    res.status(201).json({ collaboration: rows[0]?.nft_collaboration_upsert });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/collaborations/:id — update collaboration
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const {
      name, partner_name, partner_contract_address,
      wave_id, discount_pct, priority_hours, created_by,
    } = req.body as Record<string, unknown>;

    const { rows } = await pool.query("SELECT nft_collaboration_upsert($1,$2,$3,$4,$5,$6,$7,$8)", [req.params.id, name ?? null, partner_name ?? null, partner_contract_address ?? null, wave_id ?? null, discount_pct ?? null, priority_hours ?? null, created_by ?? null]);
    res.json({ collaboration: rows[0]?.nft_collaboration_upsert });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/collaborations/:id/wallets — list imported partner wallets
router.get("/:id/wallets", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_collaboration_wallets_list($1)", [req.params.id]);
    res.json({ wallets: rows[0]?.nft_collaboration_wallets_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collaborations/:id/wallets — bulk import partner wallets
// Body: { wallets: string[] }
router.post("/:id/wallets", requireAdmin, async (req, res, next) => {
  try {
    const { wallets } = req.body as { wallets: string[] };
    if (!wallets?.length)
      return res.status(400).json({ error: "wallets array required" });

    const normalized = wallets.map(w => w.toLowerCase().trim()).filter(w => w.startsWith("0x"));
    if (!normalized.length)
      return res.status(400).json({ error: "No valid wallet addresses found" });

    const { rows } = await pool.query("SELECT nft_collaboration_wallets_import($1,$2)", [req.params.id, normalized]);
    res.json({ ok: true, imported: rows[0]?.nft_collaboration_wallets_import });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/collaborations/:id/generate-merkle
// Builds Merkle tree from imported wallets + optionally holder wallets,
// stores root in DB, and calls setWaveMerkleRoot on-chain.
// Body: { wave_number: number, include_holders?: boolean }
router.post("/:id/generate-merkle", requireAdmin, async (req, res, next) => {
  try {
    const { wave_number, include_holders } = req.body as {
      wave_number: number; include_holders?: boolean;
    };
    if (!wave_number) return res.status(400).json({ error: "wave_number required" });

    // Fetch collaboration wallets
    const { rows: walletsRows } = await pool.query("SELECT wallet_address FROM nft_collaboration_wallets WHERE collaboration_id=$1 AND is_eligible=TRUE", [req.params.id]);
    let addresses: string[] = walletsRows.map((r: { wallet_address: string }) => r.wallet_address);

    // Optionally include current NFT holders
    if (include_holders) {
      const { rows: holderRows } = await pool.query("SELECT DISTINCT LOWER(owner_address) AS addr FROM nft_records WHERE owner_address IS NOT NULL AND is_burned=FALSE", []);
      const holderAddrs = holderRows.map((r: { addr: string }) => r.addr);
      addresses = [...new Set([...addresses, ...holderAddrs])];
    }

    if (!addresses.length)
      return res.status(400).json({ error: "No eligible wallets found for this collaboration" });

    const tree = buildMerkleTree(addresses);
    const root = tree.root;

    // Store in DB
    await pool.query("UPDATE nft_waves SET wave_merkle_root=$1 WHERE wave_number=$2", [root, wave_number]);
    await pool.query("UPDATE nft_collaborations SET status='active' WHERE id=$1", [req.params.id]);

    // Set on-chain (if contract configured)
    let txHash: string | undefined;
    if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL) {
      try {
        const receipt = await contractSetWaveMerkleRoot(wave_number, root);
        txHash = receipt.hash;
      } catch (e) {
        return res.status(502).json({ error: `Contract call failed: ${(e as Error).message}` });
      }
    }

    res.json({
      ok: true,
      merkle_root: root,
      address_count: addresses.length,
      wave_number,
      txHash: txHash ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
