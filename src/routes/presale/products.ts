import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as productsService from "../../services/products.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await productsService.listProducts({
      search:   (req.query.search   as string) || null,
      category: (req.query.category as string) || null,
      status:   (req.query.status   as string) || null,
      limit:    Number(req.query.limit  ?? 20),
      offset:   Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const { name, retailPrice, presalePrice, statusId, description,
            stockQty, sortOrder, imageUrl, sku, category } = req.body ?? {};
    const product = await productsService.createProduct({
      name, retailPrice, presalePrice, statusId, description,
      stockQty, sortOrder, imageUrl, sku, category,
    });
    res.status(201).json({ product });
  } catch (e) { next(e); }
});

// ── Category Attribute Templates (static — must be before /:id) ───────

router.get("/attribute-templates", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const category = (req.query.category as string) || "";
    if (!category) {
      res.status(400).json({ error: "category query param is required" }); return;
    }
    const templates = await productsService.getCategoryTemplates(category);
    res.json({ templates });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const product = await productsService.getProduct(req.params.id);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    res.json({ product });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { name, retailPrice, presalePrice, statusId, description,
            stockQty, sortOrder, imageUrl, sku, category } = req.body ?? {};
    const product = await productsService.updateProduct(req.params.id, {
      name, retailPrice, presalePrice, statusId, description,
      stockQty, sortOrder, imageUrl, sku, category,
    });
    res.json({ product });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.delete");
    const result = await productsService.deactivateProduct(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/:id/adjust-stock", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { changeQty, reason, notes } = req.body ?? {};
    const userId = (req as any).presaleUser?.userId ?? null;
    const result = await productsService.adjustStock({
      productId: req.params.id,
      changeQty: Number(changeQty),
      reason, notes, userId,
    });
    res.json({ adjustment: result });
  } catch (e) { next(e); }
});

router.post("/bulk", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items array is required and must not be empty." }); return;
    }
    if (items.length > 500) {
      res.status(400).json({ error: "Maximum 500 products per import." }); return;
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.name || typeof item.name !== "string" || !item.name.trim()) {
        res.status(400).json({ error: `Row ${i + 1}: Name is required.` }); return;
      }
      if (item.retailPrice !== undefined && isNaN(Number(item.retailPrice))) {
        res.status(400).json({ error: `Row ${i + 1}: Retail Price must be a number.` }); return;
      }
      if (item.presalePrice !== undefined && isNaN(Number(item.presalePrice))) {
        res.status(400).json({ error: `Row ${i + 1}: Bearth Price must be a number.` }); return;
      }
    }
    const result = await productsService.bulkCreateProducts(items);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.get("/:id/stock-history", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await productsService.getStockHistory(
      req.params.id,
      Number(req.query.limit  ?? 50),
      Number(req.query.offset ?? 0),
    );
    res.json(result);
  } catch (e) { next(e); }
});

// ── Product Images ────────────────────────────────────────────────────

router.get("/:id/images", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const images = await productsService.getProductImages(req.params.id);
    res.json({ images });
  } catch (e) { next(e); }
});

router.post("/:id/images", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { url, caption, isPrimary, sortOrder } = req.body ?? {};
    const image = await productsService.addProductImage(
      req.params.id, url, caption ?? null, isPrimary ?? false, sortOrder ?? 0
    );
    res.status(201).json({ image });
  } catch (e) { next(e); }
});

router.delete("/:id/images/:imageId", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const result = await productsService.deleteProductImage(req.params.imageId, req.params.id);
    if (!result) { res.status(404).json({ error: "Image not found" }); return; }
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

router.put("/:id/images/reorder", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { orderedIds } = req.body ?? {};
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: "orderedIds must be an array" }); return;
    }
    const images = await productsService.reorderProductImages(req.params.id, orderedIds as string[]);
    res.json({ images });
  } catch (e) { next(e); }
});

// ── Product Attributes ────────────────────────────────────────────────

router.get("/:id/attributes", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const attributes = await productsService.getProductAttributes(req.params.id);
    res.json({ attributes });
  } catch (e) { next(e); }
});

router.put("/:id/attributes", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { attrs } = req.body ?? {};
    if (!Array.isArray(attrs)) {
      res.status(400).json({ error: "attrs must be an array" }); return;
    }
    const attributes = await productsService.setProductAttributes(
      req.params.id,
      attrs as Array<{ key: string; label: string; value: string; sortOrder?: number }>
    );
    res.json({ attributes });
  } catch (e) { next(e); }
});

export default router;
