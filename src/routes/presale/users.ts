import { Router } from "express";
import { requirePermission } from "../../presaleAuth";
import * as usersService from "../../services/users.service";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "users.view");
    const result = await usersService.listUsers({
      search: (req.query.search as string) ?? null,
      limit:  Number(req.query.limit  ?? 100),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "users.create");
    const { email, firstName, lastName, phone, roleId } = req.body ?? {};
    const user = await usersService.createUser({ email, firstName, lastName, phone, roleId });
    res.status(201).json({ user });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "users.view");
    const data = await usersService.getUser(req.params.id);
    if (!data) { res.status(404).json({ error: "User not found" }); return; }
    res.json(data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.action === "revoke_permission" || body.action === "grant_permission") {
      requirePermission(req, "users.revoke_permission");
      const isGranted = body.action === "grant_permission";
      const result = await usersService.setPermissionOverride(
        req.params.id, body.permissionId ?? null, isGranted, body.reason
      );
      res.json(result); return;
    }
    requirePermission(req, "users.edit");
    const { email, firstName, lastName, phone, roleId, isActive } = body;
    const user = await usersService.updateUser(req.params.id, {
      email, firstName, lastName, phone, roleId, isActive,
    });
    res.json({ user });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "users.delete");
    const result = await usersService.deactivateUser(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
