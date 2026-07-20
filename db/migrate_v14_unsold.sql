-- =====================================================================
-- BearthApi — Migration V14: Remaining NFT Selling Strategies
-- Integrates 4 remaining NFT selling strategies:
--   4. Dutch Auction
--  17. OTC / Private Sale
--  19. Corporate / Bulk Purchase
--  20. Gift Purchase
--
-- Run: psql <connection_url> -f migrate_v14_unsold.sql
-- =====================================================================

BEGIN;

-- ── 1. New columns on nft_waves (Strategy 4: Dutch Auction) ──────────
-- Mirrors the Dutch Auction parameters that live on-chain in the contract

ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS is_dutch_wave         BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS dutch_start_price_eth NUMERIC(18,8);
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS dutch_floor_price_eth NUMERIC(18,8);
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS dutch_decrement_eth   NUMERIC(18,8);
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS dutch_interval_secs   INT;

-- ── 2. New table: nft_otc_deals (Strategy 17: OTC / Private Sale) ────

CREATE TABLE IF NOT EXISTS nft_otc_deals (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_name            VARCHAR(200),
  buyer_wallet          VARCHAR(42)  NOT NULL,
  buyer_customer_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
  nft_record_ids        UUID[]       NOT NULL DEFAULT '{}',
  negotiated_price_eth  NUMERIC(18,8),
  negotiated_price_twd  NUMERIC(18,2),
  payment_method        VARCHAR(50),
  status                VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- pending / confirmed / transferred / cancelled
  notes                 TEXT,
  order_id              UUID         REFERENCES orders(id) ON DELETE SET NULL,
  transfer_tx_hash      TEXT,
  transferred_at        TIMESTAMPTZ,
  created_by            UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otc_deals_status      ON nft_otc_deals(status);
CREATE INDEX IF NOT EXISTS idx_otc_deals_buyer_wallet ON nft_otc_deals(buyer_wallet);

-- ── 3. New table: nft_bulk_orders (Strategy 19: Corporate / Bulk) ────

CREATE TABLE IF NOT EXISTS nft_bulk_orders (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        VARCHAR(200) NOT NULL,
  contact_name        VARCHAR(200),
  contact_email       VARCHAR(200),
  buyer_wallet        VARCHAR(42)  NOT NULL,
  buyer_customer_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
  quantity            INT          NOT NULL,
  rarity_tier         VARCHAR(20),
  -- NULL = any rarity
  wave_id             UUID         REFERENCES nft_waves(id) ON DELETE SET NULL,
  unit_price_eth      NUMERIC(18,8),
  unit_price_twd      NUMERIC(18,2),
  discount_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_price_eth     NUMERIC(18,8),
  total_price_twd     NUMERIC(18,2),
  payment_method      VARCHAR(50),
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- pending / confirmed / minting / completed / cancelled
  minted_token_ids    BIGINT[]     NOT NULL DEFAULT '{}',
  nft_record_ids      UUID[]       NOT NULL DEFAULT '{}',
  order_id            UUID         REFERENCES orders(id) ON DELETE SET NULL,
  notes               TEXT,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bulk_orders_status      ON nft_bulk_orders(status);
CREATE INDEX IF NOT EXISTS idx_bulk_orders_buyer_wallet ON nft_bulk_orders(buyer_wallet);

-- ── 4. New table: nft_gift_orders (Strategy 20: Gift Purchase) ───────

CREATE TABLE IF NOT EXISTS nft_gift_orders (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_customer_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  sender_wallet       VARCHAR(42),
  recipient_wallet    VARCHAR(42)  NOT NULL,
  recipient_name      VARCHAR(200),
  recipient_email     VARCHAR(200),
  nft_record_id       UUID         REFERENCES nft_records(id) ON DELETE SET NULL,
  -- NULL = new mint
  rarity_tier         VARCHAR(20),
  -- requested rarity if new mint
  gift_message        TEXT,
  price_eth           NUMERIC(18,8),
  price_twd           NUMERIC(18,2),
  payment_method      VARCHAR(50),
  is_airdrop          BOOLEAN      NOT NULL DEFAULT FALSE,
  -- TRUE = free transfer, no payment
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- pending / paid / transferred / cancelled
  order_id            UUID         REFERENCES orders(id) ON DELETE SET NULL,
  minted_token_id     BIGINT,
  transfer_tx_hash    TEXT,
  transferred_at      TIMESTAMPTZ,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gift_orders_recipient   ON nft_gift_orders(recipient_wallet);
CREATE INDEX IF NOT EXISTS idx_gift_orders_status      ON nft_gift_orders(status);
CREATE INDEX IF NOT EXISTS idx_gift_orders_sender      ON nft_gift_orders(sender_customer_id);

-- ── 5. Stored functions ───────────────────────────────────────────────

-- ─────────────────────────────────────────
-- DUTCH AUCTION (Strategy 4)
-- ─────────────────────────────────────────

-- Stores the Dutch Auction config on the matching wave row.
-- Mirrors the on-chain parameters so the admin UI stays in sync
-- with whatever was deployed to the contract.
CREATE OR REPLACE FUNCTION nft_wave_set_dutch_config(
  p_wave_num        INT,
  p_start_eth       NUMERIC,
  p_floor_eth       NUMERIC,
  p_decrement_eth   NUMERIC,
  p_interval_secs   INT,
  p_is_dutch        BOOLEAN
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves
  SET
    is_dutch_wave         = p_is_dutch,
    dutch_start_price_eth = p_start_eth,
    dutch_floor_price_eth = p_floor_eth,
    dutch_decrement_eth   = p_decrement_eth,
    dutch_interval_secs   = p_interval_secs
  WHERE wave_number = p_wave_num;
$$;

-- Returns all waves that have Dutch Auction enabled, with their config.
CREATE OR REPLACE FUNCTION nft_waves_dutch_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(w) ORDER BY w.wave_number), '[]')
  FROM (
    SELECT
      id,
      wave_number,
      name,
      status,
      is_dutch_wave,
      dutch_start_price_eth,
      dutch_floor_price_eth,
      dutch_decrement_eth,
      dutch_interval_secs,
      scheduled_start,
      scheduled_end,
      quantity,
      sold_count
    FROM nft_waves
    WHERE is_dutch_wave = TRUE
    ORDER BY wave_number
  ) w;
$$;

-- ─────────────────────────────────────────
-- OTC / PRIVATE SALE (Strategy 17)
-- ─────────────────────────────────────────

-- Returns all OTC deals, newest first.
CREATE OR REPLACE FUNCTION nft_otc_deals_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.created_at DESC), '[]')
  FROM (
    SELECT
      od.id,
      od.buyer_name,
      od.buyer_wallet,
      od.buyer_customer_id,
      od.nft_record_ids,
      od.negotiated_price_eth,
      od.negotiated_price_twd,
      od.payment_method,
      od.status,
      od.notes,
      od.order_id,
      od.transfer_tx_hash,
      od.transferred_at,
      od.created_by,
      od.created_at,
      od.updated_at,
      u.first_name || ' ' || u.last_name AS buyer_customer_name,
      u.email                             AS buyer_customer_email
    FROM nft_otc_deals od
    LEFT JOIN users u ON u.id = od.buyer_customer_id
    ORDER BY od.created_at DESC
  ) d;
