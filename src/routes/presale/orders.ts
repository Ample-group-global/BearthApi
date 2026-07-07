import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as ordersService from "../../services/orders.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "orders.view");
    const sdRaw = req.query.sort_dir as string | undefined;
    const result = await ordersService.listOrders({
      search:     (req.query.search      as string) ?? null,
      customerId: (req.query.customer_id as string) ?? null,
      nftStatus:  (req.query.nft_status  as string) ?? null,
      limit:      Number(req.query.limit  ?? 20),
      offset:     Number(req.query.offset ?? 0),
      sortBy:     (req.query.sort_by     as string) ?? null,
      sortDir:    sdRaw === "asc" ? "asc" : sdRaw === "desc" ? "desc" : null,
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "orders.create");
    const order = await ordersService.createOrder(req.body ?? {});
    res.status(201).json({ order });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "orders.view");
    const data = await ordersService.getOrder(req.params.id);
    if (!data) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.action === "confirm_nft") {
      requirePermission(req, "orders.confirm_nft_payment");
      const order = await ordersService.confirmNftPayment(req.params.id, body.nftPaymentStatusId ?? null);
      res.json({ order }); return;
    }
    if (body.action === "confirm_merch") {
      requirePermission(req, "orders.confirm_merch_payment");
      const order = await ordersService.confirmMerchPayment(req.params.id, body.merchPaymentStatusId ?? null);
      res.json({ order }); return;
    }
    requirePermission(req, "orders.edit");
    const order = await ordersService.updateOrder(req.params.id, body);
    res.json({ order });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "orders.delete");
    const result = await ordersService.deleteOrder(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
