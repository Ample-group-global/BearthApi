-- =====================================================================
-- BearthApi — Migration V13: NFT Strategy Integration
-- Integrates 12 non-integrated NFT selling strategies:
--   5. Holder Priority Sale       14. Flash Sale / Time-Limited Drop
--   7. English Auction (Bidding)  15. Subscription / Season Pass
--   8. Membership / Access Pass   16. Burn-to-Mint / Upgrade
--  10. Token-Gated Commerce       18. Physical Event Exclusive
--  12. Tiered Pricing by Rarity   21. Cross-Project Collaboration
--  13. Mystery Box / Pack Sale    22. Artist / Creator Edition
--
-- Run: psql <connection_url> -f migrate_v13_strategies.sql
-- =====================================================================

BEGIN;

-- ── 1. New columns on nft_waves ───────────────────────────────────────

-- Strategy 5: Holder Priority Sale — per-wave allowlist root + priority window
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS wave_merkle_root      TEXT;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS holder_priority_start TIMESTAMPTZ;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS holder_priority_end   TIMESTAMPTZ;

-- Strategy 12: Tiered Pricing by Rarity — per-wave default prices per rarity
-- Format: {"legendary": 0.5, "epic": 0.2, "rare": 0.08, "common": 0.03}
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS tier_prices JSONB;

-- Strategy 14: Flash Sale / Time-Limited Drop
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS is_flash_sale     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS flash_discount_pct NUMERIC(5,2);

-- Strategy 15: Subscription / Season Pass — link wave to a season
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS season_id UUID;

-- Strategy 21: Cross-Project Collaboration — link wave to a collaboration
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS collaboration_id UUID;

-- Strategy 22: Artist / Creator Edition — artist info per wave
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS artist_name        VARCHAR(200);
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS artist_wallet      VARCHAR(42);
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS artist_royalty_bps INT;       -- 0-1000
ALTER TABLE nft_waves ADD COLUMN IF NOT EXISTS is_artist_edition  BOOLEAN    NOT NULL DEFAULT FALSE;

-- ── 2. New columns on nft_records ────────────────────────────────────

-- Strategy 16: Burn-to-Mint / Upgrade
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS is_burned      BOOLEAN  NOT NULL DEFAULT FALSE;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS burned_at      TIMESTAMPTZ;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS burn_tx_hash   TEXT;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS upgraded_from  UUID[];   -- IDs of NFTs burned to create this

-- Strategy 18: Physical Event Exclusive
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS event_id UUID;  -- FK to nft_events added below

-- ── 3. New tables (in dependency order) ──────────────────────────────