$$;

-- Creates a new OTC deal (p_id = NULL) or updates an existing one.
-- Returns {id} of the affected row.
CREATE OR REPLACE FUNCTION nft_otc_deal_upsert(
  p_id                   UUID,
  p_buyer_name           VARCHAR,
  p_buyer_wallet         VARCHAR,
  p_buyer_customer_id    UUID,
  p_nft_record_ids       UUID[],
  p_negotiated_price_eth NUMERIC,
  p_negotiated_price_twd NUMERIC,
  p_payment_method       VARCHAR,
  p_notes                TEXT,
  p_created_by           UUID
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_otc_deals SET
      buyer_name            = p_buyer_name,
      buyer_wallet          = p_buyer_wallet,
      buyer_customer_id     = p_buyer_customer_id,
      nft_record_ids        = p_nft_record_ids,
      negotiated_price_eth  = p_negotiated_price_eth,
      negotiated_price_twd  = p_negotiated_price_twd,
      payment_method        = p_payment_method,
      notes                 = p_notes,
      updated_at            = NOW()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_otc_deals (
      buyer_name, buyer_wallet, buyer_customer_id, nft_record_ids,
      negotiated_price_eth, negotiated_price_twd, payment_method,
      notes, created_by
    ) VALUES (
      p_buyer_name, p_buyer_wallet, p_buyer_customer_id, COALESCE(p_nft_record_ids, '{}'),
      p_negotiated_price_eth, p_negotiated_price_twd, p_payment_method,
      p_notes, p_created_by
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

-- Marks a deal as transferred once the on-chain transfer is confirmed.
CREATE OR REPLACE FUNCTION nft_otc_deal_settle(p_id UUID, p_tx_hash TEXT)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_otc_deals
  SET
    status           = 'transferred',
    transfer_tx_hash = p_tx_hash,
    transferred_at   = NOW(),
    updated_at       = NOW()
  WHERE id = p_id;
$$;

-- Cancels a deal.
CREATE OR REPLACE FUNCTION nft_otc_deal_cancel(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_otc_deals
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_id;
$$;

-- ─────────────────────────────────────────
-- CORPORATE / BULK PURCHASE (Strategy 19)
-- ─────────────────────────────────────────

-- Returns all bulk orders, newest first.
CREATE OR REPLACE FUNCTION nft_bulk_orders_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(b) ORDER BY b.created_at DESC), '[]')
  FROM (
    SELECT
      bo.id,
      bo.company_name,
      bo.contact_name,
      bo.contact_email,
      bo.buyer_wallet,
      bo.buyer_customer_id,
      bo.quantity,
      bo.rarity_tier,
      bo.wave_id,
      bo.unit_price_eth,
      bo.unit_price_twd,
      bo.discount_pct,
      bo.total_price_eth,
      bo.total_price_twd,
      bo.payment_method,
      bo.status,
      bo.minted_token_ids,
      bo.nft_record_ids,
      bo.order_id,
      bo.notes,
      bo.created_by,
      bo.created_at,
      bo.updated_at,
      w.name AS wave_name,
      w.wave_number
    FROM nft_bulk_orders bo
    LEFT JOIN nft_waves w ON w.id = bo.wave_id
    ORDER BY bo.created_at DESC
  ) b;
$$;

-- Creates a new bulk order (p_id = NULL) or updates an existing one.
-- Returns {id} of the affected row.
CREATE OR REPLACE FUNCTION nft_bulk_order_upsert(
  p_id                UUID,
  p_company_name      VARCHAR,
  p_contact_name      VARCHAR,
  p_contact_email     VARCHAR,
  p_buyer_wallet      VARCHAR,
  p_buyer_customer_id UUID,
  p_quantity          INT,
  p_rarity_tier       VARCHAR,
  p_wave_id           UUID,
  p_unit_price_eth    NUMERIC,
  p_unit_price_twd    NUMERIC,
  p_discount_pct      NUMERIC,
  p_total_price_eth   NUMERIC,
  p_total_price_twd   NUMERIC,
  p_payment_method    VARCHAR,
  p_notes             TEXT,
  p_created_by        UUID
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_bulk_orders SET
      company_name      = p_company_name,
      contact_name      = p_contact_name,
      contact_email     = p_contact_email,
      buyer_wallet      = p_buyer_wallet,
      buyer_customer_id = p_buyer_customer_id,
      quantity          = p_quantity,
      rarity_tier       = p_rarity_tier,
      wave_id           = p_wave_id,
      unit_price_eth    = p_unit_price_eth,
      unit_price_twd    = p_unit_price_twd,
      discount_pct      = COALESCE(p_discount_pct, 0),
      total_price_eth   = p_total_price_eth,
      total_price_twd   = p_total_price_twd,
      payment_method    = p_payment_method,
      notes             = p_notes,
      updated_at        = NOW()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_bulk_orders (
      company_name, contact_name, contact_email,
      buyer_wallet, buyer_customer_id, quantity,
      rarity_tier, wave_id, unit_price_eth, unit_price_twd,
      discount_pct, total_price_eth, total_price_twd,
      payment_method, notes, created_by
    ) VALUES (
      p_company_name, p_contact_name, p_contact_email,
      p_buyer_wallet, p_buyer_customer_id, p_quantity,
      p_rarity_tier, p_wave_id, p_unit_price_eth, p_unit_price_twd,
      COALESCE(p_discount_pct, 0), p_total_price_eth, p_total_price_twd,
      p_payment_method, p_notes, p_created_by
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

-- Marks a bulk order as completed once all NFTs are minted and assigned.
CREATE OR REPLACE FUNCTION nft_bulk_order_fulfill(
  p_id               UUID,
  p_minted_token_ids BIGINT[],
  p_nft_record_ids   UUID[]
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_bulk_orders
  SET
    status           = 'completed',
    minted_token_ids = p_minted_token_ids,
    nft_record_ids   = p_nft_record_ids,
    updated_at       = NOW()
  WHERE id = p_id;
$$;

-- Cancels a bulk order.
CREATE OR REPLACE FUNCTION nft_bulk_order_cancel(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_bulk_orders
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_id;
$$;

-- ─────────────────────────────────────────
-- GIFT PURCHASE (Strategy 20)
-- ─────────────────────────────────────────

-- Returns all gift orders, newest first. Joins users to include sender name.
CREATE OR REPLACE FUNCTION nft_gift_orders_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(g) ORDER BY g.created_at DESC), '[]')
  FROM (
    SELECT
      go.id,
      go.sender_customer_id,
      go.sender_wallet,
      go.recipient_wallet,
      go.recipient_name,
      go.recipient_email,
      go.nft_record_id,
      go.rarity_tier,
      go.gift_message,
      go.price_eth,
      go.price_twd,
      go.payment_method,
      go.is_airdrop,
      go.status,
      go.order_id,
      go.minted_token_id,
      go.transfer_tx_hash,
      go.transferred_at,
      go.created_by,
      go.created_at,
      go.updated_at,
      u.first_name || ' ' || u.last_name AS sender_name,
      u.email                             AS sender_email
    FROM nft_gift_orders go
    LEFT JOIN users u ON u.id = go.sender_customer_id
    ORDER BY go.created_at DESC
  ) g;
$$;

-- Creates a new gift order. Returns {id}.
CREATE OR REPLACE FUNCTION nft_gift_order_create(
  p_sender_customer_id UUID,
  p_sender_wallet      VARCHAR,
  p_recipient_wallet   VARCHAR,
  p_recipient_name     VARCHAR,
  p_recipient_email    VARCHAR,
  p_nft_record_id      UUID,
  p_rarity_tier        VARCHAR,
  p_gift_message       TEXT,
  p_price_eth          NUMERIC,
  p_price_twd          NUMERIC,
  p_payment_method     VARCHAR,
  p_is_airdrop         BOOLEAN,
  p_created_by         UUID
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO nft_gift_orders (
    sender_customer_id, sender_wallet, recipient_wallet,
    recipient_name, recipient_email, nft_record_id,
    rarity_tier, gift_message, price_eth, price_twd,
    payment_method, is_airdrop, created_by
  ) VALUES (
    p_sender_customer_id, p_sender_wallet, p_recipient_wallet,
    p_recipient_name, p_recipient_email, p_nft_record_id,
    p_rarity_tier, p_gift_message, p_price_eth, p_price_twd,
    p_payment_method, COALESCE(p_is_airdrop, FALSE), p_created_by
  )
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END $$;

-- Marks a gift order as transferred once the on-chain transfer is confirmed.
CREATE OR REPLACE FUNCTION nft_gift_order_transfer(
  p_id              UUID,
  p_minted_token_id BIGINT,
  p_tx_hash         TEXT
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_gift_orders
  SET
    status           = 'transferred',
    minted_token_id  = p_minted_token_id,
    transfer_tx_hash = p_tx_hash,
    transferred_at   = NOW(),
    updated_at       = NOW()
  WHERE id = p_id;
$$;

-- Cancels a gift order.
CREATE OR REPLACE FUNCTION nft_gift_order_cancel(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_gift_orders
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_id;
$$;

-- ── 6. Menu entries for new pages ────────────────────────────────────

INSERT INTO menus (label, href, icon, module, sort_order) VALUES
  ('Dutch Auction', '/nft/dutch', 'trending-down', 'nft_sell', 140),
  ('Private Sale',  '/nft/otc',   'lock',          'nft_sell', 145),
  ('Bulk Orders',   '/nft/bulk',  'layers',        'nft_sell', 150),
  ('Gift & Airdrop','/nft/gifts', 'gift',          'nft_sell', 155)
ON CONFLICT DO NOTHING;

-- Assign new menus to admin + technical_team roles (same as existing nft_sell menus)
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('admin', 'technical_team')
  AND m.href IN ('/nft/dutch', '/nft/otc', '/nft/bulk', '/nft/gifts')
ON CONFLICT DO NOTHING;

COMMIT;
