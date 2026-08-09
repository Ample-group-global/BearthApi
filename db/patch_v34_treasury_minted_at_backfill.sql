-- patch_v34: Backfill minted_at for treasury NFT records
-- Treasury records minted before this fix was deployed had minted_at=NULL
-- because the treasury-move route only set delivered_at, not minted_at.
-- This patch sets minted_at = COALESCE(revealed_at, delivered_at, updated_at)
-- for any treasury record that has a token_id but no minted_at.

UPDATE nft_records nr
   SET minted_at  = COALESCE(nr.revealed_at, nr.delivered_at, nr.updated_at),
       updated_at = NOW()
  FROM lookup_values lv
 WHERE lv.id = nr.delivery_status_id
   AND lv.code IN ('treasury_wallet', 'transferred')
   AND nr.token_id IS NOT NULL
   AND nr.minted_at IS NULL;
