import { Router } from "express";
import { requireRole } from "../../adminAuth";
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

router.patch("/:id", async (req, res, next) => {
  try {
    requireTech(req);
    const { id } = req.params;
    const { is_active } = req.body as { is_active: boolean };
    if (typeof is_active !== "boolean") return res.status(400).json({ error: "is_active (boolean) required" });
    await rbacService.toggleMenuActive(id, is_active);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
