const { Pool } = require("pg");
require("dotenv").config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE OR REPLACE FUNCTION reports_summary()
      RETURNS json
      LANGUAGE plpgsql AS $$
      DECLARE v_result JSON;
      BEGIN
        SELECT json_build_object(
          'orders', json_build_object(
            'total',            (SELECT COUNT(*) FROM orders),
            'nftOrderCount',    (SELECT COUNT(*) FROM orders WHERE (nft_amount_twd > 0 OR nft_amount_eth > 0)),
            'productOrderCount',(SELECT COUNT(*) FROM orders WHERE (merch_amount_twd > 0 OR merch_amount_eth > 0)),
            'bothOrderCount',   (SELECT COUNT(*) FROM orders
                                 WHERE (nft_amount_twd > 0 OR nft_amount_eth > 0)
                                   AND (merch_amount_twd > 0 OR merch_amount_eth > 0)),
            'totalNftTwd',      (SELECT COALESCE(SUM(nft_amount_twd),   0) FROM orders),
            'totalNftEth',      (SELECT COALESCE(SUM(nft_amount_eth),   0) FROM orders),
            'totalMerchTwd',    (SELECT COALESCE(SUM(merch_amount_twd), 0) FROM orders),
            'byNftStatus', (
              SELECT COALESCE(json_agg(row_to_json(t)), '[]')
              FROM (SELECT ps.code AS "statusCode", ps.name AS "statusName", COUNT(o.id) AS "count"
                    FROM orders o
                    JOIN payment_statuses ps ON o.nft_payment_status_id = ps.id
                    WHERE o.nft_amount_twd > 0 OR o.nft_amount_eth > 0
                    GROUP BY ps.code, ps.name ORDER BY COUNT(o.id) DESC) t),
            'byMerchStatus', (
              SELECT COALESCE(json_agg(row_to_json(t)), '[]')
              FROM (SELECT ps.code AS "statusCode", ps.name AS "statusName", COUNT(o.id) AS "count"
                    FROM orders o
                    JOIN payment_statuses ps ON o.merch_payment_status_id = ps.id
                    WHERE o.merch_amount_twd > 0 OR o.merch_amount_eth > 0
                    GROUP BY ps.code, ps.name ORDER BY COUNT(o.id) DESC) t)
          ),
          'customers', json_build_object(
            'total',      (SELECT COUNT(*) FROM users WHERE is_active = TRUE AND role_id = (SELECT id FROM roles WHERE code = 'customer')),
            'withOrders', (SELECT COUNT(DISTINCT customer_id) FROM orders)
          ),
          'nft', json_build_object(
            'total',        (SELECT COUNT(*) FROM nft_records),
            'orderedCount', (SELECT COUNT(DISTINCT nft_record_id) FROM order_nft_items),
            'byDeliveryStatus', (
              SELECT COALESCE(json_agg(row_to_json(t)), '[]')
              FROM (SELECT ds.code AS "statusCode", ds.name AS "statusName", COUNT(nr.id) AS "count"
                    FROM nft_records nr
                    LEFT JOIN delivery_statuses ds ON nr.delivery_status_id = ds.id
                    GROUP BY ds.code, ds.name ORDER BY COUNT(nr.id) DESC) t)
          ),
          'products', json_build_object(
            'total',        (SELECT COUNT(*) FROM products),
            'active',       (SELECT COUNT(*) FROM products p
                             LEFT JOIN product_statuses ps ON p.status_id = ps.id
                             WHERE ps.code = 'active'),
            'orderedCount', (SELECT COUNT(DISTINCT product_id) FROM order_product_items)
          ),
          'reconciliation', json_build_object(
            'byStatus', (
              SELECT COALESCE(json_agg(row_to_json(t)), '[]')
              FROM (SELECT status,
                           COUNT(*)                    AS "count",
                           COALESCE(SUM(amount_twd),0) AS "totalTwd",
                           COALESCE(SUM(amount_eth),0) AS "totalEth"
                    FROM reconciliation_entries
                    GROUP BY status) t)
          )
        ) INTO v_result;
        RETURN v_result;
      END;
      $$
    `);
    console.log("1. reports_summary() updated with nftOrderCount, productOrderCount, bothOrderCount, byMerchStatus, orderedCount fields");

    await client.query("COMMIT");
    console.log("All DB changes committed OK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
