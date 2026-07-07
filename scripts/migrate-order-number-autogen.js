const { Pool } = require("pg");
require("dotenv").config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create a global sequence for order numbers (starts after existing max if any)
    await client.query(`
      DO $$
      DECLARE v_max INT;
      BEGIN
        SELECT COALESCE(MAX(
          CASE WHEN order_number ~ '^ORD-[0-9]{4}-[0-9]+$'
               THEN CAST(SPLIT_PART(order_number, '-', 3) AS INT)
               ELSE 0
          END
        ), 0) + 1
        INTO v_max FROM orders;

        IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'order_number_seq') THEN
          EXECUTE 'CREATE SEQUENCE order_number_seq START ' || v_max;
          RAISE NOTICE 'Created order_number_seq starting at %', v_max;
        ELSE
          RAISE NOTICE 'order_number_seq already exists';
        END IF;
      END $$
    `);
    console.log("1. order_number_seq created (or already exists)");

    // Recreate orders_create with auto-generation
    await client.query(`DROP FUNCTION IF EXISTS orders_create(varchar,uuid,uuid,date,text,text,uuid,numeric,numeric,uuid,uuid,uuid,numeric,numeric,uuid,uuid,json,json)`);
    await client.query(`
      CREATE FUNCTION public.orders_create(
        p_order_number        character varying DEFAULT NULL,
        p_customer_id         uuid             DEFAULT NULL,
        p_referrer_id         uuid             DEFAULT NULL,
        p_purchase_date       date             DEFAULT CURRENT_DATE,
        p_payment_notes       text             DEFAULT NULL,
        p_notes               text             DEFAULT NULL,
        p_nft_payment_method_id  uuid          DEFAULT NULL,
        p_nft_amount_twd      numeric          DEFAULT NULL,
        p_nft_amount_eth      numeric          DEFAULT NULL,
        p_nft_currency_id     uuid             DEFAULT NULL,
        p_nft_payment_status_id  uuid          DEFAULT NULL,
        p_merch_payment_method_id uuid         DEFAULT NULL,
        p_merch_amount_twd    numeric          DEFAULT NULL,
        p_merch_amount_eth    numeric          DEFAULT NULL,
        p_merch_currency_id   uuid             DEFAULT NULL,
        p_merch_payment_status_id uuid         DEFAULT NULL,
        p_nft_items           json             DEFAULT '[]',
        p_product_items       json             DEFAULT '[]'
      )
      RETURNS TABLE(id uuid, order_number character varying, customer_id uuid, purchase_date date, created_at timestamp with time zone)
      LANGUAGE plpgsql AS $$
      DECLARE
        v_order_id    UUID;
        v_item        JSON;
        v_order_num   VARCHAR;
      BEGIN
        -- Auto-generate order number if not supplied
        IF p_order_number IS NULL OR trim(p_order_number) = '' THEN
          v_order_num := 'ORD-' || to_char(CURRENT_DATE, 'YYYY') || '-'
                         || LPAD(NEXTVAL('order_number_seq')::TEXT, 4, '0');
        ELSE
          v_order_num := upper(trim(p_order_number));
        END IF;

        IF p_customer_id IS NULL THEN
          RAISE EXCEPTION 'Customer is required' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM users WHERE users.id = p_customer_id) THEN
          RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
        END IF;
        IF EXISTS (SELECT 1 FROM orders WHERE orders.order_number = v_order_num) THEN
          RAISE EXCEPTION 'Order number already exists' USING ERRCODE = '23505';
        END IF;

        INSERT INTO orders (
          order_number, customer_id, referrer_id, purchase_date, payment_notes, notes,
          nft_payment_method_id, nft_amount_twd, nft_amount_eth, nft_currency_id, nft_payment_status_id,
          merch_payment_method_id, merch_amount_twd, merch_amount_eth, merch_currency_id, merch_payment_status_id
        ) VALUES (
          v_order_num, p_customer_id, p_referrer_id,
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
    console.log("2. orders_create updated — order_number is now auto-generated if not supplied");

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
