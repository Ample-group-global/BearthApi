import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/activity-log
// Returns paginated nft_activity_log entries.
// Query params:
//   entity_type  — 'nft_record' | 'nft_wave' (optional)
//   entity_id    — UUID (optional)
//   action       — e.g. 'delivery_status_changed' (optional)
//   limit        — default 50, max 200
//   offset       — default 0
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const entityType = (req.query.entity_type as string) || null;
    const entityId   = (req.query.entity_id   as string) || null;
    const action     = (req.query.action       as string) || null;
    const limit      = Math.min(Number(req.query.limit  ?? 50),  200);
    const offset     = Math.max(Number(req.query.offset ?? 0),   0);

    const { rows } = await pool.query(
      `SELECT
         id, entity_type, entity_id, action,
         old_status, new_status, meta, created_at
       FROM nft_activity_log
       WHERE ($1::text IS NULL OR entity_type = $1)
         AND ($2::uuid IS NULL OR entity_id   = $2::uuid)
         AND ($3::text IS NULL OR action      = $3)
       ORDER BY created_at DESC
       LIMIT $4 OFFSET $5`,
      [entityType, entityId, action, limit, offset],
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total
       FROM nft_activity_log
       WHERE ($1::text IS NULL OR entity_type = $1)
         AND ($2::uuid IS NULL OR entity_id   = $2::uuid)
         AND ($3::text IS NULL OR action      = $3)`,
      [entityType, entityId, action],
    );

    res.json({
      logs:   rows,
      total:  Number(countRows[0]?.total ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
