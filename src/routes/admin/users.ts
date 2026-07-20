import { Router } from "express";
import { requireRole } from "../../adminAuth";
import * as usersService from "../../services/users.service";

const router = Router();

const requireTech = (req: Parameters<typeof requireRole>[0]) => {
  const { role } = requireRole(req);
  if (role !== "tech" && role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
};

router.get("/", async (req, res, next) => {
  try {
    requireTech(req);
    const result = await usersService.listUsers({
      search: (req.query.search as string) ?? null,
      limit:  Number(req.query.limit  ?? 100),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requireTech(req);
    const data = await usersService.getUser(req.params.id);
    if (!data) { res.status(404).json({ error: "User not found" }); return; }
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requireTech(req);
    const { email, firstName, lastName, phone, roleId } = req.body ?? {};
    const user = await usersService.createUser({ email, firstName, lastName, phone, roleId });
    res.status(201).json({ user });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requireTech(req);
    const { email, firstName, lastName, phone, roleId, isActive } = req.body ?? {};
    const user = await usersService.updateUser(req.params.id, {
      email, firstName, lastName, phone, roleId, isActive,
    });
    res.json({ user });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requireTech(req);
    const result = await usersService.deactivateUser(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

router.get("/:id/permissions", async (req, res, next) => {
  try {
    requireTech(req);
    const permissions = await usersService.getPermissionOverrides(req.params.id);
    res.json({ permissions });
  } catch (e) { next(e); }
});

router.post("/:id/permissions", async (req, res, next) => {
  try {
    requireTech(req);
    const { permissionId, isGranted, reason } = req.body ?? {};
    const override = await usersService.setPermissionOverride(req.params.id, permissionId, isGranted, reason);
    res.json({ override });
  } catch (e) { next(e); }
});

router.delete("/:id/permissions/:permissionId", async (req, res, next) => {
  try {
    requireTech(req);
    await usersService.removePermissionOverride(req.params.id, req.params.permissionId);
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
