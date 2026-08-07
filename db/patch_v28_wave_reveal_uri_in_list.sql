-- Patch v28: add waveRevealUri to nft_wave_get_all()
-- Needed so the frontend TreasuryMoveModal can pre-populate the reveal URI
-- from what's already stored in the DB (set during a previous reveal attempt or via settings).

CREATE OR REPLACE FUNCTION nft_wave_get_all()
RETURNS json
LANGUAGE sql AS $$
  SELECT json_agg(
    json_build_object(
      'id',                   w.id,
      'waveNumber',           w.wave_number,
      'name',                 w.name,
      'quantity',             w.quantity,
      'defaultPriceEth',      w.default_price_eth,
      'saleMethod',           w.sale_method,
      'scheduledStart',       w.scheduled_start,
      'scheduledEnd',         w.scheduled_end,
      'revealScheduledAt',    w.reveal_scheduled_at,
      'tierPrices',           w.tier_prices,
      'soldCount',            (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id AND nr.token_id IS NOT NULL),
      'treasuryPendingCount', (SELECT COUNT(*) FROM nft_records nr
                               JOIN lookup_values lv ON nr.delivery_status_id = lv.id
                               WHERE nr.wave_id = w.id
                                 AND lv.category = 'delivery_status'
                                 AND lv.code = 'treasury_pending'),
      'priceLocked',          w.price_locked,
      'waveClosed',           w.wave_closed,
      'waveRevealed',         w.is_revealed,
      'waveRevealedAt',       w.wave_revealed_at,
      'waveRevealUri',        w.wave_reveal_uri,
      'closeAction',          w.close_action,
      'status',               w.status,
      'auctionListingId',     w.auction_listing_id,
      'waveStartTriggered',   w.wave_start_triggered,
      'waveEndTriggered',     w.wave_end_triggered,
      'waveRevealTriggered',  w.wave_reveal_triggered,
      'syncedAt',             w.synced_at,
      'nftCount',             (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id)
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;
