import { Router } from "express";
import pool from "../../pool";
import { contractReserveMint } from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();
async function getEnabledSaleModes(): Promise<string[]> {
  const { rows } = await pool.query("SELECT code FROM lookup_values WHERE category = 'nft_sale_mode' AND is_active = TRUE ORDER BY sort_order", []);
  return rows.map((r: { code: string }) => r.code);
}
async function getEnabledCurrencies(): Promise<string[]> {
  const { rows } = await pool.query("SELECT code FROM lookup_values WHERE category = 'nft_payment_currency' AND is_active = TRUE ORDER BY sort_order", []);
  return rows.map((r: { code: string }) => r.code);
}
router.get("/history", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 500);
    const offset = parseInt(req.query.offset as string || "0", 10);
    const wave = req.query.wave as string | undefined;
    const wallet = req.query.wallet as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions: string[] = ["r.mint_tx_hash IS NOT NULL"];
    const params: unknown[] = [];

    if (wave) { params.push(parseInt(wave, 10)); conditions.push(`r.on_chain_wave_num = $${params.length}`); }
    if (wallet) { params.push(`%${wallet.toLowerCase()}%`); conditions.push(`LOWER(r.owner_address) LIKE $${params.length}`); }
    if (from) { params.push(from); conditions.push(`r.minted_at >= $${params.length}::date`); }
    if (to) { params.push(to); conditions.push(`r.minted_at <  ($${params.length}::date + interval '1 day')`); }

    const where = conditions.join(" AND ");

    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const { rows } = await pool.query(
      `SELECT
         r.serial_number,
         r.token_id,
         r.on_chain_wave_num AS wave_num,
         r.owner_address     AS wallet,
         r.price_eth,
         r.rarity_tier,
         r.image_ipfs_hash,
         r.is_revealed,
         r.mint_tx_hash,
         r.minted_at,
         r.last_sale_price_eth,
         r.last_tx_hash,
         r.sold_at,
         r.traits,
         COUNT(*) OVER()     AS total_count
       FROM nft_records r
       WHERE ${where}
       ORDER BY r.minted_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    const records = rows.map(({ total_count: _tc, ...r }) => r);
    res.json({ records, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) { next(err); }
});

router.get("/history/summary", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(wave_num::text, '—')   AS wave,
        COUNT(*)                         AS total_minted,
        SUM(price_eth)                   AS total_eth,
        COUNT(sold_at)                   AS total_sold,
        SUM(last_sale_price_eth)         AS total_sale_eth
      FROM nft_records
      WHERE mint_tx_hash IS NOT NULL
      GROUP BY wave_num
      ORDER BY wave_num ASC NULLS LAST
    `);
    res.json({ summary: rows });
  } catch (err) { next(err); }
});

router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? "50", 10), 200);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    const status = req.query.status as string | undefined;
    const mode = req.query.mode as string | undefined;

    const { rows } = await pool.query("SELECT * FROM nft_admin_sales_list($1,$2,$3,$4)", [limit, offset, status ?? null, mode ?? null]);
    const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    res.json({ sales: rows, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) {
    next(err);
  }
});

router.get("/revenue", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_revenue_summary()", []);
    res.json({ revenue: rows[0] ?? null });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      saleMode, buyerAddress, quantity,
      amountPaidEth, paymentCurrency = "ETH",
      paymentRef, waveNumber = 2, notes, createdBy,
      mintNow = true,
    } = req.body as {
      saleMode: string;
      buyerAddress: string;
      quantity: number;
      amountPaidEth?: string;
      paymentCurrency?: string;
      paymentRef?: string;
      waveNumber?: number;
      notes?: string;
      createdBy?: string;
      mintNow?: boolean;
    };

    const [validModes, validCurrencies] = await Promise.all([
      getEnabledSaleModes(),
      getEnabledCurrencies(),
    ]);

    if (!saleMode || !validModes.includes(saleMode))
      return res.status(400).json({ error: `Invalid saleMode. Enabled modes: ${validModes.join(", ")}` });
    if (!buyerAddress || !/^0x[a-fA-F0-9]{40}$/.test(buyerAddress))
      return res.status(400).json({ error: "buyerAddress must be a valid 0x Ethereum address" });
    if (!quantity || quantity < 1 || !Number.isInteger(quantity))
      return res.status(400).json({ error: "quantity must be a positive integer" });

    const currencyUpper = (paymentCurrency ?? "ETH").toUpperCase();
    if (!validCurrencies.includes(currencyUpper))
      return res.status(400).json({ error: `Invalid paymentCurrency. Enabled currencies: ${validCurrencies.join(", ")}` });

    const amountEth = amountPaidEth ? parseFloat(amountPaidEth) : null;
    if (amountPaidEth && isNaN(amountEth!))
      return res.status(400).json({ error: "amountPaidEth must be a numeric string" });

    const { rows: [{ nft_admin_sale_create: saleId }] } = await pool.query("SELECT nft_admin_sale_create($1,$2,$3,$4,$5,$6,$7,$8,$9)", [saleMode, buyerAddress, quantity, amountEth ?? null, currencyUpper, paymentRef ?? null, waveNumber, notes ?? null, createdBy ?? null]);

    if (!mintNow) {
      return res.json({ ok: true, saleId, status: "pending", minted: false });
    }
    let txHash: string;
    try {
      const receipt = await contractReserveMint(buyerAddress, quantity);
      txHash = receipt.hash;
    } catch (mintErr) {
      await pool.query("SELECT nft_admin_sale_mark_failed($1,$2)", [saleId, mintErr instanceof Error ? mintErr.message : String(mintErr)]).catch(() => null);
      throw mintErr;
    }

    await pool.query("SELECT nft_admin_sale_mark_minted($1,$2)", [saleId, txHash]);

    res.json({ ok: true, saleId, status: "minted", txHash, minted: true });
  } catch (err) {
    next(err);
  }
});
router.post("/:id/mint", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM nft_admin_sales WHERE id = $1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Sale not found" });
    const sale = rows[0];
    if (sale.status !== "pending" && sale.status !== "failed")
      return res.status(400).json({ error: `Sale is already ${sale.status}` });

    const receipt = await contractReserveMint(sale.buyer_address as string, sale.quantity as number);
    await pool.query("SELECT nft_admin_sale_mark_minted($1,$2)", [id, receipt.hash]);

    res.json({ ok: true, saleId: id, txHash: receipt.hash, status: "minted" });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: string };
    const allowed = ["refunded", "failed", "pending"];
    if (!status || !allowed.includes(status))
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });

    await pool.query("UPDATE nft_admin_sales SET status=$1, updated_at=NOW() WHERE id=$2", [status, id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
