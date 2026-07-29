import { Router } from "express";
import { requireTech } from "../../adminAuth";
import * as rbacService from "../../services/rbac.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requireTech(req);
    const permissions = await rbacService.listPermissions();
    res.json({ permissions });
  } catch (e) { next(e); }
});

export default router;
