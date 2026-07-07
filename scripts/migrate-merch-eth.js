const { Pool } = require("pg");
require("dotenv").config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS merch_amount_eth NUMERIC(18,8)");
    console.log("1. merch_amount_eth column added");

    await client.query(`DROP FUNCTION IF EXISTS orders_update(uuid,uuid,uuid,date,text,text,uuid,numeric,numeric,uuid,uuid,uuid,numeric,uuid,uuid)`);
    await client.query(`
      CREATE FUNCTION public.orders_update(
        p_id uuid,
        p_customer_id uuid DEFAULT NULL,
        p_referrer_id uuid DEFAULT NULL,
        p_purchase_date date DEFAULT NULL,
        p_payment_notes text DEFAULT NULL,
        p_notes text DEFAULT NULL,
        p_nft_payment_method_id uuid DEFAULT NULL,
        p_nft_amount_twd numeric DEFAULT NULL,
        p_nft_amount_eth numeric DEFAULT NULL,
        p_nft_currency_id uuid DEFAULT NULL,
        p_nft_payment_status_id uuid DEFAULT NULL,
        p_merch_payment_method_id uuid DEFAULT NULL,
        p_merch_amount_twd numeric DEFAULT NULL,
        p_merch_amount_eth numeric DEFAULT NULL,
        p_merch_currency_id uuid DEFAULT NULL,
        p_merch_payment_status_id uuid DEFAULT NULL
      )
      RETURNS TABLE(id uuid, order_number character varying, customer_id uuid, purchase_date date, updated_at timestamp with time zone)
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM orders WHERE orders.id = p_id) THEN
          RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
        END IF;
        RETURN QUERY
        UPDATE orders SET
          customer_id             = COALESCE(p_customer_id,            orders.customer_id),
          referrer_id             = COALESCE(p_referrer_id,            orders.referrer_id),
          purchase_date           = COALESCE(p_purchase_date,          orders.purchase_date),
          payment_notes           = COALESCE(p_payment_notes,          orders.payment_notes),
          notes                   = COALESCE(p_notes,                  orders.notes),
          nft_payment_method_id   = COALESCE(p_nft_payment_method_id,  orders.nft_payment_method_id),
          nft_amount_twd          = COALESCE(p_nft_amount_twd,         orders.nft_amount_twd),
          nft_amount_eth          = COALESCE(p_nft_amount_eth,         orders.nft_amount_eth),
          nft_currency_id         = COALESCE(p_nft_currency_id,        orders.nft_currency_id),
          nft_payment_status_id   = COALESCE(p_nft_payment_status_id,  orders.nft_payment_status_id),
          merch_payment_method_id = COALESCE(p_merch_payment_method_id,orders.merch_payment_method_id),
          merch_amount_twd        = COALESCE(p_merch_amount_twd,       orders.merch_amount_twd),
          merch_amount_eth        = COALESCE(p_merch_amount_eth,       orders.merch_amount_eth),
          merch_currency_id       = COALESCE(p_merch_currency_id,      orders.merch_currency_id),
          merch_payment_status_id = COALESCE(p_merch_payment_status_id,orders.merch_payment_status_id),
          updated_at              = NOW()
        WHERE orders.id = p_id
        RETURNING orders.id, orders.order_number, orders.customer_id, orders.purchase_date, orders.updated_at;
      END;
      $$
    `);
    console.log("2. orders_update recreated with merch_amount_eth");

    await client.query(`DROP FUNCTION IF EXISTS orders_create(varchar,uuid,uuid,date,text,text,uuid,numeric,numeric,uuid,uuid,uuid,numeric,uuid,uuid,json,json)`);
    await client.query(`
      CREATE FUNCTION public.orders_create(
        p_order_number character varying,
        p_customer_id uuid,
        p_referrer_id uuid DEFAULT NULL,
        p_purchase_date date DEFAULT CURRENT_DATE,
        p_payment_notes text DEFAULT NULL,
        p_notes text DEFAULT NULL,
        p_nft_payment_method_id uuid DEFAULT NULL,
        p_nft_amount_twd numeric DEFAULT NULL,
        p_nft_amount_eth numeric DEFAULT NULL,
        p_nft_currency_id uuid DEFAULT NULL,
        p_nft_payment_status_id uuid DEFAULT NULL,
        p_merch_payment_method_id uuid DEFAULT NULL,
        p_merch_amount_twd numeric DEFAULT NULL,
        p_merch_amount_eth numeric DEFAULT NULL,
        p_merch_currency_id uuid DEFAULT NULL,
        p_merch_payment_status_id uuid DEFAULT NULL,
        p_nft_items json DEFAULT '[]',
        p_product_items json DEFAULT '[]'
      )
      RETURNS TABLE(id uuid, order_number character varying, customer_id uuid, purchase_date date, created_at timestamp with time zone)
      LANGUAGE plpgsql AS $$
      DECLARE
        v_order_id UUID;
        v_item JSON;
      BEGIN
        IF p_order_number IS NULL OR trim(p_order_number) = '' THEN
          RAISE EXCEPTION 'Order number is required' USING ERRCODE = 'P0001';
        END IF;
        IF p_customer_id IS NULL THEN
          RAISE EXCEPTION 'Customer is required' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM users WHERE users.id = p_customer_id) THEN
          RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
        END IF;
        IF EXISTS (SELECT 1 FROM orders WHERE orders.order_number = upper(trim(p_order_number))) THEN
          RAISE EXCEPTION 'Order number already exists' USING ERRCODE = '23505';
        END IF;
        INSERT INTO orders (
          order_number, customer_id, referrer_id, purchase_date, payment_notes, notes,
          nft_payment_method_id, nft_amount_twd, nft_amount_eth, nft_currency_id, nft_payment_status_id,
          merch_payment_method_id, merch_amount_twd, merch_amount_eth, merch_currency_id, merch_payment_status_id
        ) VALUES (
          upper(trim(p_order_number)), p_customer_id, p_referrer_id,
          COALESCE(p_purchase_date, CURRENT_DATE), p_payment_notes, p_notes,
          p_nft_payment_method_id, p_nft_amount_twd, p_nft_amount_eth,
          p_nft_currency_id, p_nft_payment_status_id,
          p_merch_payment_method_id, p_merch_amount_twd, p_merch_amount_eth,
          p_merch_currency_id, p_merch_payment_status_id
        ) RETURNING orders.id INTO v_order_id;
        IF p_nft_items IS NOT NULL AND json_array_length(p_nft_items) > 0 THEN
          FOR v_item IN SELECT * FROM json_array_elements(p_nft_items) LOOP
            INSERT INTO order_nft_items (order_id, nft_record_id, wallet_address, unit_price_twd, unit_price_eth, currency_id, notes)
            VALUES (v_order_id, (v_item->>'nftRecordId')::UUID, NULLIF(v_item->>'walletAddress',''),
              NULLIF(v_item->>'unitPriceTwd','')::NUMERIC, NULLIF(v_item->>'unitPriceEth','')::NUMERIC,
              NULLIF(v_item->>'currencyId','')::UUID, NULLIF(v_item->>'notes',''));
          END LOOP;
        END IF;
        IF p_product_items IS NOT NULL AND json_array_length(p_product_items) > 0 THEN
          FOR v_item IN SELECT * FROM json_array_elements(p_product_items) LOOP
            INSERT INTO order_product_items (order_id, product_id, quantity, unit_price, notes)
            VALUES (v_order_id, (v_item->>'productId')::UUID,
              COALESCE((v_item->>'quantity')::INT,1),
              (v_item->>'unitPrice')::NUMERIC, NULLIF(v_item->>'notes',''));
          END LOOP;
        END IF;
        INSERT INTO order_operation_logs (order_id, action, description)
        VALUES (v_order_id, 'created', 'Order created');
        RETURN QUERY SELECT o.id, o.order_number, o.customer_id, o.purchase_date, o.created_at
                     FROM orders o WHERE o.id = v_order_id;
      END;
      $$
    `);
    console.log("3. orders_create recreated with merch_amount_eth");

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
