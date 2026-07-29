import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as catalogService from "../../services/catalog.service";

const router = Router();

// ══ CATEGORIES ════════════════════════════════════════════════════════════════

router.get("/categories", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const parentId = (req.query.parentId as string) || null;
    const categories = await catalogService.listCategories(parentId);
    res.json({ categories });
  } catch (e) { next(e); }
});

router.post("/categories", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const category = await catalogService.upsertCategory({ ...req.body ?? {}, id: null });
    res.status(201).json({ category });
  } catch (e) { next(e); }
});

router.put("/categories/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const category = await catalogService.upsertCategory({ ...req.body ?? {}, id: req.params.id });
    res.json({ category });
  } catch (e) { next(e); }
});

router.delete("/categories/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const result = await catalogService.deleteCategory(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

// ══ BRANDS ════════════════════════════════════════════════════════════════════

router.get("/brands", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await catalogService.listBrands({
      search: (req.query.search as string) || null,
      limit:  Number(req.query.limit  ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/brands/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const brand = await catalogService.getBrand(req.params.id);
    if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }
    res.json({ brand });
  } catch (e) { next(e); }
});

router.post("/brands", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const brand = await catalogService.upsertBrand({ ...req.body ?? {}, id: null });
    res.status(201).json({ brand });
  } catch (e) { next(e); }
});

router.put("/brands/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const brand = await catalogService.upsertBrand({ ...req.body ?? {}, id: req.params.id });
    res.json({ brand });
  } catch (e) { next(e); }
});

// ══ COLLECTIONS ═══════════════════════════════════════════════════════════════

router.get("/collections", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await catalogService.listCollections({
      brandId: (req.query.brandId as string) || null,
      search:  (req.query.search  as string) || null,
      limit:   Number(req.query.limit  ?? 50),
      offset:  Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/collections", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const collection = await catalogService.upsertCollection({ ...req.body ?? {}, id: null });
    res.status(201).json({ collection });
  } catch (e) { next(e); }
});

router.put("/collections/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const collection = await catalogService.upsertCollection({ ...req.body ?? {}, id: req.params.id });
    res.json({ collection });
  } catch (e) { next(e); }
});

// ══ PRODUCT VARIANTS & SKUs ═══════════════════════════════════════════════════

router.get("/products/:productId/variants", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const variants = await catalogService.listVariants(req.params.productId);
    res.json({ variants });
  } catch (e) { next(e); }
});

router.post("/products/:productId/variants", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const variant = await catalogService.upsertVariant(req.params.productId, { ...req.body ?? {}, id: null });
    res.status(201).json({ variant });
  } catch (e) { next(e); }
});

router.put("/products/:productId/variants/:variantId", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const variant = await catalogService.upsertVariant(req.params.productId, { ...req.body ?? {}, id: req.params.variantId });
    res.json({ variant });
  } catch (e) { next(e); }
});

router.delete("/products/:productId/variants/:variantId", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const result = await catalogService.deleteVariant(req.params.productId, req.params.variantId);
    res.json(result);
  } catch (e) { next(e); }
});

// ── SKU generation
router.post("/products/:productId/skus/generate", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { variantId, colorCode, sizeCode, customCode } = req.body ?? {};
    const sku = await catalogService.generateSku({
      productId: req.params.productId, variantId, colorCode, sizeCode, customCode,
    });
    res.status(201).json({ sku });
  } catch (e) { next(e); }
});

router.put("/skus/:skuId", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const sku = await catalogService.updateSku(req.params.skuId, req.body ?? {});
    res.json({ sku });
  } catch (e) { next(e); }
});

// ── Extended product detail (with variants, skus, images, attributes)
router.get("/products/:productId/detail", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const product = await catalogService.getProductDetail(req.params.productId);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    res.json({ product });
  } catch (e) { next(e); }
});

// ── Extended product list (with brand, category, collection filters)
router.get("/products", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await catalogService.listProductsCatalog({
      categoryId:   (req.query.categoryId   as string) || null,
      brandId:      (req.query.brandId      as string) || null,
      collectionId: (req.query.collectionId as string) || null,
      productType:  (req.query.productType  as string) || null,
      statusCode:   (req.query.statusCode   as string) || null,
      search:       (req.query.search       as string) || null,
      isFeatured:   req.query.isFeatured === "true" ? true : req.query.isFeatured === "false" ? false : null,
      limit:        Number(req.query.limit  ?? 20),
      offset:       Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// ══ INVENTORY (per SKU) ═══════════════════════════════════════════════════════

router.get("/inventory", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await catalogService.getInventorySummary({
      skuId:       (req.query.skuId       as string) || null,
      warehouseId: (req.query.warehouseId as string) || null,
      limit:       Number(req.query.limit  ?? 50),
      offset:      Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/inventory/adjust", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { session } = req as { session?: { userId?: string } };
    const result = await catalogService.adjustInventory({
      ...req.body ?? {},
      userId: session?.userId ?? null,
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/warehouses", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const warehouses = await catalogService.listWarehouses();
    res.json({ warehouses });
  } catch (e) { next(e); }
});

export default router;
