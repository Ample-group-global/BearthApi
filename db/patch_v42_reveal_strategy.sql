-- patch_v42_reveal_strategy.sql
-- Add reveal_strategy column to nft_waves.
-- 'auto'   → auto-trigger fires at reveal_scheduled_at (current default behaviour).
-- 'manual' → auto-trigger skips this wave; admin must click "Reveal Now" explicitly.
--
-- Also updates nft_wave_get_all() and v_wave_schedule_status to return the new field.

-- 1. Add column (idempotent via IF NOT EXISTS)
ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS reveal_strategy varchar(20) NOT NULL DEFAULT 'auto';

-- 2. Add lookup_values entries so the DB is the single source of truth
INSERT INTO lookup_values (category, code, label, sort_order, is_active)
VALUES
  ('reveal_strategy', 'auto',   'Auto Reveal',   1, true),
  ('reveal_strategy', 'manual', 'Manual Reveal',  2, true)
ON CONFLICT (category, code) DO NOTHING;

-- 3. Rebuild nft_wave_get_all() to expose reveal_strategy
CREATE OR REPLACE FUNCTION nft_wave_get_all()
RETURNS json LANGUAGE sql STABLE AS
$$
  SELECT json_agg(
    json_build_object(
      'id', w.id, 'waveNumber', w.wave_number, 'name', w.name,
      'quantity', w.quantity, 'defaultPriceEth', w.default_price_eth,
      'saleMethod', w.sale_method, 'scheduledStart', w.scheduled_start,
      'scheduledEnd', w.scheduled_end, 'revealScheduledAt', w.reveal_scheduled_at,
      'tierPrices', w.tier_prices,
      'soldCount', (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id AND nr.token_id IS NOT NULL),
      'treasuryPendingCount', (SELECT COUNT(*) FROM nft_records nr JOIN lookup_values lv ON nr.delivery_status_id = lv.id WHERE nr.wave_id = w.id AND lv.category = 'delivery_status' AND lv.code = 'treasury_pending'),
      'priceLocked', w.price_locked, 'waveClosed', w.wave_closed,
      'waveRevealed', w.is_revealed, 'waveRevealedAt', w.wave_revealed_at,
      'waveRevealUri', w.wave_reveal_uri, 'closeAction', w.close_action,
      'status', CASE
        WHEN w.is_revealed                                                           THEN 'revealed'
        WHEN w.wave_closed                                                           THEN 'closed'
        WHEN w.wave_start_triggered AND NOT w.wave_end_triggered                     THEN 'active'
        WHEN w.scheduled_start IS NOT NULL AND w.scheduled_start <= NOW()
          AND (w.scheduled_end IS NULL OR w.scheduled_end > NOW())                  THEN 'active'
        WHEN w.scheduled_start IS NOT NULL AND w.scheduled_end IS NOT NULL
          AND w.scheduled_end <= NOW()                                               THEN 'closed'
        WHEN w.scheduled_start IS NOT NULL                                           THEN 'scheduled'
        ELSE 'pending'
      END,
      'auctionListingId', w.auction_listing_id,
      'waveStartTriggered', w.wave_start_triggered, 'waveEndTriggered', w.wave_end_triggered,
      'waveRevealTriggered', w.wave_reveal_triggered, 'syncedAt', w.synced_at,
      'nftCount', (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id),
      'unsoldStrategy', w.unsold_strategy,
      'revealStrategy', w.reveal_strategy,
      'whitelistRequired', w.whitelist_required
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;

-- 4. Rebuild v_wave_schedule_status to include reveal_strategy
-- DROP first: CREATE OR REPLACE cannot add new columns.
DROP VIEW IF EXISTS v_wave_schedule_status;
CREATE VIEW v_wave_schedule_status AS
SELECT
  w.wave_number,
  w.name                                                                              AS wave_name,
  CASE
    WHEN w.is_revealed                                                                THEN 'revealed'
    WHEN w.wave_closed                                                                THEN 'closed'
    WHEN w.wave_start_triggered AND NOT w.wave_end_triggered                          THEN 'active'
    WHEN w.scheduled_start IS NOT NULL AND w.scheduled_start <= NOW()
      AND (w.scheduled_end IS NULL OR w.scheduled_end > NOW())                       THEN 'active'
    WHEN w.scheduled_start IS NOT NULL AND w.scheduled_end IS NOT NULL
      AND w.scheduled_end <= NOW()                                                    THEN 'closed'
    WHEN w.scheduled_start IS NOT NULL                                                THEN 'scheduled'
    ELSE 'pending'
  END                                                                                 AS status,
  w.scheduled_start,
  w.scheduled_end,
  w.reveal_scheduled_at,
  w.wave_start_triggered,
  w.wave_end_triggered,
  w.wave_reveal_triggered,
  w.is_revealed,
  w.wave_revealed_at,
  w.sold_count,
  (SELECT COUNT(*)::integer FROM nft_records nr
   WHERE nr.on_chain_wave_num = w.wave_number AND nr.token_id IS NOT NULL) AS minted_count,
  w.quantity,
  w.reveal_strategy,
  CASE
    WHEN w.wave_start_triggered AND NOT w.wave_end_triggered                          THEN 'started'
    WHEN w.wave_end_triggered                                                         THEN 'ended'
    WHEN w.scheduled_start IS NOT NULL AND w.scheduled_start <= NOW()
      AND (w.scheduled_end IS NULL OR w.scheduled_end > NOW())                       THEN 'active_window'
    WHEN w.scheduled_start IS NOT NULL AND w.scheduled_end IS NOT NULL
      AND w.scheduled_end <= NOW()                                                    THEN 'pending_end'
    WHEN w.scheduled_start IS NOT NULL AND w.scheduled_start > NOW()                  THEN 'pending_start'
    WHEN w.wave_reveal_triggered                                                      THEN 'revealed'
    WHEN w.reveal_scheduled_at IS NOT NULL AND w.reveal_scheduled_at > NOW()          THEN 'pending_reveal'
    ELSE 'not_scheduled'
  END                                                                                 AS auto_trigger_state
FROM nft_waves w
ORDER BY w.wave_number;
