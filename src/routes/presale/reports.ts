import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as reportsService from "../../services/reports.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const summary = await reportsService.getReportsSummary();
    res.json(summary);
  } catch (e) { next(e); }
});

router.get("/sales-by-stage", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const stages = await reportsService.getSalesByStage();
    res.json({ stages });
  } catch (e) { next(e); }
});

router.get("/delivery", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const result = await reportsService.getDeliveryReport({
      statusCode: (req.query.status as string) ?? null,
      limit:      Number(req.query.limit  ?? 200),
      offset:     Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/reconciliation", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const result = await reportsService.getReconciliationReport({
      status: (req.query.status as string) ?? null,
      limit:  Number(req.query.limit  ?? 200),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/customers", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const result = await reportsService.getCustomerReport({
      search: (req.query.search as string) ?? null,
      limit:  Number(req.query.limit  ?? 200),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
