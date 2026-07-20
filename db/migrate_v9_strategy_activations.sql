-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_v9_strategy_activations.sql
-- Tracks activation state for all 22 NFT selling strategies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nft_strategy_activations (
  id            SERIAL      PRIMARY KEY,
  strategy_name TEXT        NOT NULL UNIQUE,
  wave_number   INT,                         -- NULL = collection-level / all waves
  status        TEXT        NOT NULL DEFAULT 'not_configured'
                            CHECK (status IN ('not_configured','configured','active','completed')),
  config_json   JSONB       NOT NULL DEFAULT '{}',
  notes         TEXT,
  activated_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed all 22 strategy slugs
INSERT INTO nft_strategy_activations (strategy_name) VALUES
  ('public_mint'),
  ('whitelist_presale'),
  ('blind_box_reveal'),
  ('dutch_auction'),
  ('holder_priority'),
  ('phygital_bundle'),
  ('english_auction'),
  ('membership_pass'),
  ('staking_rewards'),
  ('token_gated'),
  ('referral_affiliate'),
  ('tiered_pricing'),
  ('mystery_box'),
  ('flash_sale'),
  ('season_pass'),
  ('burn_to_mint'),
  ('otc_private'),
  ('physical_event'),
  ('corporate_bulk'),
  ('gift_purchase'),
  ('cross_project'),
  ('artist_edition')
ON CONFLICT (strategy_name) DO NOTHING;

-- Mark strategies already fully implemented as active
UPDATE nft_strategy_activations
SET    status = 'active', activated_at = NOW()
WHERE  strategy_name IN ('public_mint', 'blind_box_reveal', 'otc_private', 'gift_purchase');

-- Mark partial strategies as configured (set up but not fully complete)
UPDATE nft_strategy_activations
SET    status = 'configured'
WHERE  strategy_name IN ('whitelist_presale', 'phygital_bundle', 'referral_affiliate', 'corporate_bulk');

-- ── Stored procedures ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_strategy_get_all()
RETURNS TABLE(
  strategy_name TEXT,
  wave_number   INT,
  status        TEXT,
  config_json   JSONB,
  notes         TEXT,
  activated_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ
) LANGUAGE SQL STABLE AS $$
  SELECT strategy_name, wave_number, status, config_json, notes,
         activated_at, completed_at, updated_at
  FROM   nft_strategy_activations
  ORDER  BY id;
$$;

CREATE OR REPLACE FUNCTION nft_strategy_upsert(
  p_strategy_name TEXT,
  p_status        TEXT,
  p_wave_number   INT,
  p_config_json   JSONB,
  p_notes         TEXT
) RETURNS VOID LANGUAGE PLPGSQL AS $$
BEGIN
  UPDATE nft_strategy_activations
  SET
    status       = p_status,
    wave_number  = p_wave_number,
    config_json  = p_config_json,
    notes        = p_notes,
    activated_at = CASE
                     WHEN p_status = 'active' AND activated_at IS NULL THEN NOW()
                     ELSE activated_at
                   END,
    completed_at = CASE
                     WHEN p_status = 'completed' AND completed_at IS NULL THEN NOW()
                     ELSE completed_at
                   END,
    updated_at   = NOW()
  WHERE strategy_name = p_strategy_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Strategy not found: %', p_strategy_name;
  END IF;
END;
$$;
