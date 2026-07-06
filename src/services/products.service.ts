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
  return { products: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset };
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
