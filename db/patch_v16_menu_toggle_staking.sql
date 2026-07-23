-- patch_v16_menu_toggle_staking.sql
-- 1. Disable Dutch Auction and Payment Methods menus
-- 2. Add missing staking config columns
-- Safe to re-run (IF NOT EXISTS / conditional UPDATE)

BEGIN;

-- ── Disable menus ──────────────────────────────────────────────────────────────
UPDATE menus SET is_active = FALSE
WHERE href IN ('/nft/dutch', '/settings/payment-methods');

-- ── Add missing staking config columns ────────────────────────────────────────
ALTER TABLE nft_staking_config
  ADD COLUMN IF NOT EXISTS genesis_bonus_bps    INT NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS points_per_day_common INT NOT NULL DEFAULT 100;

COMMIT;