-- Strategy 8 + 10: Membership / Access Pass + Token-Gated Commerce
CREATE TABLE IF NOT EXISTS nft_membership_tiers (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(100) NOT NULL,
  tier_level             INT         NOT NULL,         -- 1=bronze 2=silver 3=gold 4=platinum
  qualifying_wave_number INT,                          -- NULL = any wave qualifies
  qualifying_rarity_tier VARCHAR(20),                 -- legendary/epic/rare/common/NULL=any
  min_tokens_held        INT         NOT NULL DEFAULT 1,
  discount_pct           NUMERIC(5,2) NOT NULL DEFAULT 0,
  benefits               JSONB,                        -- ["20% off products","Early wave access"]
  priority_whitelist_slot INT,                         -- slot order in next wave whitelist
  is_active              BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order             INT         NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strategy 18: Physical Event Exclusive
CREATE TABLE IF NOT EXISTS nft_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  event_date    DATE        NOT NULL,
  location      VARCHAR(300),
  wave_id       UUID        REFERENCES nft_waves(id) ON DELETE SET NULL,
  max_attendees INT,
  notes         TEXT,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nft_event_checkins (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES nft_events(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  customer_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  is_eligible    BOOLEAN     NOT NULL DEFAULT TRUE,
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  UNIQUE(event_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event ON nft_event_checkins(event_id);

-- Strategy 15: Subscription / Season Pass
CREATE TABLE IF NOT EXISTS nft_seasons (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  code         VARCHAR(50)  NOT NULL,
  wave_numbers INT[]        NOT NULL DEFAULT '{}',   -- e.g. {1,2,3,4}
  price_eth    NUMERIC(18,8) NOT NULL,
  price_twd    NUMERIC(18,2),
  discount_pct NUMERIC(5,2),
  status       VARCHAR(20)  NOT NULL DEFAULT 'upcoming',  -- upcoming/active/closed
  sale_start   TIMESTAMPTZ,
  sale_end     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(code)
);

CREATE TABLE IF NOT EXISTS nft_season_pass_holders (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID        NOT NULL REFERENCES nft_seasons(id) ON DELETE CASCADE,
  customer_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address        VARCHAR(42) NOT NULL,
  pass_serial           VARCHAR(50) NOT NULL,           -- "SP-2026-001"
  nft_token_id          BIGINT,                         -- on-chain token ID of the pass NFT
  mint_tx_hash          TEXT,
  amount_paid_eth       NUMERIC(18,8),
  amount_paid_twd       NUMERIC(18,2),
  redeemed_wave_numbers INT[]        NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(pass_serial),
  UNIQUE(season_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_season_pass_season ON nft_season_pass_holders(season_id);

-- Strategy 13: Mystery Box / Pack Sale (commit-reveal randomness)
CREATE TABLE IF NOT EXISTS nft_pack_definitions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(100) NOT NULL,
  wave_id            UUID         REFERENCES nft_waves(id) ON DELETE SET NULL,
  pack_size          INT          NOT NULL DEFAULT 3,
  rarity_composition JSONB        NOT NULL DEFAULT '[]',
  -- e.g. [{"rarity":"common","count":2},{"rarity":"rare","count":1}]
  bonus_chance_pct   NUMERIC(5,2),   -- % chance of 1 rarity upgrade per pack
  price_eth          NUMERIC(18,8) NOT NULL,
  price_twd          NUMERIC(18,2),
  randomness_seed    TEXT,            -- revealed after sale closes
  commitment_hash    TEXT,            -- SHA256(seed) committed before sale opens
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nft_pack_orders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_def_id      UUID        NOT NULL REFERENCES nft_pack_definitions(id) ON DELETE CASCADE,
  order_id         UUID        REFERENCES orders(id) ON DELETE SET NULL,
  pack_index       INT         NOT NULL,   -- sequential index; used for seed+index reveal
  assigned_nft_ids UUID[]      DEFAULT '{}',
  revealed         BOOLEAN     NOT NULL DEFAULT FALSE,
  revealed_at      TIMESTAMPTZ,
  buyer_wallet     VARCHAR(42) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pack_orders_def ON nft_pack_orders(pack_def_id);

-- Strategy 16: Burn-to-Mint / Upgrade
CREATE TABLE IF NOT EXISTS nft_burn_ratios (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_rarity VARCHAR(20) NOT NULL,
  to_rarity   VARCHAR(20) NOT NULL,
  burn_count  INT         NOT NULL DEFAULT 3,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_rarity, to_rarity)
);

-- Seed default burn ratios
INSERT INTO nft_burn_ratios (from_rarity, to_rarity, burn_count) VALUES
  ('common',    'rare',      3),
  ('rare',      'epic',      3),
  ('epic',      'legendary', 3)
ON CONFLICT (from_rarity, to_rarity) DO NOTHING;

-- Strategy 21: Cross-Project Collaboration
CREATE TABLE IF NOT EXISTS nft_collaborations (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     VARCHAR(200) NOT NULL,
  partner_name             VARCHAR(200) NOT NULL,
  partner_contract_address VARCHAR(42),
  wave_id                  UUID         REFERENCES nft_waves(id) ON DELETE SET NULL,
  discount_pct             NUMERIC(5,2) NOT NULL DEFAULT 0,
  priority_hours           INT          NOT NULL DEFAULT 24,
  status                   VARCHAR(20)  NOT NULL DEFAULT 'upcoming', -- upcoming/active/closed
  created_by               UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nft_collaboration_wallets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  collaboration_id UUID        NOT NULL REFERENCES nft_collaborations(id) ON DELETE CASCADE,
  wallet_address   VARCHAR(42) NOT NULL,
  is_eligible      BOOLEAN     NOT NULL DEFAULT TRUE,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(collaboration_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_collab_wallets_collab ON nft_collaboration_wallets(collaboration_id);

-- Strategy 7: English Auction — tracks BearthAuction.sol and OpenSea auction sessions
CREATE TABLE IF NOT EXISTS nft_auction_sessions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_number       INT,                      -- for wave-mode auctions
  token_id          BIGINT,                   -- for token-mode auctions
  auction_mode      VARCHAR(10)  NOT NULL DEFAULT 'wave',  -- 'wave' or 'token'
  platform          VARCHAR(20)  NOT NULL DEFAULT 'bearth', -- 'bearth' or 'opensea'
  contract_address  VARCHAR(42),              -- BearthAuction contract
  opensea_listing_id VARCHAR(200),
  start_price_eth   NUMERIC(18,8),
  reserve_price_eth NUMERIC(18,8),
  current_bid_eth   NUMERIC(18,8),
  current_bidder    VARCHAR(42),
  auction_end_time  TIMESTAMPTZ,
  winner_wallet     VARCHAR(42),
  winning_bid_eth   NUMERIC(18,8),
  status            VARCHAR(20)  NOT NULL DEFAULT 'upcoming',
  -- upcoming / active / settled / cancelled
  settlement_tx_hash TEXT,
  settled_at        TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auction_sessions_wave   ON nft_auction_sessions(wave_number);
CREATE INDEX IF NOT EXISTS idx_auction_sessions_status ON nft_auction_sessions(status);

-- ── 4. FK constraints (added after tables created) ───────────────────

-- nft_waves → nft_seasons + nft_collaborations (added after those tables)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wave_season') THEN
    ALTER TABLE nft_waves ADD CONSTRAINT fk_wave_season
      FOREIGN KEY (season_id) REFERENCES nft_seasons(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wave_collab') THEN
    ALTER TABLE nft_waves ADD CONSTRAINT fk_wave_collab
      FOREIGN KEY (collaboration_id) REFERENCES nft_collaborations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_record_event') THEN
    ALTER TABLE nft_records ADD CONSTRAINT fk_record_event
      FOREIGN KEY (event_id) REFERENCES nft_events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 5. Stored functions ───────────────────────────────────────────────

-- ─────────────────────────────────────────
-- MEMBERSHIP TIERS (Strategies 8 + 10)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_membership_tiers_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.sort_order, t.tier_level), '[]')
  FROM (
    SELECT id, name, tier_level, qualifying_wave_number, qualifying_rarity_tier,
           min_tokens_held, discount_pct, benefits, priority_whitelist_slot,
           is_active, sort_order, created_at, updated_at
    FROM nft_membership_tiers
    WHERE is_active = TRUE
  ) t;
$$;

CREATE OR REPLACE FUNCTION nft_membership_tier_upsert(
  p_id                     UUID,
  p_name                   VARCHAR,
  p_tier_level             INT,
  p_qualifying_wave_number INT,
  p_qualifying_rarity_tier VARCHAR,
  p_min_tokens_held        INT,
  p_discount_pct           NUMERIC,
  p_benefits               JSONB,
  p_priority_whitelist_slot INT,
  p_is_active              BOOLEAN,
  p_sort_order             INT
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_membership_tiers SET
      name                   = p_name,
      tier_level             = p_tier_level,
      qualifying_wave_number = p_qualifying_wave_number,
      qualifying_rarity_tier = p_qualifying_rarity_tier,
      min_tokens_held        = p_min_tokens_held,
      discount_pct           = p_discount_pct,
      benefits               = p_benefits,
      priority_whitelist_slot = p_priority_whitelist_slot,
      is_active              = p_is_active,
      sort_order             = p_sort_order,
      updated_at             = NOW()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_membership_tiers (name, tier_level, qualifying_wave_number,
      qualifying_rarity_tier, min_tokens_held, discount_pct, benefits,
      priority_whitelist_slot, is_active, sort_order)
    VALUES (p_name, p_tier_level, p_qualifying_wave_number, p_qualifying_rarity_tier,
      p_min_tokens_held, p_discount_pct, p_benefits, p_priority_whitelist_slot,
      p_is_active, p_sort_order)
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION nft_membership_tier_delete(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  DELETE FROM nft_membership_tiers WHERE id = p_id;
$$;

-- Verify wallet membership: counts NFTs held, finds best matching tier
CREATE OR REPLACE FUNCTION nft_membership_wallet_verify(p_wallet TEXT)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet_lower TEXT := LOWER(p_wallet);
  v_tokens_held  INT;
  v_result       JSON;
BEGIN
  -- Count NFTs from nft_records owned by this wallet
  SELECT COUNT(*) INTO v_tokens_held
  FROM nft_records
  WHERE LOWER(owner_address) = v_wallet_lower AND is_burned = FALSE;

  -- Find best tier: highest tier_level where conditions are met
  SELECT json_build_object(
    'wallet',       p_wallet,
    'tokens_held',  v_tokens_held,
    'tier_id',      t.id,
    'tier_name',    t.name,
    'tier_level',   t.tier_level,
    'discount_pct', t.discount_pct,
    'benefits',     t.benefits
  ) INTO v_result
  FROM nft_membership_tiers t
  WHERE t.is_active = TRUE
    AND v_tokens_held >= t.min_tokens_held
    AND (t.qualifying_rarity_tier IS NULL OR EXISTS (
      SELECT 1 FROM nft_records r
      WHERE LOWER(r.owner_address) = v_wallet_lower
        AND r.rarity_tier = t.qualifying_rarity_tier
        AND r.is_burned = FALSE
    ))
  ORDER BY t.tier_level DESC
  LIMIT 1;

  IF v_result IS NULL THEN
    v_result := json_build_object(
      'wallet', p_wallet, 'tokens_held', v_tokens_held,
      'tier_id', null, 'tier_name', null, 'tier_level', 0,
      'discount_pct', 0, 'benefits', '[]'::json
    );
  END IF;
  RETURN v_result;
END $$;

-- ─────────────────────────────────────────
-- EVENTS (Strategy 18)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_events_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(e) ORDER BY e.event_date DESC), '[]')
  FROM (
    SELECT ev.id, ev.name, ev.event_date, ev.location, ev.wave_id,
           ev.max_attendees, ev.notes, ev.created_at,
           (SELECT COUNT(*) FROM nft_event_checkins c WHERE c.event_id = ev.id) AS checkin_count
    FROM nft_events ev
  ) e;
$$;

CREATE OR REPLACE FUNCTION nft_event_upsert(
  p_id           UUID,
  p_name         VARCHAR,
  p_event_date   DATE,
  p_location     VARCHAR,
  p_wave_id      UUID,
  p_max_attendees INT,
  p_notes        TEXT,
  p_created_by   UUID
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_events SET
      name = p_name, event_date = p_event_date, location = p_location,
      wave_id = p_wave_id, max_attendees = p_max_attendees, notes = p_notes
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_events (name, event_date, location, wave_id, max_attendees, notes, created_by)
    VALUES (p_name, p_event_date, p_location, p_wave_id, p_max_attendees, p_notes, p_created_by)
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION nft_event_delete(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  DELETE FROM nft_events WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION nft_event_checkins_list(p_event_id UUID)
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(c) ORDER BY c.checked_in_at DESC), '[]')
  FROM (
    SELECT ec.id, ec.event_id, ec.wallet_address, ec.customer_id,
           ec.is_eligible, ec.checked_in_at, ec.notes,
           u.first_name || ' ' || u.last_name AS customer_name
    FROM nft_event_checkins ec
    LEFT JOIN users u ON u.id = ec.customer_id
    WHERE ec.event_id = p_event_id
  ) c;
$$;

CREATE OR REPLACE FUNCTION nft_event_checkin_add(
  p_event_id      UUID,
  p_wallet        VARCHAR,
  p_customer_id   UUID,
  p_registered_by UUID,
  p_notes         TEXT
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO nft_event_checkins (event_id, wallet_address, customer_id, registered_by, notes)
  VALUES (p_event_id, LOWER(p_wallet), p_customer_id, p_registered_by, p_notes)
  ON CONFLICT (event_id, wallet_address) DO UPDATE
    SET is_eligible = TRUE, notes = EXCLUDED.notes, checked_in_at = NOW()
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END $$;

-- Tag NFT records with an event (marks batch as event-exclusive)
CREATE OR REPLACE FUNCTION nft_event_tag_records(p_event_id UUID, p_record_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  UPDATE nft_records SET event_id = p_event_id
  WHERE id = ANY(p_record_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('tagged', v_count);
END $$;

-- ─────────────────────────────────────────
-- SEASONS (Strategy 15)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_seasons_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.created_at DESC), '[]')
  FROM (
    SELECT se.id, se.name, se.code, se.wave_numbers, se.price_eth, se.price_twd,
           se.discount_pct, se.status, se.sale_start, se.sale_end, se.created_at,
           (SELECT COUNT(*) FROM nft_season_pass_holders h WHERE h.season_id = se.id) AS pass_count
    FROM nft_seasons se
  ) s;
$$;

CREATE OR REPLACE FUNCTION nft_season_upsert(
  p_id           UUID,
  p_name         VARCHAR,
  p_code         VARCHAR,
  p_wave_numbers INT[],
  p_price_eth    NUMERIC,
  p_price_twd    NUMERIC,
  p_discount_pct NUMERIC,
  p_status       VARCHAR,
  p_sale_start   TIMESTAMPTZ,
  p_sale_end     TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_seasons SET
      name = p_name, code = p_code, wave_numbers = p_wave_numbers,
      price_eth = p_price_eth, price_twd = p_price_twd,
      discount_pct = p_discount_pct, status = p_status,
      sale_start = p_sale_start, sale_end = p_sale_end
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_seasons (name, code, wave_numbers, price_eth, price_twd,
      discount_pct, status, sale_start, sale_end)
    VALUES (p_name, p_code, p_wave_numbers, p_price_eth, p_price_twd,
      p_discount_pct, p_status, p_sale_start, p_sale_end)
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION nft_season_pass_holders_list(p_season_id UUID)
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(h) ORDER BY h.created_at DESC), '[]')
  FROM (
    SELECT sp.id, sp.season_id, sp.customer_id, sp.wallet_address,
           sp.pass_serial, sp.nft_token_id, sp.mint_tx_hash,
           sp.amount_paid_eth, sp.amount_paid_twd,
           sp.redeemed_wave_numbers, sp.created_at,
           u.first_name || ' ' || u.last_name AS customer_name,
           u.email AS customer_email
    FROM nft_season_pass_holders sp
    LEFT JOIN users u ON u.id = sp.customer_id
    WHERE sp.season_id = p_season_id
  ) h;
$$;

CREATE OR REPLACE FUNCTION nft_season_pass_issue(
  p_season_id    UUID,
  p_customer_id  UUID,
  p_wallet       VARCHAR,
  p_pass_serial  VARCHAR,
  p_amount_eth   NUMERIC,
  p_amount_twd   NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO nft_season_pass_holders
    (season_id, customer_id, wallet_address, pass_serial, amount_paid_eth, amount_paid_twd)
  VALUES
    (p_season_id, p_customer_id, LOWER(p_wallet), p_pass_serial, p_amount_eth, p_amount_twd)
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id, 'pass_serial', p_pass_serial);
END $$;

CREATE OR REPLACE FUNCTION nft_season_pass_set_token(
  p_pass_id    UUID,
  p_token_id   BIGINT,
  p_tx_hash    TEXT
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_season_pass_holders
  SET nft_token_id = p_token_id, mint_tx_hash = p_tx_hash
  WHERE id = p_pass_id;
$$;

CREATE OR REPLACE FUNCTION nft_season_pass_redeem(
  p_pass_id     UUID,
  p_wave_number INT
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_redeemed INT[];
  v_season_waves INT[];
BEGIN
  -- Get current state
  SELECT sp.redeemed_wave_numbers, se.wave_numbers
  INTO v_redeemed, v_season_waves
  FROM nft_season_pass_holders sp
  JOIN nft_seasons se ON se.id = sp.season_id
  WHERE sp.id = p_pass_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season pass not found';
  END IF;
  IF NOT (p_wave_number = ANY(v_season_waves)) THEN
    RAISE EXCEPTION 'Wave % is not part of this season', p_wave_number;
  END IF;
  IF p_wave_number = ANY(v_redeemed) THEN
    RAISE EXCEPTION 'Wave % already redeemed for this pass', p_wave_number;
  END IF;

  UPDATE nft_season_pass_holders
  SET redeemed_wave_numbers = array_append(redeemed_wave_numbers, p_wave_number)
  WHERE id = p_pass_id;

  RETURN json_build_object('ok', TRUE, 'wave_redeemed', p_wave_number);
END $$;

-- ─────────────────────────────────────────
-- PACKS (Strategy 13)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_pack_defs_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.created_at DESC), '[]')
  FROM (
    SELECT pd.id, pd.name, pd.wave_id, pd.pack_size, pd.rarity_composition,
           pd.bonus_chance_pct, pd.price_eth, pd.price_twd,
           CASE WHEN pd.commitment_hash IS NOT NULL THEN TRUE ELSE FALSE END AS is_committed,
           CASE WHEN pd.randomness_seed IS NOT NULL THEN TRUE ELSE FALSE END AS is_revealed,
           pd.is_active, pd.created_at,
           (SELECT COUNT(*) FROM nft_pack_orders po WHERE po.pack_def_id = pd.id) AS order_count
    FROM nft_pack_definitions pd
  ) p;
$$;

CREATE OR REPLACE FUNCTION nft_pack_def_upsert(
  p_id                 UUID,
  p_name               VARCHAR,
  p_wave_id            UUID,
  p_pack_size          INT,
  p_rarity_composition JSONB,
  p_bonus_chance_pct   NUMERIC,
  p_price_eth          NUMERIC,
  p_price_twd          NUMERIC,
  p_is_active          BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_pack_definitions SET
      name = p_name, wave_id = p_wave_id, pack_size = p_pack_size,
      rarity_composition = p_rarity_composition, bonus_chance_pct = p_bonus_chance_pct,
      price_eth = p_price_eth, price_twd = p_price_twd, is_active = p_is_active
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_pack_definitions
      (name, wave_id, pack_size, rarity_composition, bonus_chance_pct, price_eth, price_twd, is_active)
    VALUES
      (p_name, p_wave_id, p_pack_size, p_rarity_composition, p_bonus_chance_pct,
       p_price_eth, p_price_twd, p_is_active)
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION nft_pack_def_commit(p_id UUID, p_commitment_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM nft_pack_definitions WHERE id = p_id AND randomness_seed IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change commitment after seed is already revealed';
  END IF;
  UPDATE nft_pack_definitions SET commitment_hash = p_commitment_hash WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION nft_pack_orders_list(p_pack_def_id UUID)
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(o) ORDER BY o.pack_index ASC), '[]')
  FROM (
    SELECT id, pack_def_id, order_id, pack_index,
           assigned_nft_ids, revealed, revealed_at, buyer_wallet, created_at
    FROM nft_pack_orders
    WHERE pack_def_id = p_pack_def_id
  ) o;
$$;

CREATE OR REPLACE FUNCTION nft_pack_order_create(
  p_pack_def_id  UUID,
  p_order_id     UUID,
  p_buyer_wallet VARCHAR
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_id         UUID;
  v_pack_index INT;
BEGIN
  -- Auto-assign next sequential pack_index
  SELECT COALESCE(MAX(pack_index), 0) + 1 INTO v_pack_index
  FROM nft_pack_orders WHERE pack_def_id = p_pack_def_id;

  INSERT INTO nft_pack_orders (pack_def_id, order_id, pack_index, buyer_wallet)
  VALUES (p_pack_def_id, p_order_id, v_pack_index, LOWER(p_buyer_wallet))
  RETURNING id INTO v_id;

  RETURN json_build_object('id', v_id, 'pack_index', v_pack_index);
END $$;

-- Reveal: store seed + assign NFT IDs to each pack order
-- Assignment: for each pack_order, pick NFT IDs from available pool
-- based on rarity_composition. The seed is used for auditability.
CREATE OR REPLACE FUNCTION nft_pack_reveal(p_pack_def_id UUID, p_seed TEXT, p_seed_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_stored_hash TEXT;
  v_order       RECORD;
  v_comp        JSONB;
  v_rarity      TEXT;
  v_count       INT;
  v_nft_ids     UUID[] := '{}';
  v_nft_id      UUID;
  v_revealed    INT := 0;
BEGIN
  SELECT commitment_hash, rarity_composition INTO v_stored_hash, v_comp
  FROM nft_pack_definitions WHERE id = p_pack_def_id;

  IF v_stored_hash IS NULL THEN
    RAISE EXCEPTION 'No commitment hash found — commit seed hash before revealing';
  END IF;
  IF v_stored_hash != p_seed_hash THEN
    RAISE EXCEPTION 'Seed hash does not match committed hash. Seed is invalid.';
  END IF;
  IF EXISTS (SELECT 1 FROM nft_pack_definitions WHERE id = p_pack_def_id AND randomness_seed IS NOT NULL) THEN
    RAISE EXCEPTION 'Pack already revealed';
  END IF;

  -- Store the revealed seed
  UPDATE nft_pack_definitions SET randomness_seed = p_seed WHERE id = p_pack_def_id;

  -- Assign NFTs to each pack order from available pool (FIFO by rarity)
  FOR v_order IN
    SELECT * FROM nft_pack_orders
    WHERE pack_def_id = p_pack_def_id AND revealed = FALSE
    ORDER BY pack_index ASC
  LOOP
    v_nft_ids := '{}';

    -- For each rarity slot in the composition, grab one available NFT
    FOR i IN 0..(jsonb_array_length(v_comp)-1) LOOP
      v_rarity := v_comp->i->>'rarity';
      v_count  := (v_comp->i->>'count')::INT;

      FOR j IN 1..v_count LOOP
        SELECT id INTO v_nft_id
        FROM nft_records
        WHERE rarity_tier = v_rarity
          AND is_burned = FALSE
          AND delivery_status_id IS NULL   -- not yet assigned to an order
          AND id != ALL(v_nft_ids)
        ORDER BY serial_number
        LIMIT 1;

        IF v_nft_id IS NOT NULL THEN
          v_nft_ids := array_append(v_nft_ids, v_nft_id);
        END IF;
      END LOOP;
    END LOOP;

    UPDATE nft_pack_orders
    SET assigned_nft_ids = v_nft_ids, revealed = TRUE, revealed_at = NOW()
    WHERE id = v_order.id;

    v_revealed := v_revealed + 1;
  END LOOP;

  RETURN json_build_object('ok', TRUE, 'packs_revealed', v_revealed, 'seed', p_seed);
END $$;

-- ─────────────────────────────────────────
-- BURN-TO-MINT (Strategy 16)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_burn_ratios_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.from_rarity), '[]')
  FROM (
    SELECT id, from_rarity, to_rarity, burn_count, is_active, created_at
    FROM nft_burn_ratios
  ) r;
$$;

CREATE OR REPLACE FUNCTION nft_burn_ratio_upsert(
  p_from_rarity VARCHAR,
  p_to_rarity   VARCHAR,
  p_burn_count  INT,
  p_is_active   BOOLEAN
)
RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO nft_burn_ratios (from_rarity, to_rarity, burn_count, is_active)
  VALUES (p_from_rarity, p_to_rarity, p_burn_count, p_is_active)
  ON CONFLICT (from_rarity, to_rarity) DO UPDATE
  SET burn_count = EXCLUDED.burn_count, is_active = EXCLUDED.is_active;
$$;

CREATE OR REPLACE FUNCTION nft_records_mark_burned(p_ids UUID[], p_tx_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  UPDATE nft_records
  SET is_burned = TRUE, burned_at = NOW(), burn_tx_hash = p_tx_hash
  WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('burned', v_count);
END $$;

CREATE OR REPLACE FUNCTION nft_record_mark_upgraded(
  p_new_record_id UUID,
  p_burned_ids    UUID[],
  p_tx_hash       TEXT
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_records
  SET upgraded_from = p_burned_ids, burn_tx_hash = p_tx_hash
  WHERE id = p_new_record_id;
$$;

CREATE OR REPLACE FUNCTION nft_burn_history_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(b) ORDER BY b.burned_at DESC), '[]')
  FROM (
    SELECT id, serial_number, rarity_tier, is_burned, burned_at,
           burn_tx_hash, upgraded_from, token_id, owner_address
    FROM nft_records
    WHERE is_burned = TRUE
    ORDER BY burned_at DESC
    LIMIT 200
  ) b;
$$;

-- ─────────────────────────────────────────
-- COLLABORATIONS (Strategy 21)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_collaborations_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(c) ORDER BY c.created_at DESC), '[]')
  FROM (
    SELECT co.id, co.name, co.partner_name, co.partner_contract_address,
           co.wave_id, co.discount_pct, co.priority_hours, co.status, co.created_at,
           (SELECT COUNT(*) FROM nft_collaboration_wallets cw WHERE cw.collaboration_id = co.id) AS wallet_count
    FROM nft_collaborations co
  ) c;
$$;

CREATE OR REPLACE FUNCTION nft_collaboration_upsert(
  p_id                       UUID,
  p_name                     VARCHAR,
  p_partner_name             VARCHAR,
  p_partner_contract_address VARCHAR,
  p_wave_id                  UUID,
  p_discount_pct             NUMERIC,
  p_priority_hours           INT,
  p_status                   VARCHAR,
  p_created_by               UUID
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_collaborations SET
      name = p_name, partner_name = p_partner_name,
      partner_contract_address = p_partner_contract_address,
      wave_id = p_wave_id, discount_pct = p_discount_pct,
      priority_hours = p_priority_hours, status = p_status
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_collaborations
      (name, partner_name, partner_contract_address, wave_id,
       discount_pct, priority_hours, status, created_by)
    VALUES
      (p_name, p_partner_name, p_partner_contract_address, p_wave_id,
       p_discount_pct, p_priority_hours, p_status, p_created_by)
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION nft_collaboration_delete(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  DELETE FROM nft_collaborations WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION nft_collaboration_wallets_list(p_collab_id UUID)
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(w) ORDER BY w.added_at DESC), '[]')
  FROM (
    SELECT id, collaboration_id, wallet_address, is_eligible, added_at
    FROM nft_collaboration_wallets
    WHERE collaboration_id = p_collab_id
  ) w;
$$;

-- Bulk import partner wallets (ignores duplicates)
CREATE OR REPLACE FUNCTION nft_collaboration_wallets_import(
  p_collab_id UUID,
  p_wallets   TEXT[]
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet TEXT;
  v_added  INT := 0;
BEGIN
  FOREACH v_wallet IN ARRAY p_wallets LOOP
    IF v_wallet IS NOT NULL AND LENGTH(TRIM(v_wallet)) > 0 THEN
      INSERT INTO nft_collaboration_wallets (collaboration_id, wallet_address)
      VALUES (p_collab_id, LOWER(TRIM(v_wallet)))
      ON CONFLICT (collaboration_id, wallet_address) DO NOTHING;
      IF FOUND THEN v_added := v_added + 1; END IF;
    END IF;
  END LOOP;
  RETURN json_build_object('added', v_added);
END $$;

-- ─────────────────────────────────────────
-- AUCTION SESSIONS (Strategy 7)
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_auction_sessions_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]')
  FROM (
    SELECT id, wave_number, token_id, auction_mode, platform,
           contract_address, opensea_listing_id,
           start_price_eth, reserve_price_eth, current_bid_eth, current_bidder,
           auction_end_time, winner_wallet, winning_bid_eth, status,
           settlement_tx_hash, settled_at, notes, created_at, updated_at
    FROM nft_auction_sessions
  ) a;
$$;

CREATE OR REPLACE FUNCTION nft_auction_session_upsert(
  p_id                UUID,
  p_wave_number       INT,
  p_token_id          BIGINT,
  p_auction_mode      VARCHAR,
  p_platform          VARCHAR,
  p_contract_address  VARCHAR,
  p_opensea_listing_id VARCHAR,
  p_start_price_eth   NUMERIC,
  p_reserve_price_eth NUMERIC,
  p_auction_end_time  TIMESTAMPTZ,
  p_notes             TEXT
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE nft_auction_sessions SET
      wave_number = p_wave_number, token_id = p_token_id,
      auction_mode = p_auction_mode, platform = p_platform,
      contract_address = p_contract_address,
      opensea_listing_id = p_opensea_listing_id,
      start_price_eth = p_start_price_eth,
      reserve_price_eth = p_reserve_price_eth,
      auction_end_time = p_auction_end_time,
      notes = p_notes, updated_at = NOW()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO nft_auction_sessions
      (wave_number, token_id, auction_mode, platform, contract_address,
       opensea_listing_id, start_price_eth, reserve_price_eth, auction_end_time, notes)
    VALUES
      (p_wave_number, p_token_id, p_auction_mode, p_platform, p_contract_address,
       p_opensea_listing_id, p_start_price_eth, p_reserve_price_eth, p_auction_end_time, p_notes)
    RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION nft_auction_session_sync_bid(
  p_id            UUID,
  p_bid_eth       NUMERIC,
  p_bidder_wallet VARCHAR
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_auction_sessions
  SET current_bid_eth = p_bid_eth, current_bidder = p_bidder_wallet,
      status = 'active', updated_at = NOW()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION nft_auction_session_settle(
  p_id              UUID,
  p_winner_wallet   VARCHAR,
  p_winning_bid_eth NUMERIC,
  p_tx_hash         TEXT
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_auction_sessions
  SET winner_wallet = p_winner_wallet, winning_bid_eth = p_winning_bid_eth,
      settlement_tx_hash = p_tx_hash, status = 'settled',
      settled_at = NOW(), updated_at = NOW()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION nft_auction_session_delete(p_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_auction_sessions SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_id AND status = 'upcoming';
$$;

-- ─────────────────────────────────────────
-- WAVE EXTENSIONS
-- ─────────────────────────────────────────

-- Strategy 5: Holder Priority — update priority window in DB
CREATE OR REPLACE FUNCTION nft_wave_update_holder_priority(
  p_wave_num INT,
  p_start    TIMESTAMPTZ,
  p_end      TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves
  SET holder_priority_start = p_start, holder_priority_end = p_end
  WHERE wave_number = p_wave_num;
$$;

-- Store wave merkle root (used after building Merkle from holder/collab wallets)
CREATE OR REPLACE FUNCTION nft_wave_set_merkle_root(p_wave_num INT, p_root TEXT)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves SET wave_merkle_root = p_root WHERE wave_number = p_wave_num;
$$;

-- Strategy 5: Holder snapshot — returns distinct owner addresses from previous waves
CREATE OR REPLACE FUNCTION nft_holder_snapshot(p_up_to_wave_num INT)
RETURNS TEXT[]
LANGUAGE sql AS $$
  SELECT ARRAY_AGG(DISTINCT LOWER(owner_address))
  FROM nft_records
  WHERE on_chain_wave_num < p_up_to_wave_num
    AND owner_address IS NOT NULL
    AND is_burned = FALSE;
$$;

-- Strategy 12: Tiered Pricing — store per-rarity defaults on wave
CREATE OR REPLACE FUNCTION nft_wave_update_tier_prices(
  p_wave_num   INT,
  p_tier_prices JSONB
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves SET tier_prices = p_tier_prices WHERE wave_number = p_wave_num;
$$;

-- Strategy 14: Flash Sale
CREATE OR REPLACE FUNCTION nft_wave_update_flash_sale(
  p_wave_num    INT,
  p_is_flash    BOOLEAN,
  p_discount_pct NUMERIC
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves
  SET is_flash_sale = p_is_flash, flash_discount_pct = p_discount_pct
  WHERE wave_number = p_wave_num;
$$;

-- Strategy 22: Artist Edition
CREATE OR REPLACE FUNCTION nft_wave_update_artist_config(
  p_wave_num    INT,
  p_name        VARCHAR,
  p_wallet      VARCHAR,
  p_royalty_bps INT,
  p_is_edition  BOOLEAN
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves
  SET artist_name = p_name, artist_wallet = p_wallet,
      artist_royalty_bps = p_royalty_bps, is_artist_edition = p_is_edition
  WHERE wave_number = p_wave_num;
$$;

-- Strategy 15: Link wave to season
CREATE OR REPLACE FUNCTION nft_wave_set_season(p_wave_num INT, p_season_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves SET season_id = p_season_id WHERE wave_number = p_wave_num;
$$;

-- Strategy 21: Link wave to collaboration
CREATE OR REPLACE FUNCTION nft_wave_set_collaboration(p_wave_num INT, p_collab_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE nft_waves SET collaboration_id = p_collab_id WHERE wave_number = p_wave_num;
$$;

-- ── 6. Menu entries for new pages ────────────────────────────────────

-- Add NFT-sell menus (uses module='nft_sell' to match existing permission structure)
INSERT INTO menus (label, href, icon, module, sort_order) VALUES
  ('Auctions',       '/nft/auctions',       'gavel',     'nft_sell', 105),
  ('Membership',     '/nft/membership',     'badge',      'nft_sell', 110),
  ('Events',         '/nft/events',         'calendar',   'nft_sell', 115),
  ('Seasons',        '/nft/seasons',        'ticket',     'nft_sell', 120),
  ('Packs',          '/nft/packs',          'package',    'nft_sell', 125),
  ('Burn to Mint',   '/nft/burn',           'flame',      'nft_sell', 130),
  ('Collaborations', '/nft/collaborations', 'handshake',  'nft_sell', 135)
ON CONFLICT DO NOTHING;

-- Assign new menus to technical_team role (same as existing nft_sell menus)
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('technical_team', 'admin')
  AND m.href IN (
    '/nft/auctions', '/nft/membership', '/nft/events',
    '/nft/seasons', '/nft/packs', '/nft/burn', '/nft/collaborations'
  )
ON CONFLICT DO NOTHING;

COMMIT;
