import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";
import authRouter from "./routes/auth";
import whitelistRouter from "./routes/whitelist";
import proofRouter from "./routes/proof";
import presaleRouter from "./routes/presale/index";
import adminRolesRouter from "./routes/admin/roles";
import adminPermissionsRouter from "./routes/admin/permissions";
import adminMenusRouter from "./routes/admin/menus";
import adminUsersRouter from "./routes/admin/users";
import nftGenRouter from "./routes/nft-gen/index";
import pool from "./pool";
import { buildMerkleTree } from "./merkle";
import { errorHandler } from "./errorHandler";

const app = express();
const PORT = Number(process.env.PORT ?? 8000);

// ── Middleware ────────────────────────────────────────────────────────────────

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map(s => s.trim());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, limit: 500, standardHeaders: "draft-7", legacyHeaders: false }));

// ── Swagger UI ────────────────────────────────────────────────────────────────

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api/docs.json", (_req, res) => { res.setHeader("Content-Type", "application/json"); res.send(swaggerSpec); });

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/whitelist", whitelistRouter);
app.use("/api/proof", proofRouter);
app.use("/api/presale", presaleRouter);
app.use("/api/admin/roles",       adminRolesRouter);
app.use("/api/admin/permissions", adminPermissionsRouter);
app.use("/api/admin/menus",       adminMenusRouter);
app.use("/api/admin/users",       adminUsersRouter);
app.use("/api/nft-gen",           nftGenRouter);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ── Error handler (must be last) ──────────────────────────────────────────────

app.use(errorHandler);

// ── Local dev only: start persistent server + recalc merkle root ──────────────
// On Vercel (serverless) we just export the app — no listen(), no startup logic.

if (!process.env.VERCEL) {
  async function recalcMerkleOnStartup() {
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT * FROM whitelist_state_get()");
      const state = rows[0];
      if (state?.manual_override) {
        console.log(`Merkle root manual override active: ${(state.merkle_root as string).slice(0, 18)}... (recalc skipped)`);
        return;
      }
      const { rows: addrRows } = await client.query("SELECT * FROM whitelist_addresses_all()");
      const addresses = addrRows.map((r: { address: string }) => r.address);
      const root = addresses.length ? buildMerkleTree(addresses).root : "0x0";
      await client.query("SELECT whitelist_state_update_root($1)", [root]);
      console.log(`Merkle root recalculated: ${root.slice(0, 18)}... (${addresses.length} addresses)`);
    } catch (e) {
      console.warn("Warning: Could not recalculate merkle root on startup:", e);
    } finally {
      client?.release();
    }
  }

  app.listen(PORT, () => {
    console.log(`BearthApi listening on port ${PORT}`);
    recalcMerkleOnStartup().catch(e => console.warn("Startup Merkle recalc failed:", e));
  });
}

// Vercel uses this as the serverless function handler
export default app;
