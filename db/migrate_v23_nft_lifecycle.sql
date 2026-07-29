-- migrate_v23_nft_lifecycle.sql
-- Adds auto-scheduling support and sold status to NFT lifecycle tables.

-- 1. nft_waves: reveal schedule + tier pricing + auto-trigger tracking
ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS reveal_scheduled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_prices            JSONB,
  ADD COLUMN IF NOT EXISTS wave_start_triggered   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wave_end_triggered     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wave_reveal_triggered  BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. nft_records: sold tracking
ALTER TABLE nft_records
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- 3. Insert 'sold' delivery status between pending and delivered
INSERT INTO lookup_values (category, code, label, sort_order)
VALUES ('delivery_status', 'sold', 'Sold', 15)
ON CONFLICT (category, code) DO NOTHING;

-- 4. Stored function: update wave reveal schedule
CREATE OR REPLACE FUNCTION nft_wave_set_reveal_schedule(
  p_wave_num           INT,
  p_reveal_scheduled_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_wave_num < 1 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Wave number must be 1–7' USING ERRCODE = 'P0001';
  END IF;
  IF p_reveal_scheduled_at IS NOT NULL AND p_reveal_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'Reveal scheduled date must be in the future' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves
     SET reveal_scheduled_at   = p_reveal_scheduled_at,
         wave_reveal_triggered = FALSE,
         updated_at            = NOW()
   WHERE wave_number = p_wave_num;
END;
$$;

-- 5. Stored function: update tier prices
CREATE OR REPLACE FUNCTION nft_wave_set_tier_prices(
  p_wave_num    INT,
  p_tier_prices JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_wave_num < 1 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Wave number must be 1–7' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves
     SET tier_prices = p_tier_prices,
         updated_at  = NOW()
   WHERE wave_number = p_wave_num;
END;
$$;

-- 6. Update nft_wave_get_all() to include new v23 fields
CREATE OR REPLACE FUNCTION nft_wave_get_all()
RETURNS json
LANGUAGE sql AS $$
  SELECT json_agg(
    json_build_object(
      'id',                  w.id,
      'waveNumber',          w.wave_number,
      'name',                w.name,
      'quantity',            w.quantity,
      'defaultPriceEth',     w.default_price_eth,
      'saleMethod',          w.sale_method,
      'scheduledStart',      w.scheduled_start,
      'scheduledEnd',        w.scheduled_end,
      'revealScheduledAt',   w.reveal_scheduled_at,
      'tierPrices',          w.tier_prices,
      'soldCount',           w.sold_count,
      'priceLocked',         w.price_locked,
      'waveClosed',          w.wave_closed,
      'waveRevealed',        w.is_revealed,
      'waveRevealedAt',      w.wave_revealed_at,
      'closeAction',         w.close_action,
      'status',              w.status,
      'auctionListingId',    w.auction_listing_id,
      'waveStartTriggered',  w.wave_start_triggered,
      'waveEndTriggered',    w.wave_end_triggered,
      'waveRevealTriggered', w.wave_reveal_triggered,
      'syncedAt',            w.synced_at,
      'nftCount',            (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id)
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;

-- 7. Update nft_wave_get() to include new v23 fields
CREATE OR REPLACE FUNCTION nft_wave_get(p_wave_num INT)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF p_wave_num < 1 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Wave number must be 1–7' USING ERRCODE = 'P0001';
  END IF;
  SELECT json_build_object(
    'id',                  w.id,
    'waveNum',             w.wave_number,
    'name',                w.name,
    'quantity',            w.quantity,
    'defaultPriceEth',     w.default_price_eth,
    'saleMethod',          w.sale_method,
    'scheduledStart',      w.scheduled_start,
    'scheduledEnd',        w.scheduled_end,
    'revealScheduledAt',   w.reveal_scheduled_at,
    'tierPrices',          w.tier_prices,
    'soldCount',           w.sold_count,
    'priceLocked',         w.price_locked,
    'waveClosed',          w.wave_closed,
    'waveRevealed',        w.is_revealed,
    'waveRevealedAt',      w.wave_revealed_at,
    'closeAction',         w.close_action,
    'status',              w.status,
    'auctionListingId',    w.auction_listing_id,
    'waveStartTriggered',  w.wave_start_triggered,
    'waveEndTriggered',    w.wave_end_triggered,
    'waveRevealTriggered', w.wave_reveal_triggered,
    'syncedAt',            w.synced_at
  ) INTO v_result FROM nft_waves w WHERE w.wave_number = p_wave_num;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Wave % not found', p_wave_num USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;

-- 8. Recreate v_nft_records so nr.* expands to include sold_at (added in this migration)
CREATE OR REPLACE VIEW v_nft_records AS
SELECT
  nr.*,
  ns.code  AS stage_code,
  ns.label AS stage_name,
  nt.code  AS type_code,
  nt.label AS type_name,
  ds.code  AS delivery_status_code,
  ds.label AS delivery_status_name
FROM nft_records nr
LEFT JOIN lookup_values ns ON nr.stage_id           = ns.id AND ns.category = 'nft_stage'
LEFT JOIN lookup_values nt ON nr.nft_type_id        = nt.id AND nt.category = 'nft_type'
LEFT JOIN lookup_values ds ON nr.delivery_status_id = ds.id AND ds.category = 'delivery_status';

-- 9. View: wave auto-schedule status (for scheduler page)
CREATE OR REPLACE VIEW v_wave_schedule_status AS
SELECT
  w.wave_number,
  w.name                                           AS wave_name,
  w.status,
  w.scheduled_start,
  w.scheduled_end,
  w.reveal_scheduled_at,
  w.wave_start_triggered,
  w.wave_end_triggered,
  w.wave_reveal_triggered,
  w.is_revealed,
  w.wave_revealed_at,
  w.sold_count,
  w.quantity,
  CASE
    WHEN w.wave_start_triggered  THEN 'started'
    WHEN w.scheduled_start IS NOT NULL AND w.scheduled_start > NOW() THEN 'pending_start'
    WHEN w.wave_end_triggered    THEN 'ended'
    WHEN w.scheduled_end   IS NOT NULL AND w.scheduled_end   > NOW() THEN 'pending_end'
    WHEN w.wave_reveal_triggered THEN 'revealed'
    WHEN w.reveal_scheduled_at IS NOT NULL AND w.reveal_scheduled_at > NOW() THEN 'pending_reveal'
    ELSE 'not_scheduled'
  END AS auto_trigger_state
FROM nft_waves w
ORDER BY w.wave_number;
