import { Router } from "express";
import bcrypt from "bcryptjs";
import { createSessionToken, verifySessionCookie, COOKIE_NAME, COOKIE_MAX_AGE } from "../walletAuth";
import pool from "../db";
import { signToken, AdminRole } from "../presaleAuth";

const router = Router();
const ADMIN_ADDRESS = (process.env.ADMIN_ADDRESS ?? "").toLowerCase();

router.post("/session", (req, res) => {
  try {
    const { address } = (req.body ?? {}) as { address?: string };
    if (!address) { res.status(400).json({ detail: "Address is required" }); return; }
    if (address.toLowerCase() !== ADMIN_ADDRESS) {
      res.status(403).json({ detail: "Only admin address can create session" });
      return;
    }
    const token = createSessionToken(address.toLowerCase());
    res.cookie(COOKIE_NAME, token, {
      maxAge: COOKIE_MAX_AGE * 1000,
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    res.json({ message: "Session created", address: address.toLowerCase() });
  } catch {
    res.status(500).json({ detail: "Internal server error" });
  }
});

router.get("/verify", (req, res) => {
  const address = verifySessionCookie(req.headers.cookie);
  res.json({ address, authenticated: address !== null });
});

router.delete("/session", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/", secure: true, sameSite: "none" });
  res.json({ message: "Session cleared" });
});

router.post("/admin/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" }); return;
    }
    const { rows } = await pool.query("SELECT * FROM users_get_by_email($1)", [String(email)]);
    const user = rows[0];
    if (!user || !user.is_active || !user.password_hash) {
      res.status(401).json({ error: "Invalid credentials" }); return;
    }
    const valid = await bcrypt.compare(String(password), user.password_hash as string);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" }); return;
    }
    const dbRole = user.role_code as string;
    const roleMap: Record<string, AdminRole> = {
      admin:          "admin",
      technical_team: "tech",
      tech:           "tech",
      operation:      "ops",
      ops:            "ops",
    };
    const adminRole = roleMap[dbRole];
    if (!adminRole) {
      res.status(403).json({ error: "Account does not have admin access" }); return;
    }
    const token = signToken(adminRole);
    res.json({ token, role: adminRole, success: true });
  } catch (e) { next(e); }
});

export default router;
