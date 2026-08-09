// Load .env.local if DATABASE_URL is not already set (e.g. started without --env-file)
import { config as loadEnv } from "dotenv";
if (!process.env.DATABASE_URL) loadEnv({ path: ".env.local" });

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
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
import openSeaRouter from "./routes/opensea";
import nftSellWavesRouter       from "./routes/nft-sell/waves";
import nftSellRoyaltyRouter     from "./routes/nft-sell/royalty";
import nftSellCustomersRouter   from "./routes/nft-sell/customers";
import nftSellCollectionRouter  from "./routes/nft-sell/collection";
import nftSellAdminSalesRouter  from "./routes/nft-sell/admin-sales";
import nftSellLookupsRouter     from "./routes/nft-sell/lookups";
import nftSellStakingRouter         from "./routes/nft-sell/staking";
import nftSellStrategiesRouter       from "./routes/nft-sell/strategies";
import nftSellAuctionsRouter         from "./routes/nft-sell/auctions";
import nftSellMembershipRouter       from "./routes/nft-sell/membership";
import nftSellEventsRouter           from "./routes/nft-sell/events";
import nftSellSeasonsRouter          from "./routes/nft-sell/seasons";
import nftSellPacksRouter            from "./routes/nft-sell/packs";
import nftSellBurnRouter             from "./routes/nft-sell/burn";
import nftSellCollaborationsRouter   from "./routes/nft-sell/collaborations";
import nftSellOtcRouter             from "./routes/nft-sell/otc";
import nftSellBulkRouter            from "./routes/nft-sell/bulk";
import nftSellGiftsRouter           from "./routes/nft-sell/gifts";
import nftSellAirdropRouter         from "./routes/nft-sell/airdrop";
import nftSellUpgradeRouter         from "./routes/nft-sell/upgrade";
import nftSellUpgradeNFTRouter      from "./routes/nft-sell/upgrade-nft";
import nftSellSchedulerRouter       from "./routes/nft-sell/scheduler";
import nftSellRewardTokenRouter     from "./routes/nft-sell/reward-token";
import nftSellActivityLogRouter     from "./routes/nft-sell/activity-log";
import walletsRouter from "./routes/wallets";
import nftChainRouter from "./routes/nft-chain";
import nftsRouter from "./routes/nfts";
import wavesRouter from "./routes/waves";
import filebaseRouter from "./routes/filebase";
import { startEventListeners } from "./services/contract.service";
import { startWaveAutoTrigger } from "./services/wave-auto-trigger.service";
import pool from "./pool";
import { runPendingMigrations } from "./services/auto-migrate.service";
import { buildMerkleTree } from "./merkle";
import { errorHandler } from "./errorHandler";
import { logger } from "./logger";

const app = express();
const PORT = Number(process.env.PORT ?? 8000);

// Prevent unhandled promise rejections from crashing the process.
// IMPORTANT: never log the full error object â€” ethers.js attaches a `payload`
// field with the entire JSON-RPC request body. Serialising it synchronously to
// stderr blocks the Node.js event loop when hundreds of RPC timeouts fire during
// a blockchain resync, making Express unable to serve any HTTP request.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    const msg = reason.message ?? "";
    // Suppress ethers.js / free-RPC noise â€” caught by resync try/catch;
    // the unhandledRejection fires at the provider layer before our catch runs.
    if (
      msg.includes("request timed out") ||
      msg.includes("could not coalesce") ||
      msg.includes("eth_getLogs") ||
      msg.includes("underlying network changed")
    ) return;
  }
  logger.warn("[process] Unhandled rejection", reason);
});
process.on("uncaughtException", (err) => {
  logger.error("[process] Uncaught exception", err);
});

// â”€â”€ Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map(s => s.trim());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 500, standardHeaders: "draft-7", legacyHeaders: false }));

// â”€â”€ Swagger UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// swagger-ui-express uses express.static() which doesn't work on Vercel serverless
// (asset requests return HTML). Serve assets from CDN instead.

app.get("/api/docs.json", (req, res) => {
  const proto  = (req.headers["x-forwarded-proto"] as string) || "http";
  const host   = req.headers.host ?? `localhost:${PORT}`;
  const spec   = {
    ...(swaggerSpec as object),
    servers: [{ url: `${proto}://${host}`, description: "Current server" }],
  };
  res.setHeader("Content-Type", "application/json");
  res.send(spec);
});

