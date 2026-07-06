import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { PoolClient } from "pg";
import pool from "../pool";
import { buildMerkleTree, getProof } from "../merkle";
import { verifySessionCookie } from "../walletAuth";
import { HttpError } from "../errors";

const router = Router();
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MERKLE_ROOT_RE = /^0x[a-fA-F0-9]{64}$/;
const ADMIN_ADDRESS = (process.env.ADMIN_ADDRESS ?? "").toLowerCase();

const readLimit   = rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: "draft-7", legacyHeaders: false });
const writeLimit  = rateLimit({ windowMs: 60_000, limit: 10,  standardHeaders: "draft-7", legacyHeaders: false });
const deleteLimit = rateLimit({ windowMs: 60_000, limit: 5,   standardHeaders: "draft-7", legacyHeaders: false });

function requireAdmin(req: Request): void {
  const addr = verifySessionCookie(req.headers.cookie);
  if (!addr) throw new HttpError(401, "Unauthorized");
  if (addr.toLowerCase() !== ADMIN_ADDRESS) throw new HttpError(403, "Forbidden");
}

async function recalcMerkle(client: PoolClient): Promise<string> {
  const { rows: [state] } = await client.query("SELECT * FROM whitelist_state_get()");
  if (state?.manual_override) return state.merkle_root as string;
  const { rows: addrRows } = await client.query("SELECT * FROM whitelist_addresses_all()");
  const addresses = addrRows.map((r: { address: string }) => r.address);
  const root = addresses.length ? buildMerkleTree(addresses).root : "0x0";
  await client.query("SELECT whitelist_state_update_root($1)", [root]);
  return root;
}

async function bulkWrite(res: Response, next: NextFunction, addresses: string[], action: "add" | "replace") {
  if (!Array.isArray(addresses) || !addresses.length) {
    res.status(422).json({ detail: "addresses must be non-empty" }); return;
  }
  if (addresses.length > 1000) {
    res.status(422).json({ detail: "maximum 1000 addresses per request" }); return;
  }
  const invalid = addresses.filter(a => !ETH_ADDRESS_RE.test(a));
  if (invalid.length) {
    res.status(422).json({ detail: `invalid addresses: ${invalid.join(", ")}` }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (action === "replace") await client.query("SELECT whitelist_clear()");
    const { rows: existingRows } = await client.query("SELECT * FROM whitelist_existing_lowers()");
    const existingSet = new Set(existingRows.map((r: { address_lower: string }) => r.address_lower));
    const toAdd = addresses.filter(a => !existingSet.has(a.toLowerCase()));
    for (const addr of toAdd) {
      await client.query("SELECT whitelist_add($1, $2)", [addr, addr.toLowerCase()]);
    }
    const root = await recalcMerkle(client);
    await client.query("COMMIT");
    const { rows: [{ count }] } = await client.query("SELECT whitelist_count() AS count");
    const skipped = addresses.length - toAdd.length;
    res.json({ success: true, count: Number(count), added: toAdd.length, skipped, duplicates: skipped, merkle_root: root });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
}

// ── Specific paths first (before /:address) ──────────────────────────────────

// GET /api/whitelist/entries — admin-only, includes name + added_at
router.get("/entries", readLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const limit  = Math.min(Number(req.query.limit  ?? 100), 1000);
    const offset = Number(req.query.offset ?? 0);
    const [entriesRes, countRes, stateRes] = await Promise.all([
      pool.query("SELECT * FROM whitelist_entries($1, $2)", [limit, offset]),
      pool.query("SELECT whitelist_count() AS count"),
      pool.query("SELECT * FROM whitelist_state_get()"),
    ]);
    const total = Number(countRes.rows[0].count);
    const state = stateRes.rows[0];
    res.json({
      entries: entriesRes.rows.map((r: { id: string; address: string; user_id: string | null; is_whitelisted: boolean; added_at: Date | null }) => ({
        id: r.id,
        address: r.address,
        user_id: r.user_id ?? null,
        is_whitelisted: r.is_whitelisted,
        added_at: r.added_at?.toISOString() ?? null,
      })),
      total, limit, offset,
      has_more: offset + limit < total,
      metadata: {
        merkle_root: state?.merkle_root ?? "0x0",
        last_updated: state?.last_updated?.toISOString() ?? "",
        timestamp: Date.now(),
        manual_override: Boolean(state?.manual_override),
      },
    });
  } catch (e) { next(e); }
});

