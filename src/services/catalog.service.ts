import pool from "../pool";
import { toCamel } from "../utils/camel";

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories(parentId?: string | null) {
  const { rows } = await pool.query(
    "SELECT * FROM catalog_category_tree($1::uuid)",
    [parentId ?? null],
  );
  return toCamel(rows);
}

export async function upsertCategory(params: {
  id?: string | null;
  parentId?: string | null;
  code?: string | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  isVisible?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
}) {
  const { id, parentId, code, name, slug, description, imageUrl,
          sortOrder, isActive, isVisible, metaTitle, metaDescription } = params;
  const { rows } = await pool.query(
    "SELECT * FROM catalog_category_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [id ?? null, parentId ?? null, code ?? null, name ?? null, slug ?? null, description ?? null, imageUrl ?? null, sortOrder ?? 0, isActive ?? true, isVisible ?? true, metaTitle ?? null, metaDescription ?? null],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function deleteCategory(id: string) {
  const { rowCount } = await pool.query(
    "UPDATE product_categories SET is_active = FALSE, updated_at = NOW() WHERE id = $1::uuid",
    [id],
  );
  return { deleted: (rowCount ?? 0) > 0 };
}

// ─── Brands ───────────────────────────────────────────────────────────────────

export async function listBrands(params: {
  search?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { search = null, limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM brands_list($1, $2, $3)",
    [search, limit, offset],
  );
  return {
    brands:      toCamel(rows),
    total:       Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function getBrand(id: string) {
  const { rows } = await pool.query(
    "SELECT b.*, COUNT(DISTINCT p.id) AS product_count, COUNT(DISTINCT c.id) AS collection_count FROM brands b LEFT JOIN products p ON p.brand_id = b.id AND p.deleted_at IS NULL LEFT JOIN collections c ON c.brand_id = b.id WHERE b.id = $1::uuid GROUP BY b.id",
    [id],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function upsertBrand(params: {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  slug?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  isActive?: boolean;
}) {
  const { id, name, code, slug, description, logoUrl, websiteUrl, isActive } = params;
  const { rows } = await pool.query(
    "SELECT * FROM catalog_brand_upsert($1,$2,$3,$4,$5,$6,$7,$8)",
    [id ?? null, name ?? null, code ?? null, slug ?? null, description ?? null, logoUrl ?? null, websiteUrl ?? null, isActive ?? true],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

// ─── Collections ─────────────────────────────────────────────────────────────

export async function listCollections(params: {
  brandId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { brandId = null, search = null, limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM collections_list($1::uuid, $2, $3, $4)",
    [brandId, search, limit, offset],
  );
  return {
    collections: toCamel(rows),
    total:       Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function upsertCollection(params: {
  id?: string | null;
  brandId?: string | null;
  name?: string | null;
  code?: string | null;
  slug?: string | null;
  description?: string | null;
  theme?: string | null;
  season?: string | null;
  year?: number | null;
  launchDate?: string | null;
  coverUrl?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
}) {
  const { id, brandId, name, code, slug, description, theme, season,
          year, launchDate, coverUrl, isActive, isFeatured } = params;
  const { rows } = await pool.query(
    "SELECT * FROM catalog_collection_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [id ?? null, brandId ?? null, name ?? null, code ?? null, slug ?? null, description ?? null, theme ?? null, season ?? null, year ?? null, launchDate ?? null, coverUrl ?? null, isActive ?? true, isFeatured ?? false],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

// ─── Product Variants & SKUs ──────────────────────────────────────────────────

export async function listVariants(productId: string) {
  const { rows } = await pool.query(
    `SELECT pv.*,
       COALESCE(
         json_agg(json_build_object(
           'id', ps.id, 'skuCode', ps.sku_code, 'barcode', ps.barcode,
           'skuComponents', ps.sku_components, 'isActive', ps.is_active
         )) FILTER (WHERE ps.id IS NOT NULL), '[]'
       ) AS skus
     FROM product_variants pv
     LEFT JOIN product_skus ps ON ps.variant_id = pv.id AND ps.is_active
     WHERE pv.product_id = $1::uuid AND pv.deleted_at IS NULL
     GROUP BY pv.id
     ORDER BY pv.display_order, pv.created_at`,
    [productId],
  );
  return toCamel(rows);
}

export async function upsertVariant(productId: string, params: {
  id?: string | null;
  variantName?: string | null;
  option1Name?: string | null;  option1Value?: string | null;
  option2Name?: string | null;  option2Value?: string | null;
  option3Name?: string | null;  option3Value?: string | null;
  displayOrder?: number;
  isDefault?: boolean;
  isActive?: boolean;
  imageUrl?: string | null;
}) {
  const { id, variantName, option1Name, option1Value, option2Name, option2Value,
          option3Name, option3Value, displayOrder, isDefault, isActive, imageUrl } = params;
  const { rows } = await pool.query(
    "SELECT * FROM product_variant_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [productId, id ?? null, variantName ?? null, option1Name ?? null, option1Value ?? null, option2Name ?? null, option2Value ?? null, option3Name ?? null, option3Value ?? null, displayOrder ?? 0, isDefault ?? false, isActive ?? true, imageUrl ?? null],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function deleteVariant(productId: string, variantId: string) {
  const { rowCount } = await pool.query(
    "UPDATE product_variants SET deleted_at = NOW(), is_active = FALSE WHERE id = $1::uuid AND product_id = $2::uuid",
    [variantId, productId],
  );
  return { deleted: (rowCount ?? 0) > 0 };
}

export async function generateSku(params: {
  productId: string;
  variantId?: string | null;
  colorCode?: string | null;
  sizeCode?: string | null;
  customCode?: string | null;
}) {
  const { productId, variantId, colorCode, sizeCode, customCode } = params;
  const { rows } = await pool.query(
    "SELECT * FROM product_sku_generate($1::uuid, $2::uuid, $3, $4, $5)",
    [productId, variantId ?? null, colorCode ?? null, sizeCode ?? null, customCode ?? null],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function updateSku(skuId: string, params: {
  skuCode?: string;
  barcode?: string | null;
  upc?: string | null;
  ean?: string | null;
  isActive?: boolean;
}) {
  const { skuCode, barcode, upc, ean, isActive } = params;
  const { rows } = await pool.query(
    `UPDATE product_skus SET
       sku_code   = COALESCE($1, sku_code),
       barcode    = COALESCE($2, barcode),
       upc        = COALESCE($3, upc),
       ean        = COALESCE($4, ean),
       is_active  = COALESCE($5, is_active),
       updated_at = NOW()
     WHERE id = $6::uuid
     RETURNING *`,
    [skuCode ?? null, barcode ?? null, upc ?? null, ean ?? null, isActive ?? null, skuId],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

// ─── Inventory (catalog view) ─────────────────────────────────────────────────

export async function getInventorySummary(params: {
  skuId?: string | null;
  warehouseId?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { skuId = null, warehouseId = null, limit = 50, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM inventory_summary($1::uuid, $2::uuid, $3, $4)",
    [skuId, warehouseId, limit, offset],
  );
  return {
    items:  toCamel(rows),
    total:  Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function adjustInventory(params: {
  skuId: string;
  warehouseId: string;
  qtyChange: number;
  type: string;
  notes?: string | null;
  reasonCode?: string | null;
  referenceId?: string | null;
  referenceType?: string | null;
  referenceNumber?: string | null;
  userId?: string | null;
}) {
  const { skuId, warehouseId, qtyChange, type, notes, reasonCode,
          referenceId, referenceType, referenceNumber, userId } = params;
  const { rows } = await pool.query(
    "SELECT * FROM inventory_adjust($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,$10::uuid)",
    [skuId, warehouseId, qtyChange, type, notes ?? null, reasonCode ?? null, referenceId ?? null, referenceType ?? null, referenceNumber ?? null, userId ?? null],
  );
  return rows[0] ? toCamel([rows[0]])[0] : null;
}

export async function listWarehouses() {
  const { rows } = await pool.query(
    "SELECT * FROM warehouses WHERE is_active = TRUE ORDER BY is_default DESC, name",
  );
  return toCamel(rows);
}

// ─── Extended product detail ──────────────────────────────────────────────────

export async function getProductDetail(productId: string) {
  const { rows } = await pool.query(
    "SELECT catalog_product_detail($1::uuid) AS data",
    [productId],
  );
  return rows[0]?.data ?? null;
}

export async function listProductsCatalog(params: {
  categoryId?: string | null;
  brandId?: string | null;
  collectionId?: string | null;
  productType?: string | null;
  statusCode?: string | null;
  search?: string | null;
  isFeatured?: boolean | null;
  limit?: number;
  offset?: number;
}) {
  const { categoryId = null, brandId = null, collectionId = null,
          productType = null, statusCode = null, search = null,
          isFeatured = null, limit = 20, offset = 0 } = params;
  const { rows } = await pool.query(
    "SELECT * FROM catalog_product_list($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9)",
    [categoryId, brandId, collectionId, productType, statusCode, search, isFeatured, limit, offset],
  );
  return {
    products: toCamel(rows),
    total:    Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}
