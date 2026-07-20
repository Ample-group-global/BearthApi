import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import * as reconciliationService from "../../services/reconciliation.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "reconciliation.view");
    const result = await reconciliationService.listReconciliation({
      status:  (req.query.status   as string) ?? null,
      orderId: (req.query.order_id as string) ?? null,
      limit:   Number(req.query.limit  ?? 100),
      offset:  Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "reconciliation.view");
    const entry = await reconciliationService.getReconciliation(req.params.id);
    if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
    res.json({ entry });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { action, notes } = req.body ?? {};
    if (action === "confirm") {
      requirePermission(req, "reconciliation.confirm");
      const entry = await reconciliationService.confirmReconciliation(req.params.id, notes);
      res.json({ entry }); return;
    }
    if (action === "cancel") {
      requirePermission(req, "reconciliation.cancel");
      const entry = await reconciliationService.cancelReconciliation(req.params.id, notes);
      res.json({ entry }); return;
    }
    res.status(400).json({ error: "Invalid action — use 'confirm' or 'cancel'" });
  } catch (e) { next(e); }
});

export default router;
