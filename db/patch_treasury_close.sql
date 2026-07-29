-- =====================================================================
-- Patch: Treasury Close (replaces rollover)
--
-- Changes:
--   1. Add treasury_recipient + treasury_minted_count to nft_waves
--   2. Fix close_action constraint to include 'forfeit'
--   3. Update nft_wave_sync_closed to accept 'forfeit'
--   4. Add nft_wave_sync_treasury_close function
--   5. Add nft_treasury_nfts_list view (all treasury-held tokens)
-- =====================================================================

BEGIN;

-- ── 1. New columns on nft_waves ───────────────────────────────────────

ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS treasury_recipient    VARCHAR(42),
  ADD COLUMN IF NOT EXISTS treasury_minted_count INT NOT NULL DEFAULT 0;

-- ── 2. Fix close_action constraint ───────────────────────────────────
-- Drop old constraint (only allowed 'treasury'/'burn'), add 'forfeit'

ALTER TABLE nft_waves DROP CONSTRAINT IF EXISTS nft_waves_close_action_check;
ALTER TABLE nft_waves
  ADD CONSTRAINT nft_waves_close_action_check
  CHECK (close_action IN ('treasury', 'forfeit', 'burn'));

-- ── 3. Update nft_wave_sync_closed to accept 'forfeit' ───────────────

CREATE OR REPLACE FUNCTION nft_wave_sync_closed(
  p_wave_num      INT,
  p_close_action  VARCHAR,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_close_action NOT IN ('treasury', 'forfeit', 'burn') THEN
    RAISE EXCEPTION 'close_action must be treasury, forfeit, or burn' USING ERRCODE = 'P0001';
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

-- ── 4. New function: nft_wave_sync_treasury_close ─────────────────────
-- Called when WaveClosedTreasury on-chain event is received.
-- Records which wallet got the tokens and how many were minted.

CREATE OR REPLACE FUNCTION nft_wave_sync_treasury_close(
  p_wave_num    INT,
  p_recipient   TEXT,
  p_qty         INT,
  p_tx_hash     TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_waves SET
    wave_closed           = TRUE,
    close_action          = 'treasury',
    treasury_recipient    = p_recipient,
    treasury_minted_count = p_qty,
    status                = 'closed',
    last_tx_hash          = p_tx_hash,
    synced_at             = NOW(),
    updated_at            = NOW()
  WHERE wave_number = p_wave_num
  RETURNING TRUE;
$$;

-- ── 5. View: nft_treasury_nfts_list ──────────────────────────────────
-- Shows all tokens held by the treasury wallet (tokenWave preserved,
-- owner = treasury wallet), available for future sale.

CREATE OR REPLACE FUNCTION nft_treasury_nfts_list()
RETURNS JSON
LANGUAGE sql AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.token_id), '[]')
  FROM (
    SELECT
      r.id,
      r.token_id,
      r.owner_address     AS owner_wallet,
      r.on_chain_wave_num AS origin_wave,
      w.name              AS wave_name,
      r.rarity_tier,
      r.metadata_uri,
      r.minted_at,
      r.last_tx_hash
    FROM nft_records r
    LEFT JOIN nft_waves w ON w.wave_number = r.on_chain_wave_num
    -- treasury-held = owner matches the treasury_recipient of the wave's close
    WHERE r.on_chain_wave_num IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM nft_waves nw
        WHERE nw.wave_number              = r.on_chain_wave_num
          AND nw.close_action             = 'treasury'
          AND LOWER(nw.treasury_recipient) = LOWER(r.owner_address)
      )
    ORDER BY r.token_id
  ) t;
$$;

COMMIT;
