-- ============================================================
-- Migration v10: Three-Phase NFT Launch + Multi-Mode Admin Sales
-- Bearth NFT: Whitelist Mint → Paid Mint → Reveal (only these 3)
-- ============================================================

-- 1. Replace 22 generic strategies with the 3 actual Bearth launch phases
DELETE FROM nft_strategy_activations;

INSERT INTO nft_strategy_activations (strategy_name, status, notes) VALUES
  ('whitelist_mint', 'not_configured',
   'Phase 1 — Free mint for whitelisted wallets only. One NFT per whitelisted wallet. Requires Merkle proof on-chain.'),
  ('paid_mint', 'not_configured',
   'Phase 2 — Fixed-price public mint. Supports on-chain self-mint AND admin-recorded offline/off-chain sales via adminMint.'),
  ('reveal', 'not_configured',
   'Phase 3 — One-time reveal of actual NFT metadata. Requires all waves closed. Admin uploads to IPFS then triggers on-chain reveal.');

-- 2. Admin sales log: records every non-self-mint sale regardless of mode
--    Covers: offline cash, bank transfer, credit card, OTC crypto, gift, corporate bulk, etc.
--    After recording, admin calls adminMint(buyer, qty) to deliver on-chain.

CREATE TABLE IF NOT EXISTS nft_admin_sales (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_mode         VARCHAR(30)   NOT NULL
                    CHECK (sale_mode IN ('offline_cash','offline_card','offline_crypto','bank_transfer','online_card','online_crypto','gift','corporate','other')),
  buyer_address     VARCHAR(42)   NOT NULL,
  quantity          INTEGER       NOT NULL CHECK (quantity > 0),
  amount_paid_eth   NUMERIC(18,8),          -- ETH equivalent at time of sale; NULL for gift
  payment_currency  VARCHAR(10)   NOT NULL DEFAULT 'ETH',  -- ETH, USD, SGD, USDT, …
  payment_ref       VARCHAR(255),           -- invoice #, bank ref, receipt #, tx hash if crypto
  wave_number       INTEGER       NOT NULL DEFAULT 2,      -- almost always Wave 2 (Paid Mint)
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','minted','failed','refunded')),
  tx_hash           VARCHAR(66),            -- set when adminMint tx confirmed
  notes             TEXT,
  created_by        VARCHAR(42),            -- admin wallet address
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  minted_at         TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nft_admin_sales_status       ON nft_admin_sales(status);
CREATE INDEX IF NOT EXISTS idx_nft_admin_sales_buyer        ON nft_admin_sales(buyer_address);
CREATE INDEX IF NOT EXISTS idx_nft_admin_sales_created      ON nft_admin_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nft_admin_sales_wave         ON nft_admin_sales(wave_number);

-- 3. Grant permissions to existing app role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bearth_app') THEN
    GRANT SELECT, INSERT, UPDATE ON nft_admin_sales TO bearth_app;
  END IF;
END$$;

-- 4. Stored procedures

-- List all admin sales (paginated, filterable by status/mode)
CREATE OR REPLACE FUNCTION nft_admin_sales_list(
  p_limit   INT     DEFAULT 50,
  p_offset  INT     DEFAULT 0,
  p_status  VARCHAR DEFAULT NULL,
  p_mode    VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id               UUID,
  sale_mode        VARCHAR,
  buyer_address    VARCHAR,
  quantity         INTEGER,
  amount_paid_eth  NUMERIC,
  payment_currency VARCHAR,
  payment_ref      VARCHAR,
  wave_number      INTEGER,
  status           VARCHAR,
  tx_hash          VARCHAR,
  notes            TEXT,
  created_by       VARCHAR,
  created_at       TIMESTAMPTZ,
  minted_at        TIMESTAMPTZ,
  total_count      BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT
      s.id, s.sale_mode, s.buyer_address, s.quantity,
      s.amount_paid_eth, s.payment_currency, s.payment_ref,
      s.wave_number, s.status, s.tx_hash, s.notes, s.created_by,
      s.created_at, s.minted_at,
      COUNT(*) OVER () AS total_count
    FROM nft_admin_sales s
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (p_mode   IS NULL OR s.sale_mode = p_mode)
    ORDER BY s.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

-- Create a pending admin sale record
CREATE OR REPLACE FUNCTION nft_admin_sale_create(
  p_sale_mode        VARCHAR,
  p_buyer_address    VARCHAR,
  p_quantity         INTEGER,
  p_amount_paid_eth  NUMERIC,
  p_payment_currency VARCHAR,
  p_payment_ref      VARCHAR,
  p_wave_number      INTEGER,
  p_notes            TEXT,
  p_created_by       VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO nft_admin_sales (
    sale_mode, buyer_address, quantity, amount_paid_eth,
    payment_currency, payment_ref, wave_number, notes, created_by
  )
  VALUES (
    p_sale_mode, LOWER(p_buyer_address), p_quantity, p_amount_paid_eth,
    UPPER(p_payment_currency), p_payment_ref, p_wave_number, p_notes, LOWER(p_created_by)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Mark a sale as minted (called after adminMint tx confirms)
CREATE OR REPLACE FUNCTION nft_admin_sale_mark_minted(
  p_id      UUID,
  p_tx_hash VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nft_admin_sales
  SET status     = 'minted',
      tx_hash    = p_tx_hash,
      minted_at  = NOW(),
      updated_at = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin sale not found: %', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Mark a sale as failed
CREATE OR REPLACE FUNCTION nft_admin_sale_mark_failed(
  p_id    UUID,
  p_notes VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nft_admin_sales
  SET status     = 'failed',
      notes      = COALESCE(p_notes, notes),
      updated_at = NOW()
  WHERE id = p_id;
END;
$$;

-- Revenue summary: total ETH collected across admin sales + on-chain mints
CREATE OR REPLACE FUNCTION nft_revenue_summary()
RETURNS TABLE (
  admin_sales_total_eth   NUMERIC,
  admin_sales_count       BIGINT,
  admin_sales_qty         BIGINT,
  by_mode                 JSON,
  by_status               JSON
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT
      COALESCE(SUM(s.amount_paid_eth) FILTER (WHERE s.status = 'minted'), 0),
      COUNT(*)                        FILTER (WHERE s.status = 'minted'),
      COALESCE(SUM(s.quantity)        FILTER (WHERE s.status = 'minted'), 0),
      (
        SELECT json_agg(row_to_json(m))
        FROM (
          SELECT sale_mode, COUNT(*) AS count, SUM(quantity) AS qty, SUM(amount_paid_eth) AS eth
          FROM nft_admin_sales WHERE status = 'minted'
          GROUP BY sale_mode ORDER BY sale_mode
        ) m
      ),
      (
        SELECT json_agg(row_to_json(st))
        FROM (
          SELECT status, COUNT(*) AS count, SUM(quantity) AS qty
          FROM nft_admin_sales
          GROUP BY status ORDER BY status
        ) st
      )
    FROM nft_admin_sales s;
END;
$$;

-- Phase progress view (joins strategy state with collection phase)
CREATE OR REPLACE FUNCTION nft_launch_status()
RETURNS TABLE (
  phase_number  INTEGER,
  strategy_name VARCHAR,
  status        VARCHAR,
  notes         TEXT,
  activated_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
)
LANGUAGE sql AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY
      CASE strategy_name
        WHEN 'whitelist_mint' THEN 1
        WHEN 'paid_mint'      THEN 2
        WHEN 'reveal'         THEN 3
        ELSE 99
      END
    )::INTEGER AS phase_number,
    strategy_name,
    status,
    notes,
    activated_at,
    completed_at
  FROM nft_strategy_activations
  WHERE strategy_name IN ('whitelist_mint','paid_mint','reveal')
  ORDER BY phase_number;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION nft_admin_sales_list        TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_admin_sale_create       TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_admin_sale_mark_minted  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_admin_sale_mark_failed  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_revenue_summary         TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_launch_status           TO PUBLIC;
