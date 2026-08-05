import authPool from "../auth-pool";
import bcrypt from "bcryptjs";
import { encodeHmacToken, decodeHmacToken } from "../utils/hmac-token";

const RESET_SECRET = process.env.RESET_SECRET ?? process.env.AUTH_SECRET ?? "bearth-reset-secret";
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
  const { rows } = await authPool.query("SELECT * FROM users_get_by_email($1)", [email]);
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
  await authPool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1::uuid", [userId]);
}

export function createResetToken(email: string): string {
  const expiry = Date.now() + RESET_EXPIRES_MS;
  return encodeHmacToken(`${email}:${expiry}`, RESET_SECRET);
}

export function verifyResetToken(token: string): { email: string } | null {
  const payload = decodeHmacToken(token, RESET_SECRET);
  if (!payload) return null;
  const [email, expiryStr] = payload.split(":");
  if (!email || !expiryStr) return null;
  if (Date.now() > Number(expiryStr)) return null;
  return { email };
}

export async function updatePassword(email: string, newPassword: string): Promise<boolean> {
  const hash = await bcrypt.hash(newPassword, 12);
  const { rowCount } = await authPool.query(
    "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2 AND is_active = true",
    [hash, email],
  );
  return (rowCount ?? 0) > 0;
}
