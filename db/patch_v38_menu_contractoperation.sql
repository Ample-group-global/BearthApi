-- patch_v38: Rename /nft/selling route to /nft/contractoperation in the menus table.
-- BearthAdmin folder was renamed from app/(main)/nft/selling → app/(main)/nft/contractoperation
-- (2026-08-11). The sidebar navigation is DB-driven so the href must match the new route.

UPDATE menus
SET href = '/nft/contractoperation'
WHERE href = '/nft/selling';
