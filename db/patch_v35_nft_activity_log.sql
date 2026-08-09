-- patch_v35: Centralised NFT activity log
-- Records every NFT action (on-chain + off-chain + external platforms).
-- source: 'on_chain' | 'off_chain' | 'external'
-- platform: 'bearth' | 'bearth_admin' | 'opensea' | 'blur' | 'looksrare' | 'other'

CREATE TABLE IF NOT EXISTS nft_activity_log (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  nft_record_id  UUID          REFERENCES nft_records(id) ON DELETE SET NULL,
  token_id       INTEGER,
  serial_number  TEXT,
  action         TEXT          NOT NULL,
  source         TEXT          NOT NULL CHECK (source IN ('on_chain','off_chain','external')),
  platform       TEXT          NOT NULL DEFAULT 'bearth',
  actor_wallet   TEXT,
  actor_user_id  UUID          REFERENCES users(id) ON DELETE SET NULL,
  from_wallet    TEXT,
  to_wallet      TEXT,
  tx_hash        TEXT,
  block_number   BIGINT,
  value_eth      NUMERIC(18,8),
  details        JSONB         NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nft_activity_log_nft_record_id ON nft_activity_log (nft_record_id);
CREATE INDEX IF NOT EXISTS nft_activity_log_token_id      ON nft_activity_log (token_id);
CREATE INDEX IF NOT EXISTS nft_activity_log_action        ON nft_activity_log (action);
CREATE INDEX IF NOT EXISTS nft_activity_log_source        ON nft_activity_log (source);
CREATE INDEX IF NOT EXISTS nft_activity_log_created_at    ON nft_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS nft_activity_log_tx_hash       ON nft_activity_log (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS nft_activity_log_actor_wallet  ON nft_activity_log (actor_wallet) WHERE actor_wallet IS NOT NULL;
