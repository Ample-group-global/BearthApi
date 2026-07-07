-- =====================================================================
-- BearthApi — Migration V5: Inventory Management & Order Fulfillment
-- 7 new tables + 13 functions + seeds
-- Apply to: BearthDev first, then Bearth (production)
-- Run: psql <connection_url> -f migrate_v5_inventory.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION
-- =====================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 1: TABLES
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. product_images ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT          NOT NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  is_primary  BOOLEAN       NOT NULL DEFAULT FALSE,
  caption     VARCHAR(300),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- ── 2. product_attributes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_attributes (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attr_key    VARCHAR(100)  NOT NULL,
  attr_label  VARCHAR(200)  NOT NULL,
  attr_value  TEXT          NOT NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_attributes_product_id ON product_attributes(product_id);

-- ── 3. category_attribute_templates ───────────────────────────────────
CREATE TABLE IF NOT EXISTS category_attribute_templates (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code VARCHAR(100),
  attr_key     VARCHAR(100),
  attr_label   VARCHAR(200),
  attr_type    VARCHAR(50)   NOT NULL DEFAULT 'text'
                 CHECK (attr_type IN ('text','select','multiselect','number','boolean')),
  attr_options TEXT,
  placeholder  VARCHAR(200),
  is_required  BOOLEAN       NOT NULL DEFAULT FALSE,
  sort_order   INT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cat_attr_tpl_category_code ON category_attribute_templates(category_code);

-- ── 4. purchase_orders ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number     VARCHAR(50)   UNIQUE NOT NULL,
  supplier      VARCHAR(300),
  status        VARCHAR(50)   NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','partial','received','cancelled')),
  notes         TEXT,
  expected_date DATE,
  received_at   TIMESTAMPTZ,
  total_cost    NUMERIC(18,2),
  created_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status     ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON purchase_orders(created_by);

-- ── 5. purchase_order_items ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id    UUID          REFERENCES products(id),
  ordered_qty   INT           NOT NULL DEFAULT 0,
  received_qty  INT           NOT NULL DEFAULT 0,
  unit_cost     NUMERIC(18,2),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id      ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product_id ON purchase_order_items(product_id);

-- ── 6. order_fulfillment ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_fulfillment (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID          UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status           VARCHAR(50)   NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','packed','shipped','delivered','cancelled','returned')),
  fulfillment_type VARCHAR(50)   NOT NULL DEFAULT 'mixed'
                     CHECK (fulfillment_type IN ('product','nft','mixed')),
  tracking_number  VARCHAR(200),
  carrier          VARCHAR(100),
  shipping_address TEXT,
  notes            TEXT,
  assigned_to      UUID          REFERENCES users(id) ON DELETE SET NULL,
  packed_at        TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_fulfillment_order_id    ON order_fulfillment(order_id);
CREATE INDEX IF NOT EXISTS idx_order_fulfillment_status      ON order_fulfillment(status);
CREATE INDEX IF NOT EXISTS idx_order_fulfillment_assigned_to ON order_fulfillment(assigned_to);

-- ── 7. order_return_items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_return_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID          NOT NULL REFERENCES orders(id),
  product_id    UUID          REFERENCES products(id),
  quantity      INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
  reason        VARCHAR(200),
  condition     VARCHAR(50)   NOT NULL DEFAULT 'good',
  notes         TEXT,
  status        VARCHAR(50)   NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','received','rejected','restocked')),
  processed_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_return_items_order_id    ON order_return_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_return_items_product_id  ON order_return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_return_items_status      ON order_return_items(status);
CREATE INDEX IF NOT EXISTS idx_order_return_items_processed_by ON order_return_items(processed_by);

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 2: SEED — stock_adjustment_reasons
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO stock_adjustment_reasons (value, label, sort_order) VALUES
  ('received_stock',    'Received Stock',       1),
  ('sale',              'Sale',                 2),
  ('customer_return',   'Customer Return',      3),
  ('damaged',           'Damaged',              4),
  ('theft_loss',        'Theft / Loss',         5),
  ('count_correction',  'Count Correction',     6),
  ('transfer_in',       'Transfer In',          7),
  ('transfer_out',      'Transfer Out',         8),
  ('promotional',       'Promotional',          9),
  ('sample',            'Sample',              10),
  ('manual',            'Manual Adjustment',   11)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 3: SEED — category_attribute_templates
-- ══════════════════════════════════════════════════════════════════════

-- t-shirts
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('t-shirts', 'sizes',    'Sizes',    'multiselect', 'XS,S,M,L,XL,XXL,XXXL', NULL,      TRUE,  1),
  ('t-shirts', 'colors',   'Colors',   'text',        NULL,                    NULL,      FALSE, 2),
  ('t-shirts', 'material', 'Material', 'text',        NULL,                    NULL,      FALSE, 3),
  ('t-shirts', 'fit',      'Fit',      'select',      'Regular,Slim,Oversized,Relaxed', NULL, FALSE, 4),
  ('t-shirts', 'care',     'Care',     'text',        NULL,                    NULL,      FALSE, 5),
  ('t-shirts', 'gender',   'Gender',   'select',      'Unisex,Men,Women,Kids', NULL,      FALSE, 6)
ON CONFLICT DO NOTHING;

-- headwear
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('headwear', 'sizes',    'Sizes',    'multiselect', 'One Size,S/M,L/XL',              NULL, FALSE, 1),
  ('headwear', 'colors',   'Colors',   'text',        NULL,                             NULL, FALSE, 2),
  ('headwear', 'material', 'Material', 'text',        NULL,                             NULL, FALSE, 3),
  ('headwear', 'closure',  'Closure',  'select',      'Adjustable,Fitted,Stretch,Snapback,Buckle', NULL, FALSE, 4)
ON CONFLICT DO NOTHING;

-- bags
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('bags', 'material',   'Material',   'text',   NULL,                                NULL,        FALSE, 1),
  ('bags', 'dimensions', 'Dimensions', 'text',   NULL,                                'W×H×D cm',  FALSE, 2),
  ('bags', 'capacity',   'Capacity',   'text',   NULL,                                NULL,        FALSE, 3),
  ('bags', 'colors',     'Colors',     'text',   NULL,                                NULL,        FALSE, 4),
  ('bags', 'closure',    'Closure',    'select', 'Zipper,Magnetic,Drawstring,Buckle', NULL,        FALSE, 5)
ON CONFLICT DO NOTHING;

-- accessories
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('accessories', 'material',   'Material',   'text', NULL, NULL, FALSE, 1),
  ('accessories', 'colors',     'Colors',     'text', NULL, NULL, FALSE, 2),
  ('accessories', 'dimensions', 'Dimensions', 'text', NULL, NULL, FALSE, 3),
  ('accessories', 'weight',     'Weight',     'text', NULL, NULL, FALSE, 4)
ON CONFLICT DO NOTHING;

-- outerwear
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('outerwear', 'sizes',      'Sizes',      'multiselect', 'XS,S,M,L,XL,XXL',        NULL, TRUE,  1),
  ('outerwear', 'colors',     'Colors',     'text',        NULL,                      NULL, FALSE, 2),
  ('outerwear', 'material',   'Material',   'text',        NULL,                      NULL, FALSE, 3),
  ('outerwear', 'fit',        'Fit',        'select',      'Regular,Slim,Oversized',  NULL, FALSE, 4),
  ('outerwear', 'waterproof', 'Waterproof', 'boolean',     NULL,                      NULL, FALSE, 5)
ON CONFLICT DO NOTHING;

-- socks
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('socks', 'sizes',    'Sizes',    'multiselect', 'S (35-38),M (39-42),L (43-46)', NULL, FALSE, 1),
  ('socks', 'material', 'Material', 'text',        NULL,                            NULL, FALSE, 2),
  ('socks', 'colors',   'Colors',   'text',        NULL,                            NULL, FALSE, 3)
ON CONFLICT DO NOTHING;

-- hoodies
INSERT INTO category_attribute_templates (category_code, attr_key, attr_label, attr_type, attr_options, placeholder, is_required, sort_order) VALUES
  ('hoodies', 'sizes',    'Sizes',    'multiselect', 'XS,S,M,L,XL,XXL,XXXL',         NULL, TRUE,  1),
  ('hoodies', 'colors',   'Colors',   'text',        NULL,                            NULL, FALSE, 2),
  ('hoodies', 'material', 'Material', 'text',        NULL,                            NULL, FALSE, 3),
  ('hoodies', 'fit',      'Fit',      'select',      'Regular,Slim,Oversized',        NULL, FALSE, 4),
  ('hoodies', 'hood',     'Hood',     'boolean',     NULL,                            NULL, FALSE, 5)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 4: STORED PROCEDURES
-- ══════════════════════════════════════════════════════════════════════

-- ── product_stock_adjust ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS product_stock_adjust(UUID,INT,VARCHAR,TEXT,UUID);
CREATE OR REPLACE FUNCTION product_stock_adjust(
  p_product_id UUID,
  p_change_qty  INT,
  p_reason      VARCHAR DEFAULT 'manual',
  p_notes       TEXT    DEFAULT NULL,
  p_user_id     UUID    DEFAULT NULL
)
RETURNS TABLE(
  id           UUID,
  product_id   UUID,
  change_qty   INT,
  previous_qty INT,
  new_qty      INT,
  reason       VARCHAR,
  notes        TEXT,
  adjusted_by  UUID,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_prev_qty INT;
  v_new_qty  INT;
BEGIN
  SELECT stock_qty INTO v_prev_qty
  FROM products
  WHERE products.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_qty := v_prev_qty + p_change_qty;

  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Stock quantity cannot be negative. Current: %, Change: %', v_prev_qty, p_change_qty
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE products SET stock_qty = v_new_qty WHERE products.id = p_product_id;

  RETURN QUERY
  INSERT INTO product_stock_adjustments (
    product_id, change_qty, previous_qty, new_qty, reason, notes, adjusted_by
  ) VALUES (
    p_product_id, p_change_qty, v_prev_qty, v_new_qty,
    COALESCE(p_reason, 'manual'), p_notes, p_user_id
  )
  RETURNING
    product_stock_adjustments.id,
    product_stock_adjustments.product_id,
    product_stock_adjustments.change_qty,
    product_stock_adjustments.previous_qty,
    product_stock_adjustments.new_qty,
    product_stock_adjustments.reason,
    product_stock_adjustments.notes,
    product_stock_adjustments.adjusted_by,
    product_stock_adjustments.created_at;
END;
$$;

-- ── product_stock_history ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS product_stock_history(UUID,INT,INT);
CREATE OR REPLACE FUNCTION product_stock_history(
  p_product_id UUID,
  p_limit      INT DEFAULT 50,
  p_offset     INT DEFAULT 0
)
RETURNS TABLE(
  id               UUID,
  product_id       UUID,
  change_qty       INT,
  previous_qty     INT,
  new_qty          INT,
  reason           VARCHAR,
  notes            TEXT,
  adjusted_by      UUID,
  adjusted_by_name TEXT,
  created_at       TIMESTAMPTZ,
  total_count      BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    psa.id,
    psa.product_id,
    psa.change_qty,
    psa.previous_qty,
    psa.new_qty,
    psa.reason,
    psa.notes,
    psa.adjusted_by,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS adjusted_by_name,
    psa.created_at,
    COUNT(*) OVER() AS total_count
  FROM product_stock_adjustments psa
  LEFT JOIN users u ON u.id = psa.adjusted_by
  WHERE psa.product_id = p_product_id
  ORDER BY psa.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── inventory_overview ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_overview()
RETURNS TABLE(
  total_products       INT,
  active_products      INT,
  low_stock_products   INT,
  out_of_stock_products INT,
  total_inventory_value NUMERIC,
  pending_pos          INT,
  open_fulfillments    INT,
  pending_returns      INT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INT            FROM products)                                          AS total_products,
    (SELECT COUNT(*)::INT            FROM products p2
       LEFT JOIN product_statuses ps ON ps.id = p2.status_id WHERE ps.code = 'active')      AS active_products,
    (SELECT COUNT(*)::INT            FROM products WHERE stock_qty > 0 AND stock_qty <= 10)  AS low_stock_products,
    (SELECT COUNT(*)::INT            FROM products WHERE stock_qty = 0)                      AS out_of_stock_products,
    (SELECT COALESCE(SUM(presale_price * stock_qty), 0)
       FROM products)                                                                         AS total_inventory_value,
    (SELECT COUNT(*)::INT            FROM purchase_orders WHERE status IN ('draft','submitted','partial')) AS pending_pos,
    (SELECT COUNT(*)::INT            FROM order_fulfillment WHERE status IN ('pending','processing','packed','shipped')) AS open_fulfillments,
    (SELECT COUNT(*)::INT            FROM order_return_items WHERE status IN ('pending','approved','received')) AS pending_returns;
END;
$$;

-- ── purchase_orders_list ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_orders_list(
  p_status VARCHAR DEFAULT NULL,
  p_limit  INT     DEFAULT 20,
  p_offset INT     DEFAULT 0
)
RETURNS TABLE(
  id           UUID,
  po_number    VARCHAR,
  supplier     VARCHAR,
  status       VARCHAR,
  notes        TEXT,
  expected_date DATE,
  received_at  TIMESTAMPTZ,
  total_cost   NUMERIC,
  created_by   UUID,
  creator_name TEXT,
  item_count   BIGINT,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  total_count  BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    po.id,
    po.po_number,
    po.supplier,
    po.status,
    po.notes,
    po.expected_date,
    po.received_at,
    po.total_cost,
    po.created_by,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS creator_name,
    (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.po_id = po.id) AS item_count,
    po.created_at,
    po.updated_at,
    COUNT(*) OVER() AS total_count
  FROM purchase_orders po
  LEFT JOIN users u ON u.id = po.created_by
  WHERE (p_status IS NULL OR po.status = p_status)
  ORDER BY po.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── purchase_order_get ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_get(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_id) THEN
    RAISE EXCEPTION 'Purchase order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT json_build_object(
    'id',           po.id,
    'poNumber',     po.po_number,
    'supplier',     po.supplier,
    'status',       po.status,
    'notes',        po.notes,
    'expectedDate', po.expected_date,
    'receivedAt',   po.received_at,
    'totalCost',    po.total_cost,
    'createdBy',    po.created_by,
    'creatorName',  CONCAT(u.first_name, ' ', u.last_name),
    'createdAt',    po.created_at,
    'updatedAt',    po.updated_at,
    'items', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',          poi.id,
          'productId',   poi.product_id,
          'productName', p.name,
          'sku',         p.sku,
          'orderedQty',  poi.ordered_qty,
          'receivedQty', poi.received_qty,
          'unitCost',    poi.unit_cost,
          'notes',       poi.notes
        ) ORDER BY p.name
       )
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       WHERE poi.po_id = po.id
      ), '[]'::json)
  ) INTO v_result
  FROM purchase_orders po
  LEFT JOIN users u ON u.id = po.created_by
  WHERE po.id = p_id;

  RETURN v_result;
END;
$$;

-- ── purchase_order_create ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_create(
  p_po_number    VARCHAR,
  p_supplier     VARCHAR  DEFAULT NULL,
  p_notes        TEXT     DEFAULT NULL,
  p_expected_date DATE    DEFAULT NULL,
  p_created_by   UUID     DEFAULT NULL,
  p_items        JSON     DEFAULT '[]'
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_new_id   UUID;
  v_item     JSON;
BEGIN
  INSERT INTO purchase_orders (po_number, supplier, notes, expected_date, created_by, status)
  VALUES (p_po_number, p_supplier, p_notes, p_expected_date, p_created_by, 'draft')
  RETURNING id INTO v_new_id;

  FOR v_item IN SELECT * FROM json_array_elements(COALESCE(p_items, '[]'::json))
  LOOP
    INSERT INTO purchase_order_items (po_id, product_id, ordered_qty, unit_cost)
    VALUES (
      v_new_id,
      (v_item->>'productId')::UUID,
      COALESCE((v_item->>'orderedQty')::INT, 0),
      (v_item->>'unitCost')::NUMERIC
    );
  END LOOP;

  RETURN purchase_order_get(v_new_id);
END;
$$;

-- ── purchase_order_receive ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_receive(
  p_id      UUID,
  p_items   JSON,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_item          JSON;
  v_po_item_id    UUID;
  v_received_qty  INT;
  v_product_id    UUID;
  v_all_received  BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_id) THEN
    RAISE EXCEPTION 'Purchase order not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(COALESCE(p_items, '[]'::json))
  LOOP
    v_po_item_id   := (v_item->>'poItemId')::UUID;
    v_received_qty := COALESCE((v_item->>'receivedQty')::INT, 0);

    SELECT product_id INTO v_product_id
    FROM purchase_order_items
    WHERE id = v_po_item_id AND po_id = p_id;

    IF FOUND AND v_product_id IS NOT NULL AND v_received_qty > 0 THEN
      UPDATE purchase_order_items
      SET received_qty = received_qty + v_received_qty
      WHERE id = v_po_item_id;

      PERFORM product_stock_adjust(v_product_id, v_received_qty, 'received_stock', NULL, p_user_id);
    END IF;
  END LOOP;

  -- Determine new PO status
  SELECT NOT EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE po_id = p_id AND received_qty < ordered_qty
  ) INTO v_all_received;

  UPDATE purchase_orders SET
    status      = CASE WHEN v_all_received THEN 'received' ELSE 'partial' END,
    received_at = CASE WHEN v_all_received THEN NOW() ELSE received_at END,
    updated_at  = NOW()
  WHERE id = p_id;

  RETURN purchase_order_get(p_id);
END;
$$;

-- ── fulfillment_list ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fulfillment_list(
  p_status VARCHAR DEFAULT NULL,
  p_type   VARCHAR DEFAULT NULL,
  p_limit  INT     DEFAULT 20,
  p_offset INT     DEFAULT 0
)
RETURNS TABLE(
  id               UUID,
  order_id         UUID,
  status           VARCHAR,
  fulfillment_type VARCHAR,
  tracking_number  VARCHAR,
  carrier          VARCHAR,
  shipping_address TEXT,
  notes            TEXT,
  assigned_to      UUID,
  packed_at        TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ,
  order_number     VARCHAR,
  customer_name    TEXT,
  purchase_date    DATE,
  nft_count        BIGINT,
  product_count    BIGINT,
  merch_amount_twd NUMERIC,
  nft_amount_twd   NUMERIC,
  total_count      BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.order_id,
    f.status,
    f.fulfillment_type,
    f.tracking_number,
    f.carrier,
    f.shipping_address,
    f.notes,
    f.assigned_to,
    f.packed_at,
    f.shipped_at,
    f.delivered_at,
    f.created_at,
    f.updated_at,
    o.order_number,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS customer_name,
    o.purchase_date,
    (SELECT COUNT(*) FROM order_nft_items     oni WHERE oni.order_id = o.id) AS nft_count,
    (SELECT COUNT(*) FROM order_product_items opi WHERE opi.order_id = o.id) AS product_count,
    o.merch_amount_twd,
    o.nft_amount_twd,
    COUNT(*) OVER() AS total_count
  FROM order_fulfillment f
  JOIN orders o ON o.id = f.order_id
  LEFT JOIN users u ON u.id = o.customer_id
  WHERE (p_status IS NULL OR f.status = p_status)
    AND (p_type   IS NULL OR f.fulfillment_type = p_type)
  ORDER BY f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── fulfillment_get ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fulfillment_get(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',              f.id,
    'orderId',         f.order_id,
    'status',          f.status,
    'fulfillmentType', f.fulfillment_type,
    'trackingNumber',  f.tracking_number,
    'carrier',         f.carrier,
    'shippingAddress', f.shipping_address,
    'notes',           f.notes,
    'assignedTo',      f.assigned_to,
    'packedAt',        f.packed_at,
    'shippedAt',       f.shipped_at,
    'deliveredAt',     f.delivered_at,
    'createdAt',       f.created_at,
    'updatedAt',       f.updated_at,
    'order', json_build_object(
      'id',           o.id,
      'orderNumber',  o.order_number,
      'purchaseDate', o.purchase_date,
      'nftAmountTwd', o.nft_amount_twd,
      'nftAmountEth', o.nft_amount_eth,
      'merchAmountTwd', o.merch_amount_twd,
      'nftPaymentStatusId',   o.nft_payment_status_id,
      'merchPaymentStatusId', o.merch_payment_status_id,
      'notes',        o.notes
    ),
    'customer', json_build_object(
      'id',        u.id,
      'firstName', u.first_name,
      'lastName',  u.last_name
    ),
    'productItems', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',        opi.id,
          'productId', opi.product_id,
          'name',      p.name,
          'sku',       p.sku,
          'imageUrl',  p.image_url,
          'quantity',  opi.quantity,
          'unitPrice', opi.unit_price,
          'notes',     opi.notes
        ) ORDER BY p.name
       )
       FROM order_product_items opi
       LEFT JOIN products p ON p.id = opi.product_id
       WHERE opi.order_id = o.id
      ), '[]'::json),
    'nftItems', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',           oni.id,
          'nftRecordId',  oni.nft_record_id,
          'walletAddress',oni.wallet_address,
          'unitPriceTwd', oni.unit_price_twd,
          'unitPriceEth', oni.unit_price_eth,
          'notes',        oni.notes
        ) ORDER BY oni.id
       )
       FROM order_nft_items oni
       WHERE oni.order_id = o.id
      ), '[]'::json)
  ) INTO v_result
  FROM order_fulfillment f
  JOIN orders o ON o.id = f.order_id
  LEFT JOIN users u ON u.id = o.customer_id
  WHERE f.order_id = p_order_id;

  RETURN v_result;
