import { Router } from "express";
import { requireRole } from "../../adminAuth";
import * as masterService from "../../services/master.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requireRole(req);
    const data = await masterService.getMasterData();
    res.json(data ?? {});
  } catch (e) { next(e); }
});

export default router;
