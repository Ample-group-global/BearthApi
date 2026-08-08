-- patch_v30_wave_status_computed.sql
-- Replace stored w.status column read with a computed CASE expression.
-- Fixes: unscheduled waves showing status="closed" after DB reset because
--        the status column was not included in the reset SQL.
-- Now status is always derived from authoritative boolean flags.
--
-- 5-state lifecycle:
--   pending   -> no schedule set
--   scheduled -> schedule set, start time not yet reached
--   active    -> wave is in its mint window (start triggered or start time passed)
--   closed    -> wave_closed = TRUE (and not revealed)
--   revealed  -> is_revealed = TRUE

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
        WHEN w.is_revealed                                                THEN 'revealed'
        WHEN w.wave_closed                                                THEN 'closed'
        WHEN w.wave_start_triggered                                       THEN 'active'
        WHEN w.scheduled_start IS NOT NULL AND w.scheduled_start <= NOW() THEN 'active'
        WHEN w.scheduled_start IS NOT NULL                                THEN 'scheduled'
        ELSE 'pending'
      END,
      'auctionListingId', w.auction_listing_id,
      'waveStartTriggered', w.wave_start_triggered, 'waveEndTriggered', w.wave_end_triggered,
      'waveRevealTriggered', w.wave_reveal_triggered, 'syncedAt', w.synced_at,
      'nftCount', (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id),
      'unsoldStrategy', w.unsold_strategy
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;
