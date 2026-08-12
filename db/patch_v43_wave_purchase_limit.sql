-- patch_v43_wave_purchase_limit.sql
-- Add per-wave purchase limit to nft_waves.
-- max_per_wallet = 0  → wave uses global purchaseLimitEnabled/normalMaxPerWallet (default).
-- max_per_wallet > 0  → wallet cannot mint more than this amount in THIS wave specifically.
-- On-chain: wavePurchaseLimit[waveNum] + waveMinted[waveNum][wallet] enforce the cap.

-- 1. Add column (idempotent)
ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS max_per_wallet INTEGER NOT NULL DEFAULT 0;

-- 2. Rebuild nft_wave_get_all() to expose maxPerWallet
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
      'whitelistRequired', w.whitelist_required,
      'maxPerWallet', w.max_per_wallet
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;

-- 3. Rebuild nft_wave_get() to expose maxPerWallet
CREATE OR REPLACE FUNCTION nft_wave_get(p_wave_num INT)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF p_wave_num < 1 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Wave number must be 1-7' USING ERRCODE = 'P0001';
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
    'syncedAt',            w.synced_at,
    'maxPerWallet',        w.max_per_wallet
  ) INTO v_result FROM nft_waves w WHERE w.wave_number = p_wave_num;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Wave % not found', p_wave_num USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;
