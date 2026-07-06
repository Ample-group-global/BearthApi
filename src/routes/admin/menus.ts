import { Router } from "express";
import { requireRole } from "../../presaleAuth";
import * as rbacService from "../../services/rbac.service";

const router = Router();

const requireTech = (req: Parameters<typeof requireRole>[0]) => {
  const { role } = requireRole(req);
  if (role !== "tech" && role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
};

router.get("/", async (req, res, next) => {
  try {
    requireTech(req);
    const menus = await rbacService.listMenus();
    res.json({ menus });
  } catch (e) { next(e); }
});

export default router;
