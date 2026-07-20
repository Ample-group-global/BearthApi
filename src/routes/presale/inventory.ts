import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as inventoryService from "../../services/inventory.service";

const router = Router();

// GET /api/presale/inventory — overview stats
router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const overview = await inventoryService.getInventoryOverview();
    res.json({ overview });
  } catch (e) { next(e); }
});

// GET /api/presale/inventory/purchase-orders
router.get("/purchase-orders", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await inventoryService.listPurchaseOrders({
      status: (req.query.status as string) || null,
      limit:  Number(req.query.limit  ?? 20),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/presale/inventory/purchase-orders
router.post("/purchase-orders", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const { poNumber, supplier, notes, expectedDate, items } = req.body ?? {};
    const { userId } = requirePermission(req, "products.create");
    const data = await inventoryService.createPurchaseOrder({
      poNumber, supplier, notes, expectedDate, createdBy: userId, items,
    });
    res.status(201).json({ purchaseOrder: data });
  } catch (e) { next(e); }
});

// GET /api/presale/inventory/purchase-orders/:id
router.get("/purchase-orders/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const data = await inventoryService.getPurchaseOrder(req.params.id);
    if (!data) { res.status(404).json({ error: "Purchase order not found" }); return; }
    res.json({ purchaseOrder: data });
  } catch (e) { next(e); }
});

// POST /api/presale/inventory/purchase-orders/:id/receive
router.post("/purchase-orders/:id/receive", async (req, res, next) => {
  try {
    const { userId } = requirePermission(req, "products.edit");
    const { items } = req.body ?? {};
    const data = await inventoryService.receivePurchaseOrder(req.params.id, items ?? [], userId);
    res.json({ purchaseOrder: data });
  } catch (e) { next(e); }
});

// GET /api/presale/inventory/stock-movements
router.get("/stock-movements", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await inventoryService.getStockMovements({
      productId: (req.query.productId as string) || null,
      limit:     Number(req.query.limit  ?? 50),
      offset:    Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/presale/inventory/returns
router.get("/returns", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const result = await inventoryService.listReturns({
      status: (req.query.status as string) || null,
      limit:  Number(req.query.limit  ?? 20),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/presale/inventory/returns
router.post("/returns", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { orderId, productId, quantity, reason, condition, notes } = req.body ?? {};
    const returnItem = await inventoryService.createReturn({
      orderId, productId, quantity, reason, condition, notes,
    });
    res.status(201).json({ return: returnItem });
  } catch (e) { next(e); }
});

// POST /api/presale/inventory/returns/:id/process
router.post("/returns/:id/process", async (req, res, next) => {
  try {
    const { userId } = requirePermission(req, "products.edit");
    const { status } = req.body ?? {};
    const returnItem = await inventoryService.processReturn(req.params.id, status, userId);
    res.json({ return: returnItem });
  } catch (e) { next(e); }
});

export default router;
