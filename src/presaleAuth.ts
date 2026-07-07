import { createHmac, timingSafeEqual } from "crypto";
import { Request } from "express";
import { HttpError } from "./errors";

const SECRET = process.env.AUTH_SECRET ?? "";

export type AdminRole = "admin" | "ops" | "tech";

const ALL_PERMISSIONS = [
  "dashboard.view",
  "orders.view", "orders.create", "orders.edit", "orders.delete",
  "orders.confirm_nft_payment", "orders.confirm_merch_payment",
  "nft.view", "nft.edit", "nft.confirm_delivery", "nft.view_technical",
  "nft.waves.view", "nft.waves.manage",
  "products.view", "products.create", "products.edit", "products.delete",
  "customers.view", "customers.create", "customers.edit", "customers.delete",
  "reconciliation.view", "reconciliation.confirm", "reconciliation.cancel",
  "reports.view",
  "users.view", "users.create", "users.edit", "users.delete", "users.revoke_permission",
  "nft_gen.view", "nft_gen.manage_collections", "nft_gen.manage_layers",
  "nft_gen.generate", "nft_gen.upload_ipfs",
  "settings.view", "settings.edit",
];

export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  admin: ALL_PERMISSIONS,
  ops: [
    "dashboard.view",
    "orders.view", "orders.create", "orders.edit", "orders.delete",
    "orders.confirm_nft_payment", "orders.confirm_merch_payment",
    "nft.view", "nft.edit", "nft.confirm_delivery",
    "nft.waves.view",
    "products.view", "products.create", "products.edit", "products.delete",
    "customers.view", "customers.create", "customers.edit", "customers.delete",
    "reconciliation.view", "reconciliation.confirm", "reconciliation.cancel",
    "reports.view",
    "users.view", "users.create", "users.edit", "users.delete", "users.revoke_permission",
    "settings.view",
  ],
  tech: [
    "dashboard.view",
    "nft.view", "nft.edit", "nft.confirm_delivery", "nft.view_technical",
    "nft.waves.view", "nft.waves.manage",
    "products.view", "products.create", "products.edit", "products.delete",
    "reports.view",
    "nft_gen.view", "nft_gen.manage_collections", "nft_gen.manage_layers",
    "nft_gen.generate", "nft_gen.upload_ipfs",
  ],
};

export function signToken(role: AdminRole, userId: string): string {
  const payload = `${userId}:${role}:${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyToken(token: string): { role: AdminRole; userId: string } | null {
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
    const parts = payload.split(":");
    if (parts.length < 3) return null;
    const [userId, role] = parts;
    if (role !== "admin" && role !== "tech" && role !== "ops") return null;
    return { role: role as AdminRole, userId };
  } catch {
    return null;
  }
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export function requireRole(req: Request): { role: AdminRole; userId: string } {
  const token = extractBearer(req);
  if (!token) throw new HttpError(401, "Unauthorized");
  const result = verifyToken(token);
  if (!result) throw new HttpError(401, "Invalid or expired token");
  return result;
}

export function requirePermission(req: Request, permission: string): { role: AdminRole; userId: string } {
  const result = requireRole(req);
  if (!ROLE_PERMISSIONS[result.role].includes(permission)) {
    throw new HttpError(403, "Forbidden — insufficient permissions");
  }
  return result;
}
