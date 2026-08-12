-- patch_v48: Activate the Customers menu.
--
-- Root cause:
--   The /customers menu exists in the DB (module='sales', label='Customers')
--   and is already assigned to all roles including technical_team —
--   but is_active was set to FALSE, hiding it from all sidebars.
--
-- Fix: re-activate the menu so it appears for all assigned roles.

UPDATE menus
SET is_active = TRUE
WHERE href = '/customers';
