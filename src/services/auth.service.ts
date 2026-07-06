import pool from "../pool";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const RESET_SECRET = process.env.RESET_SECRET ?? process.env.ADMIN_SECRET ?? "bearth-reset-secret";
const RESET_EXPIRES_MS = 60 * 60 * 1000; // 1 hour

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleCode: string;
  passwordHash: string;
  isActive: boolean;
}

interface AuthUserRow {
  id: string;
  email: string;
  name: string;
  role_code: string;
  password_hash: string;
  is_active: boolean;
}

export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  const { rows } = await pool.query("SELECT * FROM users_get_by_email($1)", [email]);
  const row = rows[0] as AuthUserRow | undefined;
  if (!row) return null;
  return {
    id:           row.id,
    email:        row.email,
    name:         row.name,
    roleCode:     row.role_code,
    passwordHash: row.password_hash,
    isActive:     row.is_active,
  };
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function updateLastLogin(userId: string): Promise<void> {
  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1::uuid", [userId]);
}

export function createResetToken(email: string): string {
  const expiry  = Date.now() + RESET_EXPIRES_MS;
  const payload = `${email}:${expiry}`;
  const sig     = crypto.createHmac("sha256", RESET_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyResetToken(token: string): { email: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = decoded.slice(0, lastDot);
    const sig     = decoded.slice(lastDot + 1);
    const expected = crypto.createHmac("sha256", RESET_SECRET).update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const [email, expiryStr] = payload.split(":");
    if (!email || !expiryStr) return null;
    if (Date.now() > Number(expiryStr)) return null;
    return { email };
  } catch {
    return null;
  }
}

export async function updatePassword(email: string, newPassword: string): Promise<boolean> {
  const hash = await bcrypt.hash(newPassword, 12);
  const { rowCount } = await pool.query(
    "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2 AND is_active = true",
    [hash, email],
  );
  return (rowCount ?? 0) > 0;
}
