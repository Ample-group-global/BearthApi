import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as fulfillmentService from "../../services/fulfillment.service";

const router = Router();

// POST /api/presale/fulfillment/initialize — auto-create fulfillment records for all orders
router.post("/initialize", async (req, res, next) => {
  try {
    requirePermission(req, "orders.edit");
    const result = await fulfillmentService.initializeFulfillmentsForOrders();
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/presale/fulfillment
router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "orders.view");
    const result = await fulfillmentService.listFulfillments({
      status: (req.query.status as string) || null,
      type:   (req.query.type   as string) || null,
      limit:  Number(req.query.limit  ?? 20),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/presale/fulfillment/:orderId
router.get("/:orderId", async (req, res, next) => {
  try {
    requirePermission(req, "orders.view");
    const data = await fulfillmentService.getFulfillment(req.params.orderId);
    if (!data) { res.status(404).json({ error: "Fulfillment not found" }); return; }
    res.json({ fulfillment: data });
  } catch (e) { next(e); }
});

// POST /api/presale/fulfillment/:orderId
router.post("/:orderId", async (req, res, next) => {
  try {
    requirePermission(req, "orders.edit");
    const { status, trackingNumber, carrier, notes, assignedTo, fulfillmentType } = req.body ?? {};
    const userId = (req as unknown as Record<string, unknown>).presaleUser
      ? ((req as unknown as Record<string, unknown>).presaleUser as Record<string, unknown>).id as string
      : undefined;
    const fulfillment = await fulfillmentService.upsertFulfillment({
      orderId:         req.params.orderId,
      status,
      fulfillmentType,
      trackingNumber,
      carrier,
      notes,
      assignedTo,
      userId,
    });
    res.json({ fulfillment });
  } catch (e) { next(e); }
});

export default router;
