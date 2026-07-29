import { Router } from "express";
import pool from "../../pool";
import { contractReserveMint } from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// Fetch enabled sale mode codes from DB (never hardcoded)
async function getEnabledSaleModes(): Promise<string[]> {
  const { rows } = await pool.query("SELECT code FROM lookup_values WHERE category = 'nft_sale_mode' AND is_active = TRUE ORDER BY sort_order", []);
  return rows.map((r: { code: string }) => r.code);
}

// Fetch enabled currency codes from DB (never hardcoded)
async function getEnabledCurrencies(): Promise<string[]> {
  const { rows } = await pool.query("SELECT code FROM lookup_values WHERE category = 'nft_payment_currency' AND is_active = TRUE ORDER BY sort_order", []);
  return rows.map((r: { code: string }) => r.code);
}

// GET /api/nft-sell/admin-sales — list all admin-recorded sales (paginated)
// Query: ?status=pending|minted|failed|refunded  &mode=offline_cash  &limit=50  &offset=0
router.get("/", async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  as string ?? "50", 10), 200);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    const status = req.query.status as string | undefined;
    const mode   = req.query.mode   as string | undefined;

    const { rows } = await pool.query("SELECT * FROM nft_admin_sales_list($1,$2,$3,$4)", [limit, offset, status ?? null, mode ?? null]);
    const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    res.json({ sales: rows, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/admin-sales/revenue — revenue summary across all modes
router.get("/revenue", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_revenue_summary()", []);
    res.json({ revenue: rows[0] ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/admin-sales — record a sale AND mint on-chain in one step
// Body: {
//   saleMode: "offline_cash" | "bank_transfer" | "gift" | ... (see VALID_MODES),
//   buyerAddress: "0x...",
//   quantity: 1,
//   amountPaidEth: "0.0303",   // string, optional for gifts
//   paymentCurrency: "ETH",    // ETH | USD | SGD | USDT | ...
//   paymentRef: "INV-001",     // invoice #, bank ref, etc. (optional)
//   waveNumber: 2,             // which wave to mint from (default 2)
//   notes: "Sold at Singapore event",
//   createdBy: "0xAdminWallet",
//   mintNow: true,             // if true, call adminMint immediately; if false, save as pending
// }
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

    // Validate against DB (never hardcoded lists)
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

    // Create DB record (status=pending)
    const { rows: [{ nft_admin_sale_create: saleId }] } = await pool.query("SELECT nft_admin_sale_create($1,$2,$3,$4,$5,$6,$7,$8,$9)", [saleMode, buyerAddress, quantity, amountEth ?? null, currencyUpper, paymentRef ?? null, waveNumber, notes ?? null, createdBy ?? null]);

    if (!mintNow) {
      return res.json({ ok: true, saleId, status: "pending", minted: false });
    }

    // Mint on-chain immediately
    let txHash: string;
    try {
      const receipt = await contractReserveMint(buyerAddress, quantity);
      txHash = receipt.hash;
    } catch (mintErr) {
      // Mark sale as failed — don't delete so admin can retry
      await pool.query("SELECT nft_admin_sale_mark_failed($1,$2)", [saleId, mintErr instanceof Error ? mintErr.message : String(mintErr)]).catch(() => null);
      throw mintErr;
    }

    await pool.query("SELECT nft_admin_sale_mark_minted($1,$2)", [saleId, txHash]);

    res.json({ ok: true, saleId, status: "minted", txHash, minted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/admin-sales/:id/mint — mint a previously pending sale
router.post("/:id/mint", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Look up the pending sale
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

// PATCH /api/nft-sell/admin-sales/:id/status — update status (e.g. mark refunded)
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