app.get("/api/docs", (_req, res) => {
  const specUrl = "/api/docs.json";
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BearthApi â€” API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`);
});

// â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.use("/api/auth", authRouter);
app.use("/api/whitelist", whitelistRouter);
app.use("/api/proof", proofRouter);
// wavesRouter must be registered BEFORE the catch-all presaleRouter so that
// PUT /api/waves/:id enforcement (sequential rule, schedule lock) is applied first.
// GET /api/waves falls through wavesRouter (no GET handler) and is served by presaleRouter.
app.use("/api/waves",             wavesRouter);
app.use("/api", presaleRouter);
app.use("/api/admin/roles",       adminRolesRouter);
app.use("/api/admin/permissions", adminPermissionsRouter);
app.use("/api/admin/menus",       adminMenusRouter);
app.use("/api/admin/users",       adminUsersRouter);
app.use("/api/nft-chain",         nftChainRouter);
app.use("/api/nfts",              nftsRouter);
app.use("/api/nft-gen",           nftGenRouter);
app.use("/api/filebase",          filebaseRouter);
app.use("/api/opensea",           openSeaRouter);
app.use("/api/nft-sell/waves",       nftSellWavesRouter);
app.use("/api/nft-sell/royalty",     nftSellRoyaltyRouter);
app.use("/api/nft-sell/customers",   nftSellCustomersRouter);
app.use("/api/nft-sell/collection",  nftSellCollectionRouter);
app.use("/api/nft-sell/admin-sales", nftSellAdminSalesRouter);
app.use("/api/nft-sell/lookups",     nftSellLookupsRouter);
app.use("/api/nft-sell/staking",         nftSellStakingRouter);
app.use("/api/nft-sell/strategies",      nftSellStrategiesRouter);
app.use("/api/nft-sell/auctions",        nftSellAuctionsRouter);
app.use("/api/nft-sell/membership",      nftSellMembershipRouter);
app.use("/api/nft-sell/events",          nftSellEventsRouter);
app.use("/api/nft-sell/seasons",         nftSellSeasonsRouter);
app.use("/api/nft-sell/packs",           nftSellPacksRouter);
app.use("/api/nft-sell/burn",            nftSellBurnRouter);
app.use("/api/nft-sell/collaborations",  nftSellCollaborationsRouter);
app.use("/api/nft-sell/otc",             nftSellOtcRouter);
app.use("/api/nft-sell/bulk",            nftSellBulkRouter);
app.use("/api/nft-sell/gifts",           nftSellGiftsRouter);
app.use("/api/nft-sell/airdrop",         nftSellAirdropRouter);
app.use("/api/nft-sell/upgrade",         nftSellUpgradeRouter);
app.use("/api/nft-sell/upgrade-nft",    nftSellUpgradeNFTRouter);
app.use("/api/nft-sell/scheduler",       nftSellSchedulerRouter);
app.use("/api/nft-sell/reward-token",    nftSellRewardTokenRouter);
app.use("/api/nft-sell/activity-log",   nftSellActivityLogRouter);
app.use("/api/wallets",                  walletsRouter);
app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size, " +
      "ROUND(pg_database_size(current_database()) / 1024.0 / 1024.0, 1) AS db_size_mb"
    );
    res.json({ status: "ok", db_size: rows[0].db_size, db_size_mb: Number(rows[0].db_size_mb) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ status: "error", error: "Database unreachable", detail: msg });
  }
});

// â”€â”€ Error handler (must be last) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.use(errorHandler);

// â”€â”€ Local dev only: start persistent server + recalc merkle root â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// On Vercel (serverless) we just export the app â€” no listen(), no startup logic.

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

  // Auto-apply any pending DB patch files, then start the server
  (async () => {
    await runPendingMigrations().catch(e => {
      console.error("[migrate] FATAL: migration failed on startup:", e.message);
      process.exit(1);
    });

    app.listen(PORT, () => {
      console.log(`BearthApi listening on port ${PORT}`);
      recalcMerkleOnStartup().catch(e => console.warn("Startup Merkle recalc failed:", e));
      if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL) {
        // Delay 30 s so the auth pool is free for login requests on fresh startup
        // before the Sepolia event listeners begin polling.
        setTimeout(() => startEventListeners(), 30_000);
      }
      startWaveAutoTrigger();
    });
  })();
}

// Vercel uses this as the serverless function handler
export default app;

