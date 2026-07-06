import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listOrders(params: {
  search?: string | null;
  customerId?: string | null;
  nftStatus?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { search = null, customerId = null, nftStatus = null, limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM orders_list($1, $2, $3, $4, $5)",
    [search, customerId, nftStatus, limit, offset]
  );
  return { orders: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
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
  merchPaymentMethodId?: string; merchAmountTwd?: number;
  merchCurrencyId?: string; merchPaymentStatusId?: string;
  nftItems?: unknown[]; productItems?: unknown[];
}) {
  const {
    orderNumber, customerId, referrerId, purchaseDate, paymentNotes, notes,
    nftPaymentMethodId, nftAmountTwd, nftAmountEth, nftCurrencyId, nftPaymentStatusId,
    merchPaymentMethodId, merchAmountTwd, merchCurrencyId, merchPaymentStatusId,
    nftItems = [], productItems = [],
  } = params;
  const { rows } = await pool.query(
    "SELECT * FROM orders_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::json, $17::json)",
    [
      orderNumber ?? null, customerId ?? null, referrerId ?? null,
      purchaseDate ?? null, paymentNotes ?? null, notes ?? null,
      nftPaymentMethodId ?? null,
      nftAmountTwd  != null ? Number(nftAmountTwd)  : null,
      nftAmountEth  != null ? Number(nftAmountEth)  : null,
      nftCurrencyId ?? null, nftPaymentStatusId ?? null,
      merchPaymentMethodId ?? null,
      merchAmountTwd != null ? Number(merchAmountTwd) : null,
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
  merchPaymentMethodId?: string; merchAmountTwd?: number;
  merchCurrencyId?: string; merchPaymentStatusId?: string;
}) {
  const {
    customerId, referrerId, purchaseDate, paymentNotes, notes,
    nftPaymentMethodId, nftAmountTwd, nftAmountEth, nftCurrencyId, nftPaymentStatusId,
    merchPaymentMethodId, merchAmountTwd, merchCurrencyId, merchPaymentStatusId,
  } = params;
  const { rows } = await pool.query(
    "SELECT * FROM orders_update($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [
      id, customerId ?? null, referrerId ?? null,
      purchaseDate ?? null, paymentNotes ?? null, notes ?? null,
      nftPaymentMethodId ?? null,
      nftAmountTwd  != null ? Number(nftAmountTwd)  : null,
      nftAmountEth  != null ? Number(nftAmountEth)  : null,
      nftCurrencyId ?? null, nftPaymentStatusId ?? null,
      merchPaymentMethodId ?? null,
      merchAmountTwd != null ? Number(merchAmountTwd) : null,
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
  const { rows } = await pool.query(
    "SELECT * FROM orders_confirm_merch_payment($1::uuid, $2)", [id, merchPaymentStatusId]
  );
  return rows[0] ?? null;
}

export async function deleteOrder(id: string) {
  const { rows } = await pool.query("SELECT * FROM orders_delete($1::uuid)", [id]);
  return rows[0] ?? null;
}
