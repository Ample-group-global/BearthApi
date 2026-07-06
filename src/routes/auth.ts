import { Router } from "express";
import { createSessionToken, verifySessionCookie, COOKIE_NAME, COOKIE_MAX_AGE } from "../walletAuth";
import { signToken, verifyToken, AdminRole } from "../presaleAuth";
import * as authService from "../services/auth.service";
import * as rbacService from "../services/rbac.service";

const router = Router();
const ADMIN_ADDRESS = (process.env.ADMIN_ADDRESS ?? "").toLowerCase();

// Wallet session routes (whitelist admin)
router.post("/session", (req, res) => {
  try {
    const { address } = (req.body ?? {}) as { address?: string };
    if (!address) { res.status(400).json({ detail: "Address is required" }); return; }
    if (address.toLowerCase() !== ADMIN_ADDRESS) {
      res.status(403).json({ detail: "Only admin address can create session" }); return;
    }
    const token = createSessionToken(address.toLowerCase());
    res.cookie(COOKIE_NAME, token, {
      maxAge: COOKIE_MAX_AGE * 1000, httpOnly: true, secure: true, sameSite: "none", path: "/",
    });
    res.json({ message: "Session created", address: address.toLowerCase() });
  } catch { res.status(500).json({ detail: "Internal server error" }); }
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
    if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
    const user = await authService.getUserByEmail(String(email));
    if (!user || !user.isActive || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials" }); return;
    }
    const valid = await authService.verifyPassword(String(password), user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const roleMap: Record<string, AdminRole> = {
      admin: "admin", technical_team: "tech", tech: "tech", operation: "ops", ops: "ops",
    };
    const adminRole = roleMap[user.roleCode];
    if (!adminRole) { res.status(403).json({ error: "Account does not have admin access" }); return; }
    await authService.updateLastLogin(user.id);
    const token = signToken(adminRole, user.id);
    res.json({ token, role: adminRole, userId: user.id, success: true });
  } catch (e) { next(e); }
});

router.post("/admin/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (!email) { res.status(400).json({ error: "Email is required" }); return; }
    const user = await authService.getUserByEmail(String(email));
    // Always return success to avoid user enumeration
    if (user && user.isActive) {
      const token     = authService.createResetToken(user.email);
      const adminUrl  = process.env.ADMIN_URL ?? "http://localhost:3000";
      const resetLink = `${adminUrl}/reset-password?token=${token}`;
      // Log to console in dev; wire up your email provider here for production
      console.log(`[PasswordReset] ${user.email} → ${resetLink}`);
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.post("/admin/reset-password", async (req, res, next) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) { res.status(400).json({ error: "Token and password are required" }); return; }
    if (String(password).length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
    const result = authService.verifyResetToken(String(token));
    if (!result) { res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." }); return; }
    const updated = await authService.updatePassword(result.email, String(password));
    if (!updated) { res.status(404).json({ error: "Account not found or inactive." }); return; }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.get("/admin/me", async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
    const result = verifyToken(auth.slice(7));
    if (!result) { res.status(401).json({ error: "Invalid or expired token" }); return; }
    const context = await rbacService.getUserContext(result.userId);
    if (!context) { res.status(401).json({ error: "User not found or inactive" }); return; }
    res.json({ authenticated: true, ...context });
  } catch (e) { next(e); }
});

export default router;
