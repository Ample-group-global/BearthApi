import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as productsService from "../../services/products.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await productsService.listProducts({
      search:   (req.query.search   as string) ?? null,
      category: (req.query.category as string) ?? null,
      status:   (req.query.status   as string) ?? null,
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

export default router;
