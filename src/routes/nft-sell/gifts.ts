import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";
import { contractReserveMint } from "../../services/contract.service";

const router = Router();

// GET /api/nft-sell/gifts — list all gift orders
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_gift_orders_list()", []);
    res.json({ gifts: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/gifts — create single gift order (admin)
// Body: { sender_customer_id, sender_wallet, recipient_wallet, recipient_name,
//         recipient_email, nft_record_id, rarity_tier, gift_message,
//         price_eth, price_twd, payment_method, is_airdrop }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      sender_customer_id,
      sender_wallet,
      recipient_wallet,
      recipient_name,
      recipient_email,
      nft_record_id,
      rarity_tier,
      gift_message,
      price_eth,
      price_twd,
      payment_method,
      is_airdrop,
    } = req.body as {
      sender_customer_id?: string;
      sender_wallet?: string;
      recipient_wallet: string;
      recipient_name?: string;
      recipient_email?: string;
      nft_record_id?: string;
      rarity_tier?: string;
      gift_message?: string;
      price_eth?: number;
      price_twd?: number;
      payment_method?: string;
      is_airdrop?: boolean;
    };

    if (!recipient_wallet) {
      return res.status(400).json({ error: "recipient_wallet required" });
    }

    const { rows } = await pool.query("SELECT nft_gift_order_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [sender_customer_id ?? null, sender_wallet ?? null, recipient_wallet, recipient_name ?? null, recipient_email ?? null, nft_record_id ?? null, rarity_tier ?? null, gift_message ?? null, price_eth ?? 0, price_twd ?? 0, payment_method ?? null, is_airdrop ?? false, (req as any).user.id]);

    res.json({ gift: rows[0]?.nft_gift_order_create ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/gifts/airdrop — batch airdrop to multiple wallets (admin)
// Body: { recipient_wallets: string[], rarity_tier?, gift_message?, created_by? }
router.post("/airdrop", requireAdmin, async (req, res, next) => {
  try {
    const { recipient_wallets, rarity_tier, gift_message } = req.body as {
      recipient_wallets: string[];
      rarity_tier?: string;
      gift_message?: string;
    };

    if (!Array.isArray(recipient_wallets) || !recipient_wallets.length) {
      return res.status(400).json({ error: "recipient_wallets must be a non-empty array" });
    }

    const giftIds: unknown[] = [];

    for (const wallet of recipient_wallets) {
      const { rows } = await pool.query("SELECT nft_gift_order_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [null, null, wallet, null, null, null, rarity_tier ?? null, gift_message ?? null, 0, 0, "airdrop", true, (req as any).user.id]);
      giftIds.push(rows[0]?.nft_gift_order_create ?? null);
    }

    res.json({ created: recipient_wallets.length, gift_ids: giftIds });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/gifts/:id/transfer — mint NFT to recipient and mark transferred (admin)
router.post("/:id/transfer", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch the gift order to get recipient_wallet
    const { rows: giftRows } = await pool.query("SELECT recipient_wallet FROM nft_gift_orders WHERE id=$1", [id]);

    if (!giftRows.length) {
      return res.status(404).json({ error: "Gift order not found" });
    }

    const { recipient_wallet } = giftRows[0] as { recipient_wallet: string };

    const receipt = await contractReserveMint(recipient_wallet, 1);

    await pool.query("SELECT nft_gift_order_transfer($1,$2,$3)", [id, null, receipt.hash]);

    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/gifts/:id — cancel gift order (admin)
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.query("SELECT nft_gift_order_cancel($1)", [id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
