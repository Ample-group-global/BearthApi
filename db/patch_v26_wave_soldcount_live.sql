-- Patch v26: compute soldCount live from nft_records instead of stale sold_count column
-- nft_waves.sold_count was never updated during minting; use a live subquery instead

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
      'soldCount',           (SELECT COUNT(*) FROM nft_records nr WHERE nr.wave_id = w.id AND nr.token_id IS NOT NULL),
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
