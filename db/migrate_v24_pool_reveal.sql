-- V24: NFT Wave Pool + Two-Level Reveal Randomization
-- Level 1: pool randomly selected from available 9999 artworks at reveal time
-- Level 2: VRF randomly assigns pool artworks to sold token IDs

-- ── 1. Delivery-status lookup values ──────────────────────────────────────────
INSERT INTO lookup_values (category, code, label, sort_order)
VALUES
  ('delivery_status', 'pool_assigned',    'Pool Assigned',    5),
  ('delivery_status', 'revealed',         'Revealed',         8),
  ('delivery_status', 'treasury_pending', 'Treasury Pending', 10),
  ('delivery_status', 'transferred',      'Transferred',      15)
ON CONFLICT (category, code) DO NOTHING;

-- ── 2. nft_wave_pool — temporary scratch table, one row per pool artwork ───────
CREATE TABLE IF NOT EXISTS nft_wave_pool (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_number   INT         NOT NULL,
  pool_index    INT         NOT NULL,       -- 0-based position in pool (random order)
  serial_number TEXT        NOT NULL,
  nft_record_id UUID        NOT NULL REFERENCES nft_records(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wave_number, pool_index),
  UNIQUE (nft_record_id)                    -- each artwork in at most one active pool
);

CREATE INDEX IF NOT EXISTS idx_nft_wave_pool_wave ON nft_wave_pool (wave_number);

-- ── 3. nft_wave_create_pool(wave_num) ────────────────────────────────────────
-- Randomly selects waveQty artworks from nft_records where:
--   • token_id IS NULL (not yet minted by any customer)
--   • delivery_status is NULL or 'pending' (not already used by another wave)
--   • not already present in nft_wave_pool (no double-allocation)
-- Marks selected rows as 'pool_assigned'.
-- Returns number of artworks inserted.

CREATE OR REPLACE FUNCTION nft_wave_create_pool(p_wave_num INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_qty        INTEGER;
  v_inserted   INTEGER;
  v_pa_id      UUID;
  v_pending_id UUID;
BEGIN
  -- Wave must exist and have a positive quantity
  SELECT quantity INTO v_qty FROM nft_waves WHERE wave_number = p_wave_num;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'Wave % not found', p_wave_num;
  END IF;
  IF v_qty = 0 THEN
    RAISE EXCEPTION 'Wave % has zero quantity', p_wave_num;
  END IF;

  -- Guard: pool must not already exist for this wave
  IF EXISTS (SELECT 1 FROM nft_wave_pool WHERE wave_number = p_wave_num LIMIT 1) THEN
    RAISE EXCEPTION 'Pool for wave % already exists — call cleanup first if re-creating', p_wave_num;
  END IF;

  -- Fetch status IDs
  SELECT id INTO v_pa_id      FROM lookup_values WHERE category = 'delivery_status' AND code = 'pool_assigned';
  SELECT id INTO v_pending_id FROM lookup_values WHERE category = 'delivery_status' AND code = 'pending';

  -- Randomly select available artworks and insert into pool
  INSERT INTO nft_wave_pool (wave_number, pool_index, serial_number, nft_record_id)
  SELECT
    p_wave_num,
    (ROW_NUMBER() OVER (ORDER BY RANDOM()) - 1)::INT,
    nr.serial_number,
    nr.id
  FROM nft_records nr
  WHERE nr.token_id IS NULL
    AND (
      nr.delivery_status_id IS NULL
      OR nr.delivery_status_id = v_pending_id
    )
    AND nr.id NOT IN (SELECT nft_record_id FROM nft_wave_pool)
  ORDER BY RANDOM()
  LIMIT v_qty;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Roll back if not enough artworks are available
  IF v_inserted < v_qty THEN
    DELETE FROM nft_wave_pool WHERE wave_number = p_wave_num;
    RAISE EXCEPTION
      'Not enough available artworks for wave % pool: needed %, found %',
      p_wave_num, v_qty, v_inserted;
  END IF;

  -- Mark selected artwork rows as pool_assigned
  IF v_pa_id IS NOT NULL THEN
    UPDATE nft_records
    SET delivery_status_id = v_pa_id,
        updated_at         = NOW()
    WHERE id IN (SELECT nft_record_id FROM nft_wave_pool WHERE wave_number = p_wave_num);
  END IF;

  RETURN v_inserted;
END;
$$;
