import { Router } from "express";
import pool from "../pool";

const router = Router();
const ETH_ADDR = /^0x[a-fA-F0-9]{40}$/;

/**
 * GET /api/nfts/owned?address=0x...&collection=genesis|upgrade
 *
 * Public endpoint — no auth required.
 * Returns token IDs currently owned by the given wallet address.
 *
 * genesis (default): queries nft_records.owner_address, which is kept in sync
 *   by the contract event listener on every Transfer/Minted/Burned event.
 *   Staked tokens are excluded because the staking contract takes custody
 *   (their owner_address becomes the staking contract address).
 *
 * upgrade: queries upgrade_nft_records if the table exists; returns [] otherwise
 *   so the customer UI can fall back to an on-chain scan.
 */
router.get("/owned", async (req, res, next) => {
  const { address, collection = "genesis" } = req.query;

  if (!address || !ETH_ADDR.test(address as string)) {
    res.status(400).json({ detail: "Invalid or missing address parameter" });
    return;
  }

  const addr = (address as string).toLowerCase();

  try {
    let tokenIds: number[] = [];

    if ((collection as string) === "upgrade") {
      // upgrade_nft_records may not exist yet — graceful fallback to []
      const result = await pool
        .query(
          `SELECT token_id FROM upgrade_nft_records
           WHERE LOWER(owner_address) = $1
           ORDER BY token_id ASC`,
          [addr],
        )
        .catch(() => ({ rows: [] as { token_id: number }[] }));
      tokenIds = result.rows.map((r: { token_id: number }) => r.token_id);
    } else {
      const { rows } = await pool.query(
        `SELECT token_id FROM nft_records
         WHERE LOWER(owner_address) = $1
         ORDER BY token_id ASC`,
        [addr],
      );
      tokenIds = rows.map((r: { token_id: number }) => r.token_id);
    }

    res.json({ tokenIds, collection: collection as string });
  } catch (e) {
    next(e);
  }
});

export default router;
