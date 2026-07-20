-- =====================================================================
-- BearthApi — Migration V8: NFT Selling Ecosystem
-- Adds: collection config, royalty config, purchase limits, marketplace
--       allowlist, contract event log, wave selling columns, customer
--       VIP columns, nft_records rarity pricing columns
-- All stored functions follow the double-validation pattern:
--   BearthApi pre-validates (off-chain) → contract enforces (on-chain)
--   → event emitted → these functions sync DB mirror
--
-- Apply to: BearthDev first, then Bearth (production)
-- Run: psql <connection_url> -f migrate_v8_nft_selling.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
--                 + CREATE OR REPLACE FUNCTION
-- =====================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 1: NEW TABLES
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. nft_collection_config ──────────────────────────────────────────
-- Single-row mirror of on-chain collection state.
-- Source of truth is on-chain; this is a fast-read cache for BearthAdmin UI.
CREATE TABLE IF NOT EXISTS nft_collection_config (
  id                       INT         PRIMARY KEY DEFAULT 1,
  contract_address         TEXT,
  network                  VARCHAR(20) NOT NULL DEFAULT 'ethereum',
  current_phase            VARCHAR(20) NOT NULL DEFAULT 'Whitelist'
                             CHECK (current_phase IN ('Whitelist', 'PaidMint', 'Revealed')),
  provenance_hash          TEXT,
  blind_box_uri            TEXT,
  reveal_uri               TEXT,
  reveal_count             INT         NOT NULL DEFAULT 0,
  total_counter            INT         NOT NULL DEFAULT 0,
  max_supply               INT         NOT NULL DEFAULT 9999,
  treasury_wallet          TEXT,
  royalty_enforced         BOOLEAN     NOT NULL DEFAULT TRUE,
  purchase_limit_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
  normal_max_per_wallet    INT         NOT NULL DEFAULT 5,
  sbt_enabled              BOOLEAN     NOT NULL DEFAULT FALSE,
  synced_at                TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Seed the single config row
INSERT INTO nft_collection_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── 2. nft_royalty_config ─────────────────────────────────────────────
-- Mirror of on-chain ERC2981 royalty settings.
-- Updated by BearthApi event listener when RoyaltyUpdated / RoyaltyEnforcementChanged is emitted.
CREATE TABLE IF NOT EXISTS nft_royalty_config (
  id               INT         PRIMARY KEY DEFAULT 1,
  royalty_pct_bps  INT         NOT NULL DEFAULT 500
                     CHECK (royalty_pct_bps >= 0 AND royalty_pct_bps <= 1000),
  receiver_address TEXT        NOT NULL DEFAULT '',
  enforce_royalty  BOOLEAN     NOT NULL DEFAULT TRUE,
  last_tx_hash     TEXT,
  synced_at        TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO nft_royalty_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── 3. nft_purchase_limit_config ──────────────────────────────────────
-- Mirror of on-chain purchaseLimitEnabled + normalMaxPerWallet.
CREATE TABLE IF NOT EXISTS nft_purchase_limit_config (
  id                   INT         PRIMARY KEY DEFAULT 1,
  limit_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  normal_max_per_wallet INT        NOT NULL DEFAULT 5,
  last_tx_hash         TEXT,
  synced_at            TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO nft_purchase_limit_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── 4. nft_allowed_marketplaces ───────────────────────────────────────
-- Mirror of on-chain allowedMarketplaces mapping.
-- OpenSea Seaport is pre-seeded (matches contract constructor).
CREATE TABLE IF NOT EXISTS nft_allowed_marketplaces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  address     TEXT        NOT NULL UNIQUE,
  name        VARCHAR(100),
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  last_tx_hash TEXT,
  synced_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO nft_allowed_marketplaces (address, name, enabled)
VALUES ('0x00000000000000adc04c56bf30ac9d3c0aaf14dc', 'OpenSea Seaport v1.5', TRUE)
ON CONFLICT (address) DO NOTHING;

-- ── 5. nft_contract_events ────────────────────────────────────────────
-- Immutable audit log of every contract event received by BearthApi listener.
-- Used for DB resync: replay all events from block 0 to rebuild DB from scratch.
CREATE TABLE IF NOT EXISTS nft_contract_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name    VARCHAR(100) NOT NULL,
  tx_hash       TEXT        NOT NULL,
  block_number  BIGINT      NOT NULL,
  log_index     INT         NOT NULL,
  from_address  TEXT,
  to_address    TEXT,
  payload       JSONB       NOT NULL DEFAULT '{}',
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_nft_contract_events_name  ON nft_contract_events(event_name);
CREATE INDEX IF NOT EXISTS idx_nft_contract_events_block ON nft_contract_events(block_number);
CREATE INDEX IF NOT EXISTS idx_nft_contract_events_tx    ON nft_contract_events(tx_hash);

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 2: ALTER EXISTING TABLES
-- ══════════════════════════════════════════════════════════════════════

-- ── ALTER nft_waves ───────────────────────────────────────────────────
-- wave_number (existing) maps to contract waveNum (1–7)
-- default_price_eth (existing) mirrors wavePrice
-- scheduled_start/end (existing) mirror waveStartTime/EndTime
-- quantity (existing) mirrors waveQty

-- Selling state (mirrors on-chain)
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS sold_count      INT         NOT NULL DEFAULT 0;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS price_locked    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS wave_closed     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS close_action    VARCHAR(20)
  CHECK (close_action IN ('treasury', 'burn'));

-- OpenSea auction (Waves 3–7)
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS auction_listing_id  VARCHAR(200);
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS auction_start_price NUMERIC;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS auction_end_time    TIMESTAMPTZ;

-- Sync tracking
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS last_tx_hash TEXT;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS synced_at    TIMESTAMPTZ;

-- Add unique constraint on wave_number (one row per wave 1–7)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nft_waves_wave_number_key'
  ) THEN
    ALTER TABLE nft_waves ADD CONSTRAINT nft_waves_wave_number_key UNIQUE (wave_number);
  END IF;
END $$;

-- ── ALTER nft_records ─────────────────────────────────────────────────
-- token_id (existing) = on-chain token ID
-- owner_address (existing) = current on-chain owner
-- wave_id (existing) = FK to nft_waves (UUID)

-- Rarity pricing (mirrors on-chain tokenRarityPrice)
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS rarity_tier         VARCHAR(20)
  CHECK (rarity_tier IN ('legendary', 'epic', 'rare', 'common'));
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS rarity_price_eth    NUMERIC;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS rarity_price_locked BOOLEAN     NOT NULL DEFAULT FALSE;

-- On-chain wave number (1–7) for direct reference without joining nft_waves
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS on_chain_wave_num   INT
  CHECK (on_chain_wave_num >= 1 AND on_chain_wave_num <= 7);

-- Transfer / sale tracking
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS last_sale_price_eth NUMERIC;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS last_tx_hash        TEXT;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS synced_at           TIMESTAMPTZ;

-- Index for fast token_id lookups
CREATE INDEX IF NOT EXISTS idx_nft_records_token_id       ON nft_records(token_id);
CREATE INDEX IF NOT EXISTS idx_nft_records_owner_address  ON nft_records(owner_address);
CREATE INDEX IF NOT EXISTS idx_nft_records_wave_num       ON nft_records(on_chain_wave_num);
CREATE INDEX IF NOT EXISTS idx_nft_records_rarity_tier    ON nft_records(rarity_tier);

-- ── ALTER customer_wallets ────────────────────────────────────────────
-- address (existing) = wallet address
-- is_whitelisted (existing) = Wave 1 whitelist status

-- VIP / purchase limit (mirrors on-chain isVIP + walletTotalMinted)
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS is_vip               BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS wl_claimed            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS wallet_total_minted  INT     NOT NULL DEFAULT 0;
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS purchase_limit_override INT;

-- Sync tracking
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS last_tx_hash TEXT;
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS synced_at    TIMESTAMPTZ;

-- Index for fast address lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_wallets_address ON customer_wallets(lower(address));

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 3: SEED 7 WAVES (matches contract constructor)
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO nft_waves
  (wave_number, name, quantity, default_price_eth, sale_method, status)
VALUES
  (1, 'Genesis',    303,  0.0000, 'free_mint',      'upcoming'),
  (2, 'Genesis',    303,  0.0303, 'fixed_price',    'upcoming'),
  (3, 'Ascension',  606,  0.0303, 'english_auction','upcoming'),
  (4, 'Odyssey',    909,  0.0606, 'english_auction','upcoming'),
  (5, 'Awakening', 1515,  0.0909, 'english_auction','upcoming'),
  (6, 'Continuum', 2424,  0.1515, 'english_auction','upcoming'),
  (7, 'Eternity',  3939,  0.2424, 'english_auction','upcoming')
ON CONFLICT (wave_number) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 4: STORED FUNCTIONS
-- ══════════════════════════════════════════════════════════════════════

-- ── Collection Config ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_collection_config_get()
RETURNS json
LANGUAGE sql AS $$
  SELECT row_to_json(c) FROM nft_collection_config c WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION nft_collection_config_update(
  p_contract_address       TEXT    DEFAULT NULL,
  p_current_phase          TEXT    DEFAULT NULL,
  p_provenance_hash        TEXT    DEFAULT NULL,
  p_blind_box_uri          TEXT    DEFAULT NULL,
  p_reveal_uri             TEXT    DEFAULT NULL,
  p_reveal_count           INT     DEFAULT NULL,
  p_total_counter          INT     DEFAULT NULL,
  p_treasury_wallet        TEXT    DEFAULT NULL,
  p_royalty_enforced       BOOLEAN DEFAULT NULL,
  p_purchase_limit_enabled BOOLEAN DEFAULT NULL,
  p_normal_max_per_wallet  INT     DEFAULT NULL,
  p_sbt_enabled            BOOLEAN DEFAULT NULL,
  p_synced_at              TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_collection_config SET
    contract_address       = COALESCE(p_contract_address,       contract_address),
    current_phase          = COALESCE(p_current_phase,          current_phase),
    provenance_hash        = COALESCE(p_provenance_hash,        provenance_hash),
    blind_box_uri          = COALESCE(p_blind_box_uri,          blind_box_uri),
    reveal_uri             = COALESCE(p_reveal_uri,             reveal_uri),
    reveal_count           = COALESCE(p_reveal_count,           reveal_count),
    total_counter          = COALESCE(p_total_counter,          total_counter),
    treasury_wallet        = COALESCE(p_treasury_wallet,        treasury_wallet),
    royalty_enforced       = COALESCE(p_royalty_enforced,       royalty_enforced),
    purchase_limit_enabled = COALESCE(p_purchase_limit_enabled, purchase_limit_enabled),
    normal_max_per_wallet  = COALESCE(p_normal_max_per_wallet,  normal_max_per_wallet),
    sbt_enabled            = COALESCE(p_sbt_enabled,            sbt_enabled),
    synced_at              = p_synced_at,
    updated_at             = NOW()
  WHERE id = 1;
  SELECT TRUE;
$$;

-- ── Royalty Config ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_royalty_config_get()
RETURNS json
LANGUAGE sql AS $$
  SELECT row_to_json(r) FROM nft_royalty_config r WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION nft_royalty_config_upsert(
  p_royalty_pct_bps  INT,
  p_receiver_address TEXT,
  p_enforce_royalty  BOOLEAN,
  p_last_tx_hash     TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_royalty_pct_bps < 0 OR p_royalty_pct_bps > 1000 THEN
    RAISE EXCEPTION 'Royalty basis points must be 0–1000 (max 10%%)' USING ERRCODE = 'P0001';
  END IF;
  IF p_receiver_address IS NULL OR trim(p_receiver_address) = '' THEN
    RAISE EXCEPTION 'Receiver address is required' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_royalty_config SET
    royalty_pct_bps  = p_royalty_pct_bps,
    receiver_address = lower(p_receiver_address),
    enforce_royalty  = p_enforce_royalty,
    last_tx_hash     = p_last_tx_hash,
    synced_at        = NOW(),
    updated_at       = NOW()
  WHERE id = 1;
  -- Keep collection_config in sync
  UPDATE nft_collection_config SET royalty_enforced = p_enforce_royalty, updated_at = NOW() WHERE id = 1;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Purchase Limit Config ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_purchase_limit_get()
RETURNS json
LANGUAGE sql AS $$
  SELECT row_to_json(p) FROM nft_purchase_limit_config p WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION nft_purchase_limit_upsert(
  p_limit_enabled        BOOLEAN,
  p_normal_max_per_wallet INT,
  p_last_tx_hash         TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_normal_max_per_wallet < 1 THEN
    RAISE EXCEPTION 'Max per wallet must be at least 1' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_purchase_limit_config SET
    limit_enabled         = p_limit_enabled,
    normal_max_per_wallet = p_normal_max_per_wallet,
    last_tx_hash          = p_last_tx_hash,
    synced_at             = NOW(),
    updated_at            = NOW()
  WHERE id = 1;
  UPDATE nft_collection_config SET
    purchase_limit_enabled = p_limit_enabled,
    normal_max_per_wallet  = p_normal_max_per_wallet,
    updated_at             = NOW()
  WHERE id = 1;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Marketplace Allowlist ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_marketplace_list()
RETURNS TABLE(
  id UUID, address TEXT, name VARCHAR, enabled BOOLEAN, synced_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
  SELECT id, address, name, enabled, synced_at
  FROM nft_allowed_marketplaces
  ORDER BY created_at ASC;
$$;

CREATE OR REPLACE FUNCTION nft_marketplace_upsert(
  p_address      TEXT,
  p_name         VARCHAR,
  p_enabled      BOOLEAN,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_address IS NULL OR trim(p_address) = '' THEN
    RAISE EXCEPTION 'Marketplace address is required' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO nft_allowed_marketplaces (address, name, enabled, last_tx_hash, synced_at)
  VALUES (lower(p_address), p_name, p_enabled, p_last_tx_hash, NOW())
  ON CONFLICT (address) DO UPDATE SET
    name         = EXCLUDED.name,
    enabled      = EXCLUDED.enabled,
    last_tx_hash = EXCLUDED.last_tx_hash,
    synced_at    = NOW(),
    updated_at   = NOW();
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Wave Management ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_wave_get_all()
RETURNS json
LANGUAGE sql AS $$
  SELECT json_agg(
    json_build_object(
      'id',                w.id,
      'waveNum',           w.wave_number,
      'name',              w.name,
      'quantity',          w.quantity,
      'priceEth',          w.default_price_eth,
      'saleMethod',        w.sale_method,
      'scheduledStart',    w.scheduled_start,
      'scheduledEnd',      w.scheduled_end,
      'soldCount',         w.sold_count,
      'priceLocked',       w.price_locked,
      'waveClosed',        w.wave_closed,
      'closeAction',       w.close_action,
      'status',            w.status,
      'auctionListingId',  w.auction_listing_id,
      'syncedAt',          w.synced_at
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;

CREATE OR REPLACE FUNCTION nft_wave_get(p_wave_num INT)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF p_wave_num < 1 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Wave number must be 1–7' USING ERRCODE = 'P0001';
  END IF;
  SELECT json_build_object(
    'id',               w.id,
    'waveNum',          w.wave_number,
    'name',             w.name,
    'quantity',         w.quantity,
    'priceEth',         w.default_price_eth,
    'saleMethod',       w.sale_method,
    'scheduledStart',   w.scheduled_start,
    'scheduledEnd',     w.scheduled_end,
    'soldCount',        w.sold_count,
    'priceLocked',      w.price_locked,
    'waveClosed',       w.wave_closed,
    'closeAction',      w.close_action,
    'status',           w.status,
    'auctionListingId', w.auction_listing_id,
    'syncedAt',         w.synced_at
  ) INTO v_result FROM nft_waves w WHERE w.wave_number = p_wave_num;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Wave % not found', p_wave_num USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_price(
  p_wave_num     INT,
  p_price_eth    NUMERIC,
  p_price_locked BOOLEAN,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  -- Off-chain guard: reject if already locked (on-chain also rejects, but this saves gas)
  IF p_price_locked THEN
    RAISE EXCEPTION 'Wave % price is locked — first sale has already occurred', p_wave_num
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    default_price_eth = p_price_eth,
    price_locked      = FALSE,
    last_tx_hash      = p_last_tx_hash,
    synced_at         = NOW(),
    updated_at        = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_schedule(
  p_wave_num      INT,
  p_start_time    TIMESTAMPTZ,
  p_end_time      TIMESTAMPTZ,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after start time' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    scheduled_start = p_start_time,
    scheduled_end   = p_end_time,
    last_tx_hash    = p_last_tx_hash,
    synced_at       = NOW(),
    updated_at      = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_sold(
  p_wave_num      INT,
  p_sold_count    INT,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_qty INT;
BEGIN
  SELECT quantity INTO v_qty FROM nft_waves WHERE wave_number = p_wave_num;
  UPDATE nft_waves SET
    sold_count   = p_sold_count,
    price_locked = (p_sold_count > 0),
    status       = CASE
                     WHEN p_sold_count >= v_qty THEN 'sold_out'
                     WHEN p_sold_count > 0      THEN 'active'
                     ELSE status
                   END,
    last_tx_hash = p_last_tx_hash,
    synced_at    = NOW(),
    updated_at   = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_closed(
  p_wave_num      INT,
  p_close_action  VARCHAR,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_close_action NOT IN ('treasury', 'burn') THEN
    RAISE EXCEPTION 'close_action must be treasury or burn' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    wave_closed  = TRUE,
    close_action = p_close_action,
    status       = 'closed',
    last_tx_hash = p_last_tx_hash,
    synced_at    = NOW(),
    updated_at   = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_set_auction_listing(
  p_wave_num          INT,
  p_listing_id        VARCHAR,
  p_start_price       NUMERIC,
  p_auction_end_time  TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_wave_num < 3 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Auction listings are only for Waves 3–7' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    auction_listing_id  = p_listing_id,
    auction_start_price = p_start_price,
    auction_end_time    = p_auction_end_time,
    updated_at          = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Customer / VIP ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_wallet_get(p_address TEXT)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',                   cw.id,
    'address',              cw.address,
    'userId',               cw.user_id,
    'isWhitelisted',        cw.is_whitelisted,
    'isVip',                cw.is_vip,
    'wlClaimed',            cw.wl_claimed,
    'walletTotalMinted',    cw.wallet_total_minted,
    'purchaseLimitOverride',cw.purchase_limit_override,
    'syncedAt',             cw.synced_at
  ) INTO v_result
  FROM customer_wallets cw
  WHERE lower(cw.address) = lower(p_address);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wallet_upsert(
  p_address TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, address TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  INSERT INTO customer_wallets (address, user_id)
  VALUES (lower(p_address), p_user_id)
  ON CONFLICT (lower(address)) DO UPDATE SET
    user_id    = COALESCE(EXCLUDED.user_id, customer_wallets.user_id),
    updated_at = NOW()
  RETURNING customer_wallets.id, customer_wallets.address;
EXCEPTION WHEN undefined_column THEN
  -- updated_at may not exist in older schema; ignore
  RETURN QUERY
  INSERT INTO customer_wallets (address, user_id)
  VALUES (lower(p_address), p_user_id)
  ON CONFLICT DO NOTHING
  RETURNING customer_wallets.id, customer_wallets.address;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wallet_set_vip(
  p_address      TEXT,
  p_is_vip       BOOLEAN,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = lower(p_address)) THEN
    INSERT INTO customer_wallets (address, is_vip, last_tx_hash, synced_at)
    VALUES (lower(p_address), p_is_vip, p_last_tx_hash, NOW());
  ELSE
    UPDATE customer_wallets SET
      is_vip       = p_is_vip,
      last_tx_hash = p_last_tx_hash,
      synced_at    = NOW()
    WHERE lower(address) = lower(p_address);
  END IF;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wallet_sync_mint(
  p_address       TEXT,
  p_minted_qty    INT,
  p_wl_claimed    BOOLEAN DEFAULT NULL,
  p_last_tx_hash  TEXT    DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = lower(p_address)) THEN
    INSERT INTO customer_wallets (address, wallet_total_minted, wl_claimed, last_tx_hash, synced_at)
    VALUES (lower(p_address), p_minted_qty, COALESCE(p_wl_claimed, FALSE), p_last_tx_hash, NOW());
  ELSE
    UPDATE customer_wallets SET
      wallet_total_minted = wallet_total_minted + p_minted_qty,
      wl_claimed          = COALESCE(p_wl_claimed, wl_claimed),
      last_tx_hash        = p_last_tx_hash,
      synced_at           = NOW()
    WHERE lower(address) = lower(p_address);
  END IF;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── NFT Records ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_record_sync_mint(
  p_token_id       BIGINT,
  p_owner_address  TEXT,
  p_wave_num       INT,
  p_mint_tx_hash   TEXT,
  p_minted_at      TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_wave_id UUID;
BEGIN
  SELECT id INTO v_wave_id FROM nft_waves WHERE wave_number = p_wave_num;
  -- Update existing record (pre-generated) or insert new one
  IF EXISTS (SELECT 1 FROM nft_records WHERE token_id = p_token_id) THEN
    UPDATE nft_records SET
      owner_address    = lower(p_owner_address),
      wave_id          = v_wave_id,
      on_chain_wave_num= p_wave_num,
      mint_tx_hash     = p_mint_tx_hash,
      minted_at        = p_minted_at,
      synced_at        = NOW()
    WHERE token_id = p_token_id;
  ELSE
    INSERT INTO nft_records (
      token_id, owner_address, wave_id, on_chain_wave_num,
      mint_tx_hash, minted_at, synced_at
    ) VALUES (
      p_token_id, lower(p_owner_address), v_wave_id, p_wave_num,
      p_mint_tx_hash, p_minted_at, NOW()
    );
  END IF;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_record_set_rarity_price(
  p_token_id     BIGINT,
  p_price_eth    NUMERIC,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  -- Off-chain guard: cannot set if already sold to a non-treasury address
  IF EXISTS (
    SELECT 1 FROM nft_records
    WHERE token_id = p_token_id
      AND rarity_price_locked = TRUE
  ) THEN
    RAISE EXCEPTION 'Token % rarity price is locked — already sold to a customer', p_token_id
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_records SET
    rarity_price_eth = p_price_eth,
    last_tx_hash     = p_last_tx_hash,
    synced_at        = NOW()
  WHERE token_id = p_token_id;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_record_sync_transfer(
  p_token_id       BIGINT,
  p_new_owner      TEXT,
  p_sale_price_eth NUMERIC DEFAULT NULL,
  p_last_tx_hash   TEXT    DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_records SET
    owner_address       = lower(p_new_owner),
    last_sale_price_eth = COALESCE(p_sale_price_eth, last_sale_price_eth),
    rarity_price_locked = TRUE,
    last_tx_hash        = p_last_tx_hash,
    synced_at           = NOW()
  WHERE token_id = p_token_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_record_sync_reveal(
  p_is_revealed BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_records SET is_revealed = p_is_revealed, revealed_at = NOW(), synced_at = NOW();
  SELECT TRUE;
$$;

-- ── Contract Event Log ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_event_log(
  p_event_name   VARCHAR,
  p_tx_hash      TEXT,
  p_block_number BIGINT,
  p_log_index    INT,
  p_from_address TEXT    DEFAULT NULL,
  p_to_address   TEXT    DEFAULT NULL,
  p_payload      JSONB   DEFAULT '{}'
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nft_contract_events (
    event_name, tx_hash, block_number, log_index,
    from_address, to_address, payload, processed_at
  ) VALUES (
    p_event_name, p_tx_hash, p_block_number, p_log_index,
    lower(p_from_address), lower(p_to_address), p_payload, NOW()
  )
  ON CONFLICT (tx_hash, log_index) DO NOTHING;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Permissions ───────────────────────────────────────────────────────

INSERT INTO permissions (key, label, module, sort_order) VALUES
  ('nft_sell.view',             'View NFT Selling Dashboard',    'nft_sell', 100),
  ('nft_sell.manage_waves',     'Manage Wave Schedule & Price',  'nft_sell', 101),
  ('nft_sell.manage_royalty',   'Manage Royalty Settings',       'nft_sell', 102),
  ('nft_sell.manage_vip',       'Manage VIP Customers',          'nft_sell', 103),
  ('nft_sell.manage_limits',    'Manage Purchase Limits',        'nft_sell', 104),
  ('nft_sell.manage_markets',   'Manage Marketplace Allowlist',  'nft_sell', 105),
  ('nft_sell.mint_treasury',    'Mint Unsold to Treasury',       'nft_sell', 106),
  ('nft_sell.burn_unsold',      'Burn Unsold NFTs',              'nft_sell', 107),
  ('nft_sell.reveal',           'Trigger Collection Reveal',     'nft_sell', 108),
  ('nft_sell.withdraw',         'Withdraw ETH from Contract',    'nft_sell', 109)
ON CONFLICT (key) DO NOTHING;

-- technical_team → all nft_sell permissions
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'technical_team' AND p.module = 'nft_sell'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin → view + non-destructive permissions only
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'admin'
  AND p.key IN ('nft_sell.view', 'nft_sell.manage_waves', 'nft_sell.manage_vip',
                'nft_sell.manage_limits', 'nft_sell.manage_royalty')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════════════
SELECT 'nft_collection_config'    AS table_name, COUNT(*) AS rows FROM nft_collection_config
UNION ALL SELECT 'nft_royalty_config',      COUNT(*) FROM nft_royalty_config
UNION ALL SELECT 'nft_purchase_limit_config', COUNT(*) FROM nft_purchase_limit_config
UNION ALL SELECT 'nft_allowed_marketplaces', COUNT(*) FROM nft_allowed_marketplaces
UNION ALL SELECT 'nft_contract_events',      COUNT(*) FROM nft_contract_events
UNION ALL SELECT 'nft_waves (seeded)',        COUNT(*) FROM nft_waves;