// GET /api/whitelist/export — public
router.get("/export", readLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const format           = (req.query.format as string) ?? "json";
    const includeMerkleRoot = req.query.include_merkle_root !== "false";
    const [addrRes, stateRes] = await Promise.all([
      pool.query("SELECT * FROM whitelist_addresses_all()"),
      pool.query("SELECT * FROM whitelist_state_get()"),
    ]);
    const addresses = addrRes.rows.map((r: { address: string }) => r.address);
    const state = stateRes.rows[0];
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="whitelist-${dateStr}.csv"`);
      res.send("address\n" + addresses.join("\n"));
    } else if (format === "txt") {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="whitelist-${dateStr}.txt"`);
      res.send(addresses.join("\n"));
    } else {
      const output: Record<string, unknown> = { whitelist: addresses };
      if (includeMerkleRoot) {
        output.metadata = {
          total: addresses.length,
          merkle_root: state?.merkle_root ?? null,
          exported_at: new Date().toISOString(),
        };
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="whitelist-${dateStr}.json"`);
      res.send(JSON.stringify(output, null, 2));
    }
  } catch (e) { next(e); }
});

// GET /api/whitelist/merkle-root — public
router.get("/merkle-root", readLimit, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [stateRes, countRes] = await Promise.all([
      pool.query("SELECT * FROM whitelist_state_get()"),
      pool.query("SELECT whitelist_count() AS count"),
    ]);
    const state = stateRes.rows[0];
    res.json({
      root: state?.merkle_root ?? "0x0",
      count: Number(countRes.rows[0].count),
      generated_at: state?.last_updated?.toISOString() ?? "",
      manual_override: Boolean(state?.manual_override),
    });
  } catch (e) { next(e); }
});

// PUT /api/whitelist/merkle-root — admin-only, sets manual override
router.put("/merkle-root", writeLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { root } = (req.body ?? {}) as { root?: string };
    if (!root || !MERKLE_ROOT_RE.test(root)) {
      res.status(422).json({ detail: "root must be a 0x-prefixed 32-byte hex string" }); return;
    }
    await pool.query("SELECT whitelist_state_set_override($1)", [root]);
    const [stateRes, countRes] = await Promise.all([
      pool.query("SELECT * FROM whitelist_state_get()"),
      pool.query("SELECT whitelist_count() AS count"),
    ]);
    const state = stateRes.rows[0];
    res.json({
      root: state.merkle_root,
      count: Number(countRes.rows[0].count),
      generated_at: state.last_updated?.toISOString() ?? "",
      manual_override: true,
    });
  } catch (e) { next(e); }
});

// DELETE /api/whitelist/merkle-root — admin-only, clears manual override
router.delete("/merkle-root", writeLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
  } catch (e) { next(e); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT whitelist_state_clear_override()");
    const root = await recalcMerkle(client);
    await client.query("COMMIT");
    const [stateRes, countRes] = await Promise.all([
      pool.query("SELECT * FROM whitelist_state_get()"),
      pool.query("SELECT whitelist_count() AS count"),
    ]);
    const state = stateRes.rows[0];
    res.json({
      root,
      count: Number(countRes.rows[0].count),
      generated_at: state?.last_updated?.toISOString() ?? "",
      manual_override: false,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

// POST /api/whitelist/add — add (no replace)
router.post("/add", writeLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
  } catch (e) { next(e); return; }
  const { addresses } = (req.body ?? {}) as { addresses?: string[] };
  await bulkWrite(res, next, addresses ?? [], "add");
});

// POST /api/whitelist/entry — add single entry with optional user_id / is_whitelisted
router.post("/entry", writeLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { address, user_id, is_whitelisted } = (req.body ?? {}) as {
      address?: string;
      user_id?: string | null;
      is_whitelisted?: boolean;
    };
    if (!address || !ETH_ADDRESS_RE.test(address)) {
      res.status(422).json({ detail: "invalid address" }); return;
    }
    const whitelisted = is_whitelisted !== false; // default true
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [existing] } = await client.query(
        "SELECT * FROM whitelist_entry_get($1)",
        [address.toLowerCase()]
      );
      let added   = 0;
      let skipped = 0;
      if (!existing) {
        await client.query(
          "SELECT whitelist_add($1, $2, $3, $4)",
          [address, address.toLowerCase(), user_id ?? null, whitelisted]
        );
        added = 1;
      } else {
        skipped = 1;
      }
      const root = await recalcMerkle(client);
      await client.query("COMMIT");
      const { rows: [{ count }] } = await client.query("SELECT whitelist_count() AS count");
      res.json({ success: true, count: Number(count), added, skipped, duplicates: skipped, merkle_root: root });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// POST /api/whitelist/test — public, test if address is whitelisted
router.post("/test", writeLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = (req.body ?? {}) as { address?: string };
    if (!address || !ETH_ADDRESS_RE.test(address)) {
      res.status(400).json({ detail: "Invalid address format" }); return;
    }
    const { rows } = await pool.query("SELECT * FROM whitelist_addresses_all()");
    const addresses = rows.map((r: { address: string }) => r.address);
    if (!addresses.length) {
      res.json({ is_whitelisted: false, address, proof: [], root: "0x0", leaf_index: null, generated_at: new Date().toISOString() });
      return;
    }
    const tree     = buildMerkleTree(addresses);
    const lower    = address.toLowerCase();
    const lowerList = addresses.map((a: string) => a.toLowerCase());
    const leafIndex = lowerList.indexOf(lower);
    const isWhitelisted = leafIndex !== -1;
    const proof = isWhitelisted ? getProof(tree, address) : [];
    res.json({ is_whitelisted: isWhitelisted, address, proof, root: tree.root, leaf_index: isWhitelisted ? leafIndex : null, generated_at: new Date().toISOString() });
  } catch (e) { next(e); }
});

// DELETE /api/whitelist/:address — admin-only
router.delete("/:address", deleteLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
  } catch (e) { next(e); return; }
  const { address } = req.params;
  if (!ETH_ADDRESS_RE.test(address)) {
    res.status(400).json({ detail: "Invalid address format" }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // whitelist_remove throws P0002 if not found — errorHandler maps it to 404
    await client.query("SELECT whitelist_remove($1)", [address.toLowerCase()]);
    const root = await recalcMerkle(client);
    await client.query("COMMIT");
    const { rows: [{ count }] } = await client.query("SELECT whitelist_count() AS count");
    res.json({ success: true, count: Number(count), removed: address, merkle_root: root });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

// ── Root routes ───────────────────────────────────────────────────────────────

// GET /api/whitelist
router.get("/", readLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const limit  = Math.min(Number(req.query.limit  ?? 100), 1000);
    const offset = Number(req.query.offset ?? 0);
    const [countRes, addrRes, stateRes] = await Promise.all([
      pool.query("SELECT whitelist_count() AS count"),
      pool.query("SELECT * FROM whitelist_list($1, $2)", [limit, offset]),
      pool.query("SELECT * FROM whitelist_state_get()"),
    ]);
    const total = Number(countRes.rows[0].count);
    const state = stateRes.rows[0];
    res.json({
      addresses: addrRes.rows.map((r: { address: string }) => r.address),
      total, limit, offset,
      has_more: offset + limit < total,
      metadata: {
        merkle_root: state?.merkle_root ?? "0x0",
        last_updated: state?.last_updated?.toISOString() ?? "",
        timestamp: Date.now(),
        manual_override: Boolean(state?.manual_override),
      },
    });
  } catch (e) { next(e); }
});

// POST /api/whitelist — bulk write (add or replace)
router.post("/", writeLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
  } catch (e) { next(e); return; }
  const { addresses, action = "add" } = (req.body ?? {}) as { addresses?: string[]; action?: string };
  await bulkWrite(res, next, addresses ?? [], (action === "replace" ? "replace" : "add"));
});

export default router;

export { recalcMerkle };
