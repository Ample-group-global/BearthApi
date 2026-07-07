import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function listProducts(params: {
  search?: string | null; category?: string | null; status?: string | null;
  limit?: number; offset?: number;
}) {
  const { search = null, category = null, status = null, limit = 20, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM products_list($1, $2, $3, $4, $5)",
    [search, category, status, limit, offset]
  );
  const { rows: statsRows } = await pool.query(`
    SELECT
      COUNT(*)                                                                            AS global_total,
      COUNT(*) FILTER (WHERE ps.code = 'active')                                         AS active_count,
      COUNT(*) FILTER (WHERE p.stock_qty = 0)                                            AS out_of_stock,
      COUNT(*) FILTER (WHERE p.stock_qty > 0 AND p.stock_qty <= 10)                      AS low_stock,
      COALESCE(SUM(p.presale_price * p.stock_qty), 0)                                    AS total_value,
      COALESCE(SUM(p.reserved_qty), 0)                                                   AS total_reserved,
      COALESCE(SUM(GREATEST(0, p.stock_qty - p.reserved_qty)), 0)                        AS total_available
    FROM products p
    LEFT JOIN product_statuses ps ON ps.id = p.status_id
  `);
  const st = statsRows[0] ?? {};

  return {
    products:       toCamel(rows),
    total:          Number(rows[0]?.total_count ?? 0),
    globalTotal:    Number(st.global_total    ?? 0),
    activeCount:    Number(st.active_count    ?? 0),
    outOfStock:     Number(st.out_of_stock    ?? 0),
    lowStock:       Number(st.low_stock       ?? 0),
    totalValue:     Number(st.total_value     ?? 0),
    totalReserved:  Number(st.total_reserved  ?? 0),
    totalAvailable: Number(st.total_available ?? 0),
    limit,
    offset,
  };
}

export async function getProduct(id: string) {
  const { rows } = await pool.query("SELECT * FROM products_get($1::uuid)", [id]);
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function createProduct(params: {
  name: string; retailPrice?: number; presalePrice?: number;
  statusId?: string; description?: string; stockQty?: number; sortOrder?: number;
  imageUrl?: string; sku?: string; category?: string;
}) {
  const { name, retailPrice, presalePrice, statusId, description,
          stockQty, sortOrder, imageUrl, sku, category } = params;
  const { rows } = await pool.query(
    "SELECT * FROM products_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [name, retailPrice ?? null, presalePrice ?? null, statusId ?? null,
     description ?? null, stockQty ?? 0, sortOrder ?? 0,
     imageUrl ?? null, sku ?? null, category ?? null]
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function updateProduct(id: string, params: {
  name?: string; retailPrice?: number; presalePrice?: number;
  statusId?: string; description?: string; stockQty?: number; sortOrder?: number;
  imageUrl?: string; sku?: string; category?: string;
}) {
  const { name, retailPrice, presalePrice, statusId, description,
          stockQty, sortOrder, imageUrl, sku, category } = params;
  const { rows } = await pool.query(
    "SELECT * FROM products_update($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [id, name ?? null, retailPrice ?? null, presalePrice ?? null,
     statusId ?? null, description ?? null, stockQty ?? null, sortOrder ?? null,
     imageUrl ?? null, sku ?? null, category ?? null]
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function deactivateProduct(id: string) {
  const { rows } = await pool.query("SELECT * FROM products_deactivate($1::uuid)", [id]);
  return rows[0] ?? null;
}

export async function adjustStock(params: {
  productId: string; changeQty: number;
  reason?: string; notes?: string; userId?: string;
}) {
  const { productId, changeQty, reason = "manual", notes, userId } = params;
  const { rows } = await pool.query(
    "SELECT * FROM product_stock_adjust($1::uuid, $2, $3, $4, $5)",
    [productId, changeQty, reason, notes ?? null, userId ?? null]
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function bulkCreateProducts(items: Array<{
  name: string; retailPrice?: number; presalePrice?: number;
  statusId?: string; description?: string; stockQty?: number;
  imageUrl?: string; sku?: string; category?: string;
}>) {
  const results: Array<{ success: boolean; name: string; id?: string; error?: string }> = [];
  for (const item of items) {
    try {
      const product = await createProduct(item);
      results.push({ success: true, name: item.name, id: product?.id as string | undefined });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ success: false, name: item.name, error: msg });
    }
  }
  return { results, created: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
}

export async function getStockHistory(productId: string, limit = 50, offset = 0) {
  const { rows } = await pool.query(
    "SELECT * FROM product_stock_history($1::uuid, $2, $3)",
    [productId, limit, offset]
  );
  return {
    history: toCamel(rows),
    total: Number(rows[0]?.total_count ?? 0),
    limit, offset,
  };
}

// ── Product Images ────────────────────────────────────────────────────

export async function getProductImages(productId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM product_images WHERE product_id = $1::uuid ORDER BY sort_order ASC, is_primary DESC",
    [productId]
  );
  return toCamel(rows);
}

export async function addProductImage(
  productId: string,
  url: string,
  caption?: string | null,
  isPrimary = false,
  sortOrder = 0
) {
  if (isPrimary) {
    await pool.query(
      "UPDATE product_images SET is_primary = FALSE WHERE product_id = $1::uuid",
      [productId]
    );
  }
  const { rows } = await pool.query(
    "INSERT INTO product_images (product_id, url, caption, is_primary, sort_order) VALUES ($1::uuid, $2, $3, $4, $5) RETURNING *",
    [productId, url, caption ?? null, isPrimary, sortOrder]
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function deleteProductImage(imageId: string, productId: string) {
  const { rows } = await pool.query(
    "DELETE FROM product_images WHERE id = $1::uuid AND product_id = $2::uuid RETURNING *",
    [imageId, productId]
  );
  return rows[0] ?? null;
}

export async function reorderProductImages(productId: string, orderedIds: string[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        "UPDATE product_images SET sort_order = $1 WHERE id = $2::uuid AND product_id = $3::uuid",
        [i, orderedIds[i], productId]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getProductImages(productId);
}

// ── Product Attributes ────────────────────────────────────────────────

export async function getProductAttributes(productId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM product_attributes WHERE product_id = $1::uuid ORDER BY sort_order ASC",
    [productId]
  );
  return toCamel(rows);
}

export async function setProductAttributes(
  productId: string,
  attrs: Array<{ key: string; label: string; value: string; sortOrder?: number }>
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM product_attributes WHERE product_id = $1::uuid", [productId]);
    for (let i = 0; i < attrs.length; i++) {
      const { key, label, value, sortOrder } = attrs[i];
      await client.query(
        "INSERT INTO product_attributes (product_id, attr_key, attr_label, attr_value, sort_order) VALUES ($1::uuid, $2, $3, $4, $5)",
        [productId, key, label, value, sortOrder ?? i]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getProductAttributes(productId);
}

// ── Category Templates ────────────────────────────────────────────────

export async function getCategoryTemplates(categoryCode: string) {
  const { rows } = await pool.query(
    "SELECT * FROM category_attribute_templates WHERE category_code ILIKE $1 ORDER BY sort_order ASC",
    [categoryCode]
  );
  return toCamel(rows);
}
