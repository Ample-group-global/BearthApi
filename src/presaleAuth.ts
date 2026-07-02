import { createHmac, timingSafeEqual } from "crypto";
import { Request } from "express";
import { HttpError } from "./errors";

const SECRET = process.env.AUTH_SECRET ?? "";

export type AdminRole = "admin" | "ops" | "tech";

const ALL_PERMISSIONS = [
  "dashboard.view",
  "orders.view", "orders.create", "orders.edit", "orders.delete",
  "orders.confirm_nft_payment", "orders.confirm_merch_payment",
  "nft.view", "nft.edit", "nft.confirm_delivery",
  "products.view", "products.create", "products.edit", "products.delete",
  "customers.view", "customers.create", "customers.edit", "customers.delete",
  "reconciliation.view", "reconciliation.confirm", "reconciliation.cancel",
  "reports.view",
  "users.view", "users.create", "users.edit", "users.delete", "users.revoke_permission",
];

export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  admin: ALL_PERMISSIONS,
  ops: [
    "dashboard.view",
    "orders.view", "orders.create", "orders.edit", "orders.delete",
    "orders.confirm_nft_payment", "orders.confirm_merch_payment",
    "nft.view", "nft.edit", "nft.confirm_delivery",
    "products.view", "products.create", "products.edit", "products.delete",
    "customers.view", "customers.create", "customers.edit", "customers.delete",
    "reconciliation.view", "reconciliation.confirm", "reconciliation.cancel",
    "reports.view",
    "users.view", "users.create", "users.edit", "users.delete", "users.revoke_permission",
  ],
  tech: [
    "dashboard.view",
    "nft.view", "nft.edit", "nft.confirm_delivery",
    "products.view", "products.create", "products.edit", "products.delete",
    "reports.view",
  ],
};

export function signToken(role: AdminRole): string {
  const payload = `${role}:${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyToken(token: string): AdminRole | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const [role] = payload.split(":");
    if (role !== "admin" && role !== "tech" && role !== "ops") return null;
    return role as AdminRole;
  } catch {
    return null;
  }
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export function requireRole(req: Request): AdminRole {
  const token = extractBearer(req);
  if (!token) throw new HttpError(401, "Unauthorized");
  const role = verifyToken(token);
  if (!role) throw new HttpError(401, "Invalid or expired token");
  return role;
}

export function requirePermission(req: Request, permission: string): AdminRole {
  const role = requireRole(req);
  if (!ROLE_PERMISSIONS[role].includes(permission)) {
    throw new HttpError(403, "Forbidden — insufficient permissions");
  }
  return role;
}
