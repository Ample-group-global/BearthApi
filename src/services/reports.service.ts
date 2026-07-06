import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function getReportsSummary() {
  const { rows } = await pool.query("SELECT reports_summary() AS data");
  return rows[0]?.data ?? {};
}

export async function getSalesByStage() {
  const { rows } = await pool.query(`
    SELECT
      s.id   AS stage_id,
      s.name AS stage_name,
      s.code AS stage_code,
      COUNT(nr.id)                                                     AS total,
      COUNT(CASE WHEN ds.code = 'delivered'  THEN 1 END)              AS delivered,
      COUNT(CASE WHEN ds.code = 'pending'    THEN 1 END)              AS pending,
      COUNT(CASE WHEN ds.code IN ('cancelled','canceled') THEN 1 END) AS cancelled
    FROM nft_stages s
    LEFT JOIN nft_records nr ON nr.stage_id = s.id
    LEFT JOIN delivery_statuses ds ON ds.id = nr.delivery_status_id
    WHERE s.is_active = true
    GROUP BY s.id, s.name, s.code, s.sort_order
    ORDER BY s.sort_order, s.name
  `);
  return toCamel(rows);
}

export async function getDeliveryReport(params: {
  statusCode?: string | null; limit?: number; offset?: number;
}) {
  const { statusCode = null, limit = 200, offset = 0 } = params;
  const { rows } = await pool.query(`
    SELECT
      nr.id, nr.serial_number,
      s.name  AS stage_name,
      t.name  AS type_name,
      ds.name AS delivery_status_name,
      ds.code AS delivery_status_code,
      nr.delivered_at, nr.notes, nr.created_at,
      COUNT(*) OVER() AS total_count
    FROM nft_records nr
    LEFT JOIN nft_stages         s  ON s.id  = nr.stage_id
    LEFT JOIN nft_types          t  ON t.id  = nr.nft_type_id
    LEFT JOIN delivery_statuses  ds ON ds.id = nr.delivery_status_id
    WHERE ($1::text IS NULL OR ds.code = $1)
    ORDER BY nr.created_at DESC
    LIMIT $2 OFFSET $3
  `, [statusCode, limit, offset]);
  return {
    records:    toCamel(rows),
    total:      Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function getReconciliationReport(params: {
  status?: string | null; limit?: number; offset?: number;
}) {
  const { status = null, limit = 200, offset = 0 } = params;
  const { rows } = await pool.query(`
    SELECT
      re.id, re.entry_type, re.amount_twd, re.amount_eth,
      re.status, re.notes, re.confirmed_at, re.cancelled_at, re.created_at,
      o.order_number,
      c.first_name || ' ' || c.last_name AS customer_name,
      c.email                             AS customer_email,
      pm.name AS payment_method,
      cur.code AS currency_code,
      COUNT(*) OVER() AS total_count
    FROM reconciliation_entries re
    LEFT JOIN orders o   ON o.id   = re.order_id
    LEFT JOIN users  c   ON c.id   = re.customer_id
    LEFT JOIN payment_methods pm  ON pm.id  = re.payment_method_id
    LEFT JOIN currencies      cur ON cur.id = re.currency_id
    WHERE ($1::text IS NULL OR re.status = $1)
    ORDER BY re.created_at DESC
    LIMIT $2 OFFSET $3
  `, [status, limit, offset]);
  return {
    entries: toCamel(rows),
    total:   Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function getCustomerReport(params: {
  search?: string | null; limit?: number; offset?: number;
}) {
  const { search = null, limit = 200, offset = 0 } = params;
  const searchParam = search ? `%${search}%` : null;
  const { rows } = await pool.query(`
    SELECT
      u.id, u.user_code,
      u.first_name, u.last_name, u.email, u.phone,
      u.created_at, u.is_active,
      COUNT(DISTINCT o.id)   AS order_count,
      COUNT(DISTINCT oni.id) AS nft_count,
      COUNT(*) OVER()        AS total_count
    FROM users u
    JOIN roles r ON r.id = u.role_id AND r.code = 'customer'
    LEFT JOIN orders          o   ON o.customer_id    = u.id
    LEFT JOIN order_nft_items oni ON oni.order_id      = o.id
    WHERE ($1::text IS NULL
      OR u.email      ILIKE $1
      OR u.first_name ILIKE $1
      OR u.last_name  ILIKE $1
      OR u.user_code  ILIKE $1)
    GROUP BY u.id, u.user_code, u.first_name, u.last_name,
             u.email, u.phone, u.created_at, u.is_active
    ORDER BY u.created_at DESC
    LIMIT $2 OFFSET $3
  `, [searchParam, limit, offset]);
  return {
    customers: toCamel(rows),
    total:     Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}