END;
$$;

-- ── fulfillment_upsert ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fulfillment_upsert(
  p_order_id        UUID,
  p_status          VARCHAR DEFAULT NULL,
  p_fulfillment_type VARCHAR DEFAULT NULL,
  p_tracking        VARCHAR DEFAULT NULL,
  p_carrier         VARCHAR DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL,
  p_assigned_to     UUID    DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  order_id         UUID,
  status           VARCHAR,
  fulfillment_type VARCHAR,
  tracking_number  VARCHAR,
  carrier          VARCHAR,
  notes            TEXT,
  assigned_to      UUID,
  packed_at        TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_status  VARCHAR;
BEGIN
  v_status := p_status;

  INSERT INTO order_fulfillment (order_id, status, fulfillment_type, tracking_number, carrier, notes, assigned_to)
  VALUES (
    p_order_id,
    COALESCE(p_status, 'pending'),
    COALESCE(p_fulfillment_type, 'mixed'),
    p_tracking,
    p_carrier,
    p_notes,
    p_assigned_to
  )
  ON CONFLICT (order_id) DO UPDATE SET
    status           = COALESCE(EXCLUDED.status,           order_fulfillment.status),
    fulfillment_type = COALESCE(EXCLUDED.fulfillment_type, order_fulfillment.fulfillment_type),
    tracking_number  = COALESCE(EXCLUDED.tracking_number,  order_fulfillment.tracking_number),
    carrier          = COALESCE(EXCLUDED.carrier,          order_fulfillment.carrier),
    notes            = COALESCE(EXCLUDED.notes,            order_fulfillment.notes),
    assigned_to      = COALESCE(EXCLUDED.assigned_to,      order_fulfillment.assigned_to),
    packed_at        = CASE WHEN EXCLUDED.status = 'packed'    AND order_fulfillment.packed_at IS NULL    THEN NOW() ELSE order_fulfillment.packed_at    END,
    shipped_at       = CASE WHEN EXCLUDED.status = 'shipped'   AND order_fulfillment.shipped_at IS NULL   THEN NOW() ELSE order_fulfillment.shipped_at   END,
    delivered_at     = CASE WHEN EXCLUDED.status = 'delivered' AND order_fulfillment.delivered_at IS NULL THEN NOW() ELSE order_fulfillment.delivered_at END,
    updated_at       = NOW();

  RETURN QUERY
  SELECT
    f.id, f.order_id, f.status, f.fulfillment_type,
    f.tracking_number, f.carrier, f.notes, f.assigned_to,
    f.packed_at, f.shipped_at, f.delivered_at,
    f.created_at, f.updated_at
  FROM order_fulfillment f
  WHERE f.order_id = p_order_id;
END;
$$;

-- ── return_create ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION return_create(
  p_order_id   UUID,
  p_product_id UUID,
  p_quantity   INT     DEFAULT 1,
  p_reason     VARCHAR DEFAULT NULL,
  p_condition  VARCHAR DEFAULT 'good',
  p_notes      TEXT    DEFAULT NULL
)
RETURNS TABLE(
  id           UUID,
  order_id     UUID,
  product_id   UUID,
  quantity     INT,
  reason       VARCHAR,
  condition    VARCHAR,
  notes        TEXT,
  status       VARCHAR,
  processed_by UUID,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  INSERT INTO order_return_items (order_id, product_id, quantity, reason, condition, notes)
  VALUES (p_order_id, p_product_id, COALESCE(p_quantity, 1), p_reason, COALESCE(p_condition, 'good'), p_notes)
  RETURNING
    order_return_items.id,
    order_return_items.order_id,
    order_return_items.product_id,
    order_return_items.quantity,
    order_return_items.reason,
    order_return_items.condition,
    order_return_items.notes,
    order_return_items.status,
    order_return_items.processed_by,
    order_return_items.created_at,
    order_return_items.updated_at;
END;
$$;

-- ── return_process ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION return_process(
  p_return_id    UUID,
  p_status       VARCHAR,
  p_processed_by UUID DEFAULT NULL
)
RETURNS TABLE(
  id           UUID,
  order_id     UUID,
  product_id   UUID,
  quantity     INT,
  reason       VARCHAR,
  condition    VARCHAR,
  notes        TEXT,
  status       VARCHAR,
  processed_by UUID,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_product_id UUID;
  v_quantity   INT;
BEGIN
  SELECT ri.product_id, ri.quantity INTO v_product_id, v_quantity
  FROM order_return_items ri
  WHERE ri.id = p_return_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return item not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE order_return_items SET
    status       = p_status,
    processed_by = COALESCE(p_processed_by, processed_by),
    updated_at   = NOW()
  WHERE id = p_return_id;

  IF p_status = 'restocked' AND v_product_id IS NOT NULL THEN
    PERFORM product_stock_adjust(v_product_id, v_quantity, 'customer_return', NULL, p_processed_by);
  END IF;

  RETURN QUERY
  SELECT
    ri.id, ri.order_id, ri.product_id, ri.quantity,
    ri.reason, ri.condition, ri.notes, ri.status,
    ri.processed_by, ri.created_at, ri.updated_at
  FROM order_return_items ri
  WHERE ri.id = p_return_id;
END;
$$;

-- ── returns_list ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION returns_list(
  p_status VARCHAR DEFAULT NULL,
  p_limit  INT     DEFAULT 20,
  p_offset INT     DEFAULT 0
)
RETURNS TABLE(
  id            UUID,
  order_id      UUID,
  product_id    UUID,
  quantity      INT,
  reason        VARCHAR,
  condition     VARCHAR,
  notes         TEXT,
  status        VARCHAR,
  processed_by  UUID,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  product_name  VARCHAR,
  order_number  VARCHAR,
  customer_name TEXT,
  total_count   BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ri.id,
    ri.order_id,
    ri.product_id,
    ri.quantity,
    ri.reason,
    ri.condition,
    ri.notes,
    ri.status,
    ri.processed_by,
    ri.created_at,
    ri.updated_at,
    p.name                                     AS product_name,
    o.order_number,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS customer_name,
    COUNT(*) OVER()                            AS total_count
  FROM order_return_items ri
  LEFT JOIN products p ON p.id = ri.product_id
  LEFT JOIN orders   o ON o.id = ri.order_id
  LEFT JOIN users    u ON u.id = o.customer_id
  WHERE (p_status IS NULL OR ri.status = p_status)
  ORDER BY ri.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMIT;
