import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/events — list all events
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_events_list()", []);
    res.json({ events: rows[0]?.nft_events_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/events — create event
// Body: { name, event_date, location?, wave_id?, max_attendees?, notes?, created_by? }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, event_date, location, wave_id, max_attendees, notes, created_by } =
      req.body as {
        name: string; event_date: string;
        location?: string; wave_id?: string;
        max_attendees?: number; notes?: string; created_by?: string;
      };

    if (!name || !event_date)
      return res.status(400).json({ error: "name and event_date required" });

    const { rows } = await pool.query("SELECT nft_event_upsert($1,$2,$3,$4,$5,$6,$7,$8)", [null, name, event_date, location ?? null, wave_id ?? null, max_attendees ?? null, notes ?? null, created_by ?? null]);
    res.status(201).json({ event: rows[0]?.nft_event_upsert });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/events/:id — update event
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { name, event_date, location, wave_id, max_attendees, notes, created_by } =
      req.body as Record<string, string | number | undefined>;

    const { rows } = await pool.query("SELECT nft_event_upsert($1,$2,$3,$4,$5,$6,$7,$8)", [req.params.id, name ?? null, event_date ?? null, location ?? null, wave_id ?? null, max_attendees ?? null, notes ?? null, created_by ?? null]);
    res.json({ event: rows[0]?.nft_event_upsert });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/events/:id — delete event
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM nft_events WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/events/:id/checkins — list check-ins for an event
router.get("/:id/checkins", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_event_checkins_list($1)", [req.params.id]);
    res.json({ checkins: rows[0]?.nft_event_checkins_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/events/:id/checkins — register a check-in
// Body: { wallet_address, customer_id?, registered_by?, notes? }
router.post("/:id/checkins", requireAdmin, async (req, res, next) => {
  try {
    const { wallet_address, customer_id, registered_by, notes } = req.body as {
      wallet_address: string; customer_id?: string;
      registered_by?: string; notes?: string;
    };

    if (!wallet_address)
      return res.status(400).json({ error: "wallet_address required" });

    const { rows } = await pool.query("SELECT nft_event_checkin_add($1,$2,$3,$4,$5)", [req.params.id, wallet_address.toLowerCase(), customer_id ?? null, registered_by ?? null, notes ?? null]);
    res.status(201).json({ checkin: rows[0]?.nft_event_checkin_add });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/events/:id/tag-batch — tag NFT records with this event
// Body: { nft_record_ids: string[] }
router.post("/:id/tag-batch", requireAdmin, async (req, res, next) => {
  try {
    const { nft_record_ids } = req.body as { nft_record_ids: string[] };
    if (!nft_record_ids?.length)
      return res.status(400).json({ error: "nft_record_ids array required" });

    const { rowCount } = await pool.query("UPDATE nft_records SET event_id=$1 WHERE id=ANY($2::uuid[])", [req.params.id, nft_record_ids]);
    res.json({ ok: true, tagged: rowCount });
  } catch (err) {
    next(err);
  }
});

export default router;
