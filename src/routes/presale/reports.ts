import { Router } from "express";
import { requirePermission } from "../../adminAuth";
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
    const sdRaw = req.query.sort_dir as string | undefined;
    const result = await reportsService.getDeliveryReport({
      statusCode: (req.query.status   as string) ?? null,
      limit:      Number(req.query.limit  ?? 20),
      offset:     Number(req.query.offset ?? 0),
      sortBy:     (req.query.sort_by  as string) ?? null,
      sortDir:    sdRaw === "asc" ? "asc" : sdRaw === "desc" ? "desc" : null,
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/reconciliation", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const sdRaw2 = req.query.sort_dir as string | undefined;
    const result = await reportsService.getReconciliationReport({
      status:  (req.query.status  as string) ?? null,
      limit:   Number(req.query.limit  ?? 20),
      offset:  Number(req.query.offset ?? 0),
      sortBy:  (req.query.sort_by as string) ?? null,
      sortDir: sdRaw2 === "asc" ? "asc" : sdRaw2 === "desc" ? "desc" : null,
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/customers", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const sdRaw3 = req.query.sort_dir as string | undefined;
    const result = await reportsService.getCustomerReport({
      search:  (req.query.search  as string) ?? null,
      limit:   Number(req.query.limit  ?? 20),
      offset:  Number(req.query.offset ?? 0),
      sortBy:  (req.query.sort_by as string) ?? null,
      sortDir: sdRaw3 === "asc" ? "asc" : sdRaw3 === "desc" ? "desc" : null,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
