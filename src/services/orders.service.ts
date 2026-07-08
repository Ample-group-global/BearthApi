import pool from "../pool";
import { toCamel } from "../utils/camel";

const ORDER_SORT_COLS: Record<string, string> = {
  order_number:    "o.order_number",
  purchase_date:   "o.purchase_date",
  customer:        "u.first_name",
  nft_amount_twd:  "o.nft_amount_twd",
  nft_amount_eth:  "o.nft_amount_eth",
  nft_status:      "nps.code",
  merch_amount_twd:"o.merch_amount_twd",
  created_at:      "o.created_at",
};

export async function listOrders(params: {
  search?: string | null;
  customerId?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
}) {
  const { search = null, customerId = null, status = null, limit = 20, offset = 0, sortBy = null, sortDir = null } = params;
  const sortCol = sortBy && ORDER_SORT_COLS[sortBy] ? ORDER_SORT_COLS[sortBy] : null;
  const dir     = sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = sortCol ? `${sortCol} ${dir} NULLS LAST` : "o.created_at DESC";
  const { rows } = await pool.query(`
    SELECT
      o.id, o.order_number, o.purchase_date, o.payment_notes, o.notes,
      o.nft_amount_twd, o.nft_amount_eth, o.nft_confirmed_at,
      o.merch_amount_twd, o.merch_amount_eth, o.merch_confirmed_at,
      o.created_at, o.updated_at,
      o.customer_id,
      u.first_name || ' ' || u.last_name AS customer_name,
      u.phone AS customer_phone,
      o.nft_payment_method_id,  npm.code AS nft_payment_method_code,  npm.name AS nft_payment_method_name,
      o.nft_payment_status_id,  nps.code AS nft_payment_status_code,  nps.name AS nft_payment_status_name,
      o.merch_payment_method_id, mpm.code AS merch_payment_method_code, mpm.name AS merch_payment_method_name,
      o.merch_payment_status_id, mps.code AS merch_payment_status_code, mps.name AS merch_payment_status_name,
      COUNT(*) OVER() AS total_count
    FROM orders o
    LEFT JOIN users            u   ON o.customer_id             = u.id
    LEFT JOIN payment_methods  npm ON o.nft_payment_method_id   = npm.id
    LEFT JOIN payment_statuses nps ON o.nft_payment_status_id   = nps.id
    LEFT JOIN payment_methods  mpm ON o.merch_payment_method_id = mpm.id
    LEFT JOIN payment_statuses mps ON o.merch_payment_status_id = mps.id
    WHERE ($1::text IS NULL OR o.customer_id = $1::uuid)
      AND ($2::text IS NULL OR $2 = 'all' OR nps.code = $2 OR mps.code = $2)
      AND ($3::text IS NULL
           OR o.order_number                     ILIKE '%' || $3 || '%'
           OR u.first_name || ' ' || u.last_name ILIKE '%' || $3 || '%')
    ORDER BY ${orderBy}
    LIMIT $4 OFFSET $5
  `, [customerId, status, search, limit, offset]);
  return { orders: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

export async function getNextOrderNumber(): Promise<string> {
  const { rows } = await pool.query(`
    SELECT 'ORD-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
      LPAD((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::TEXT, 4, '0') AS next_number
    FROM order_number_seq
  `);
  return rows[0]?.next_number ?? ("ORD-" + new Date().getFullYear() + "-0001");
}

export async function getOrder(id: string) {
  const { rows } = await pool.query("SELECT orders_get($1::uuid) AS data", [id]);
  return rows[0]?.data ?? null;
}

export async function createOrder(params: {
  orderNumber?: string; customerId?: string; referrerId?: string; purchaseDate?: string;
  paymentNotes?: string; notes?: string;
  nftPaymentMethodId?: string; nftAmountTwd?: number; nftAmountEth?: number;
  nftCurrencyId?: string; nftPaymentStatusId?: string;
  merchPaymentMethodId?: string; merchAmountTwd?: number; merchAmountEth?: number;
  merchCurrencyId?: string; merchPaymentStatusId?: string;
  nftItems?: unknown[]; productItems?: unknown[];
}) {
  const {
    orderNumber, customerId, referrerId, purchaseDate, paymentNotes, notes,
    nftPaymentMethodId, nftAmountTwd, nftAmountEth, nftCurrencyId, nftPaymentStatusId,
    merchPaymentMethodId, merchAmountTwd, merchAmountEth, merchCurrencyId, merchPaymentStatusId,
    nftItems = [], productItems = [],
  } = params;
  const { rows } = await pool.query(
    "SELECT * FROM orders_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::json, $18::json)",
    [
      orderNumber ?? null, customerId ?? null, referrerId ?? null,
      purchaseDate ?? null, paymentNotes ?? null, notes ?? null,
      nftPaymentMethodId ?? null,
      nftAmountTwd  != null ? Number(nftAmountTwd)  : null,
      nftAmountEth  != null ? Number(nftAmountEth)  : null,
      nftCurrencyId ?? null, nftPaymentStatusId ?? null,
      merchPaymentMethodId ?? null,
      merchAmountTwd != null ? Number(merchAmountTwd) : null,
      merchAmountEth != null ? Number(merchAmountEth) : null,
      merchCurrencyId ?? null, merchPaymentStatusId ?? null,
      JSON.stringify(nftItems), JSON.stringify(productItems),
    ]
  );
  return rows[0] ?? null;
}

export async function updateOrder(id: string, params: {
  customerId?: string; referrerId?: string; purchaseDate?: string; paymentNotes?: string; notes?: string;
  nftPaymentMethodId?: string; nftAmountTwd?: number; nftAmountEth?: number;
  nftCurrencyId?: string; nftPaymentStatusId?: string;
  merchPaymentMethodId?: string; merchAmountTwd?: number; merchAmountEth?: number;
  merchCurrencyId?: string; merchPaymentStatusId?: string;
}) {
  const {
    customerId, referrerId, purchaseDate, paymentNotes, notes,
    nftPaymentMethodId, nftAmountTwd, nftAmountEth, nftCurrencyId, nftPaymentStatusId,
    merchPaymentMethodId, merchAmountTwd, merchAmountEth, merchCurrencyId, merchPaymentStatusId,
  } = params;
  const { rows } = await pool.query(
    "SELECT * FROM orders_update($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [
      id, customerId ?? null, referrerId ?? null,
      purchaseDate ?? null, paymentNotes ?? null, notes ?? null,
      nftPaymentMethodId ?? null,
      nftAmountTwd  != null ? Number(nftAmountTwd)  : null,
      nftAmountEth  != null ? Number(nftAmountEth)  : null,
      nftCurrencyId ?? null, nftPaymentStatusId ?? null,
      merchPaymentMethodId ?? null,
      merchAmountTwd != null ? Number(merchAmountTwd) : null,
      merchAmountEth != null ? Number(merchAmountEth) : null,
      merchCurrencyId ?? null, merchPaymentStatusId ?? null,
    ]
  );
  return rows[0] ?? null;
}

export async function confirmNftPayment(id: string, nftPaymentStatusId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM orders_confirm_nft_payment($1::uuid, $2)", [id, nftPaymentStatusId]
  );
  return rows[0] ?? null;
}

export async function confirmMerchPayment(id: string, merchPaymentStatusId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM orders_confirm_merch_payment($1::uuid, $2)", [id, merchPaymentStatusId]
    );
    await client.query("SELECT products_reserve_for_order($1::uuid)", [id]);
    await client.query("SELECT fulfillment_ensure($1::uuid)", [id]);
    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteOrder(id: string) {
  const { rows } = await pool.query("SELECT * FROM orders_delete($1::uuid)", [id]);
  return rows[0] ?? null;
}
