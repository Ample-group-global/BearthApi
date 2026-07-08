import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function getInventoryOverview() {
  const { rows } = await pool.query("SELECT * FROM inventory_overview()");
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function listPurchaseOrders(params: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { status = null, limit = 20, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM purchase_orders_list($1, $2, $3)",
    [status, limit, offset]
  );
  return {
    purchaseOrders: toCamel(rows),
    total:  Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function getPurchaseOrder(id: string) {
  const { rows } = await pool.query("SELECT purchase_order_get($1::uuid) AS data", [id]);
  return rows[0]?.data ?? null;
}

export async function createPurchaseOrder(params: {
  poNumber: string;
  supplier?: string;
  notes?: string;
  expectedDate?: string;
  createdBy?: string;
  items?: unknown[];
}) {
  const { poNumber, supplier, notes, expectedDate, createdBy, items = [] } = params;
  const { rows } = await pool.query(
    "SELECT purchase_order_create($1, $2, $3, $4::date, $5, $6::json) AS data",
    [poNumber, supplier ?? null, notes ?? null, expectedDate ?? null, createdBy ?? null, JSON.stringify(items)]
  );
  return rows[0]?.data ?? null;
}

export async function receivePurchaseOrder(id: string, items: unknown[], userId?: string | null) {
  const { rows } = await pool.query(
    "SELECT purchase_order_receive($1::uuid, $2::json, $3) AS data",
    [id, JSON.stringify(items), userId ?? null]
  );
  return rows[0]?.data ?? null;
}

export async function getStockMovements(params: {
  productId?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { productId = null, limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(`
    SELECT
      psa.id,
      psa.product_id,
      psa.change_qty,
      psa.previous_qty,
      psa.new_qty,
      psa.reason,
      psa.notes,
      psa.adjusted_by,
      p.name        AS product_name,
      p.sku         AS product_sku,
      CONCAT(u.first_name, ' ', u.last_name) AS adjusted_by_name,
      psa.created_at,
      COUNT(*) OVER() AS total_count
    FROM product_stock_adjustments psa
    LEFT JOIN products p ON p.id = psa.product_id
    LEFT JOIN users    u ON u.id = psa.adjusted_by
    WHERE ($1::uuid IS NULL OR psa.product_id = $1::uuid)
    ORDER BY psa.created_at DESC
    LIMIT $2 OFFSET $3
  `, [productId, limit, offset]);
  return {
    movements: toCamel(rows),
    total:     Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function listReturns(params: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { status = null, limit = 20, offset = 0 } = params;
  const { rows } = await pool.query(`
    SELECT
      r.*,
      p.name AS product_name, p.sku AS product_sku,
      o.order_number,
      COUNT(*) OVER() AS total_count
    FROM order_return_items r
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN orders   o ON o.id = r.order_id
    WHERE ($1::text IS NULL OR r.status = $1)
    ORDER BY r.created_at DESC
    LIMIT $2 OFFSET $3
  `, [status, limit, offset]);
  return {
    returns: toCamel(rows),
    total:   Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function createReturn(params: {
  orderId: string;
  productId: string;
  quantity?: number;
  reason?: string;
  condition?: string;
  notes?: string;
}) {
  const { orderId, productId, quantity = 1, reason, condition = "good", notes } = params;
  const { rows } = await pool.query(
    `INSERT INTO order_return_items (order_id, product_id, quantity, reason, condition, notes, status)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [orderId, productId, quantity, reason ?? null, condition, notes ?? null]
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function processReturn(returnId: string, status: string, processedBy?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE order_return_items
       SET status = $2, processed_by = $3, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [returnId, status, processedBy ?? null]
    );
    const ret = rows[0];

    // Auto-restock when return is approved and item is in sellable condition
    if (ret && status === "approved" && ret.condition === "sellable") {
      await client.query(
        "SELECT product_stock_adjust($1::uuid, $2, $3, $4, $5)",
        [ret.product_id, ret.quantity, "return_restocked",
         `Return approved: ${returnId}`, processedBy ?? null]
      );
    }

    await client.query("COMMIT");
    return ret ? toCamel([ret])[0] : null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
