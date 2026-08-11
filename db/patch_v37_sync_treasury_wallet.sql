-- patch_v37: Sync nft_collection_config.treasury_wallet to the fresh Sepolia deploy address.
-- The previous value (0x8b98f7EC8Fb6D77C480Af7c98980353c33753EF4) was from an older deployment.
-- New treasury wallet (0x1121b0e2E7Fd3Edd0394B11BF431CB012B491870) was set during 2026-08-11 deploy.

UPDATE nft_collection_config
SET treasury_wallet = '0x1121b0e2E7Fd3Edd0394B11BF431CB012B491870',
    updated_at      = NOW()
WHERE id = 1
  AND treasury_wallet != '0x1121b0e2E7Fd3Edd0394B11BF431CB012B491870';
