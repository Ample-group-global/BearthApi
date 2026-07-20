import pool from "../pool";
import { toCamel } from "../utils/camel";

export async function getReportsSummary() {
  const { rows } = await pool.query("SELECT reports_summary() AS data");
  return rows[0]?.data ?? {};
}

export async function getSalesByStage() {
  const { rows } = await pool.query(`
    SELECT
      s.id    AS stage_id,
      s.label AS stage_name,
      s.code  AS stage_code,
      COUNT(nr.id)                                                                  AS total,
      COUNT(CASE WHEN nr.delivery_status_code = 'delivered'                THEN 1 END) AS delivered,
      COUNT(CASE WHEN nr.delivery_status_code = 'pending'                  THEN 1 END) AS pending,
      COUNT(CASE WHEN nr.delivery_status_code IN ('cancelled','canceled')  THEN 1 END) AS cancelled
    FROM lookup_values s
    LEFT JOIN v_nft_records nr ON nr.stage_id = s.id
    WHERE s.category = 'nft_stage' AND s.is_active = true
    GROUP BY s.id, s.label, s.code, s.sort_order
    ORDER BY s.sort_order, s.label
  `);
  return toCamel(rows);
}

const DELIVERY_SORT_COLS: Record<string, string> = {
  serial_number:   "nr.serial_number",
  stage:           "nr.stage_name",
  type:            "nr.type_name",
  delivery_status: "nr.delivery_status_code",
  delivered_at:    "nr.delivered_at",
  created_at:      "nr.created_at",
};

export async function getDeliveryReport(params: {
  statusCode?: string | null; limit?: number; offset?: number;
  sortBy?: string | null; sortDir?: "asc" | "desc" | null;
}) {
  const { statusCode = null, limit = 20, offset = 0, sortBy = null, sortDir = null } = params;
  const sortCol = sortBy && DELIVERY_SORT_COLS[sortBy] ? DELIVERY_SORT_COLS[sortBy] : null;
  const dir     = sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = sortCol ? `${sortCol} ${dir} NULLS LAST` : "nr.created_at DESC";
  const { rows } = await pool.query(`
    SELECT
      nr.id, nr.serial_number,
      nr.stage_name,
      nr.type_name,
      nr.delivery_status_name,
      nr.delivery_status_code,
      nr.delivered_at, nr.notes, nr.created_at,
      COUNT(*) OVER() AS total_count
    FROM v_nft_records nr
    WHERE ($1::text IS NULL OR nr.delivery_status_code = $1)
    ORDER BY ${orderBy}
    LIMIT $2 OFFSET $3
  `, [statusCode, limit, offset]);
  return {
    records:    toCamel(rows),
    total:      Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

const RECON_SORT_COLS: Record<string, string> = {
  order:        "o.order_number",
  customer:     "c.first_name",
  entry_type:   "re.entry_type",
  amount_twd:   "re.amount_twd",
  status:       "re.status",
  confirmed_at: "re.confirmed_at",
  created_at:   "re.created_at",
};

export async function getReconciliationReport(params: {
  status?: string | null; limit?: number; offset?: number;
  sortBy?: string | null; sortDir?: "asc" | "desc" | null;
}) {
  const { status = null, limit = 20, offset = 0, sortBy = null, sortDir = null } = params;
  const sortCol = sortBy && RECON_SORT_COLS[sortBy] ? RECON_SORT_COLS[sortBy] : null;
  const dir     = sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = sortCol ? `${sortCol} ${dir} NULLS LAST` : "re.created_at DESC";
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
    ORDER BY ${orderBy}
    LIMIT $2 OFFSET $3
  `, [status, limit, offset]);
  return {
    entries: toCamel(rows),
    total:   Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

const CUSTOMER_SORT_COLS: Record<string, string> = {
  user_code:  "u.user_code",
  name:       "u.first_name",
  email:      "u.email",
  orders:    "COUNT(DISTINCT o.id)",
  nfts:      "COUNT(DISTINCT oni.id)",
  products:  "COUNT(DISTINCT opi.id)",
  is_active: "u.is_active",
  created_at:"u.created_at",
};

export async function getCustomerReport(params: {
  search?: string | null; limit?: number; offset?: number;
  sortBy?: string | null; sortDir?: "asc" | "desc" | null;
}) {
  const { search = null, limit = 20, offset = 0, sortBy = null, sortDir = null } = params;
  const searchParam = search ? `%${search}%` : null;
  const sortCol = sortBy && CUSTOMER_SORT_COLS[sortBy] ? CUSTOMER_SORT_COLS[sortBy] : null;
  const dir     = sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = sortCol ? `${sortCol} ${dir} NULLS LAST` : "u.created_at DESC";
  const { rows } = await pool.query(`
    SELECT
      u.id, u.user_code,
      u.first_name, u.last_name, u.email, u.phone,
      u.created_at, u.is_active,
      COUNT(DISTINCT o.id)   AS order_count,
      COUNT(DISTINCT oni.id) AS nft_count,
      COUNT(DISTINCT opi.id) AS product_count,
      COUNT(*) OVER()        AS total_count
    FROM users u
    JOIN roles r ON r.id = u.role_id AND r.code = 'customer'
    LEFT JOIN orders              o   ON o.customer_id = u.id
    LEFT JOIN order_nft_items     oni ON oni.order_id  = o.id
    LEFT JOIN order_product_items opi ON opi.order_id  = o.id
    WHERE ($1::text IS NULL
      OR u.email      ILIKE $1
      OR u.first_name ILIKE $1
      OR u.last_name  ILIKE $1
      OR u.user_code  ILIKE $1)
    GROUP BY u.id, u.user_code, u.first_name, u.last_name,
             u.email, u.phone, u.created_at, u.is_active
    ORDER BY ${orderBy}
    LIMIT $2 OFFSET $3
  `, [searchParam, limit, offset]);
  return {
    customers: toCamel(rows),
    total:     Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}
