import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listFulfillments(params: {
  status?: string | null;
  type?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { status = null, type = null, limit = 20, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM fulfillment_list($1, $2, $3, $4)",
    [status, type, limit, offset]
  );
  return {
    fulfillments: toCamel(rows),
    total:        Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function getFulfillment(orderId: string) {
  const { rows } = await pool.query("SELECT fulfillment_get($1::uuid) AS data", [orderId]);
  const raw = rows[0]?.data ?? null;
  if (!raw) return null;

  // Flatten nested JSON from fulfillment_get into the shape FulfillmentDetail expects
  const customerName = raw.customer
    ? `${raw.customer.firstName ?? ""} ${raw.customer.lastName ?? ""}`.trim() || null
    : null;

  return {
    id:              raw.id,
    orderId:         raw.orderId,
    status:          raw.status,
    fulfillmentType: raw.fulfillmentType,
    trackingNumber:  raw.trackingNumber  ?? null,
    carrier:         raw.carrier         ?? null,
    notes:           raw.notes           ?? null,
    assignedTo:      raw.assignedTo      ?? null,
    updatedAt:       raw.updatedAt,
    // Flattened from nested order
    orderNumber:     raw.order?.orderNumber   ?? null,
    purchaseDate:    raw.order?.purchaseDate  ?? null,
    nftAmountTwd:    raw.order?.nftAmountTwd  ?? null,
    merchAmountTwd:  raw.order?.merchAmountTwd ?? null,
    customerName,
    // Items
    productItems: (raw.productItems ?? []).map((item: Record<string, unknown>) => ({
      productId:   String(item.productId),
      productName: String(item.name ?? ""),
      sku:         (item.sku as string | null) ?? null,
      quantity:    Number(item.quantity ?? 0),
      unitPrice:   Number(item.unitPrice ?? 0),
    })),
    nftItems: (raw.nftItems ?? []).map((item: Record<string, unknown>) => ({
      nftId:        String(item.nftRecordId ?? item.id),
      serialNumber: (item.serialNumber as string | null) ?? String(item.nftRecordId ?? item.id),
      waveName:     "—",
    })),
  };
}

export async function upsertFulfillment(params: {
  orderId: string;
  status?: string;
  fulfillmentType?: string;
  trackingNumber?: string;
  carrier?: string;
  notes?: string;
  assignedTo?: string;
  userId?: string;
}) {
  const { orderId, status, fulfillmentType, trackingNumber, carrier, notes, assignedTo, userId } = params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check previous status before updating
    const prev = await client.query(
      "SELECT status FROM order_fulfillment WHERE order_id = $1::uuid", [orderId]
    );
    const prevStatus = prev.rows[0]?.status ?? null;

    const { rows } = await client.query(
      "SELECT * FROM fulfillment_upsert($1::uuid, $2, $3, $4, $5, $6, $7)",
      [orderId, status ?? null, fulfillmentType ?? null, trackingNumber ?? null,
       carrier ?? null, notes ?? null, assignedTo ?? null]
    );

    // Deduct stock when transitioning to shipped
    if (status === "shipped" && prevStatus !== "shipped") {
      await client.query("SELECT products_ship_order($1::uuid, $2)", [orderId, userId ?? null]);
    }

    await client.query("COMMIT");
    return rows[0] ? toCamel([rows[0]])[0] : null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function initializeFulfillmentsForOrders() {
  const { rows } = await pool.query(`
    INSERT INTO order_fulfillment (order_id, fulfillment_type)
    SELECT
      o.id,
      CASE
        WHEN nft_counts.cnt > 0 AND prod_counts.cnt > 0 THEN 'mixed'
        WHEN nft_counts.cnt > 0                         THEN 'nft'
        ELSE                                                 'product'
      END AS fulfillment_type
    FROM orders o
    LEFT JOIN (
      SELECT order_id, COUNT(*) AS cnt FROM order_nft_items GROUP BY order_id
    ) nft_counts  ON nft_counts.order_id  = o.id
    LEFT JOIN (
      SELECT order_id, COUNT(*) AS cnt FROM order_product_items GROUP BY order_id
    ) prod_counts ON prod_counts.order_id = o.id
    WHERE o.id NOT IN (SELECT order_id FROM order_fulfillment)
    RETURNING id, order_id, fulfillment_type
  `);
  return { initialized: rows.length, fulfillments: toCamel(rows) };
}
