-- =====================================================================
-- BearthApi — Migration V3: RBAC Menus + NFT Lifecycle Columns
-- Apply to: BearthDev first, then Bearth (production)
-- Run: psql <connection_url> -f migrate_v3.sql
-- =====================================================================

BEGIN;

-- ── 1. Add home_url to roles ──────────────────────────────────────────
ALTER TABLE roles ADD COLUMN IF NOT EXISTS home_url TEXT;

-- ── 2. Create menus table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menus (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL,
  href       TEXT        NOT NULL,
  icon       TEXT,
  module     VARCHAR(50),
  sort_order INTEGER     NOT NULL DEFAULT 0,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ── 3. Create role_menus table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_menus (
  role_id    UUID    NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
  menu_id    UUID    NOT NULL REFERENCES menus(id)  ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, menu_id)
);

-- ── 4. Add NFT lifecycle columns to nft_records ───────────────────────
-- Full sequence: Generate Art → Generate Metadata → IPFS Upload →
--               Mint (blind box) → Reveal → Transfer/Sell
--
-- BLIND BOX: NFTs mint with a generic placeholder. Actual art is hidden
-- until a reveal event. Only after reveal does image_ipfs_hash become public.

ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS image_ipfs_hash    TEXT;   -- CID of actual NFT image (hidden pre-reveal)
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS metadata_ipfs_hash TEXT;   -- CID of actual metadata JSON (hidden pre-reveal)
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS metadata_uri        TEXT;   -- Full URI post-reveal: ipfs://<hash>

-- Blind box columns
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS blind_box_uri       TEXT;   -- Placeholder URI shown before reveal
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS is_revealed         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS revealed_at         TIMESTAMPTZ; -- Timestamp of reveal event

-- On-chain columns
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS token_id            BIGINT; -- On-chain token ID (after mint)
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS mint_tx_hash        TEXT;   -- Blockchain mint transaction hash
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS minted_at           TIMESTAMPTZ; -- Timestamp of mint
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS owner_address       TEXT;   -- Current on-chain owner wallet address

-- Trait columns (stored for rarity calculation even before reveal)
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS traits              JSONB;  -- {"Background":"Blue","Body":"Gold",...}

-- ── 5. Add unique constraint on role_permissions (if not exists) ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_permissions_role_id_permission_id_key'
  ) THEN
    ALTER TABLE role_permissions
      ADD CONSTRAINT role_permissions_role_id_permission_id_key
      UNIQUE (role_id, permission_id);
  END IF;
END $$;

-- ── 6. Seed menus ─────────────────────────────────────────────────────
INSERT INTO menus (label, href, icon, module, sort_order) VALUES
  -- Presale Management menus
  ('Overview',       '/presale',                  'grid',          'presale',   10),
  ('Orders',         '/presale/orders',           'clipboard-list','presale',   20),
  ('Customers',      '/presale/customers',        'users',         'presale',   30),
  ('Products',       '/presale/products',         'package',       'presale',   40),
  ('NFT Records',    '/presale/nft',              'image',         'presale',   50),
  ('Reconciliation', '/presale/reconciliation',   'balance',       'presale',   60),
  ('Reports',        '/presale/reports',          'bar-chart',     'presale',   70),
  ('Team',           '/presale/users',            'user-cog',      'presale',   80),
  -- Dashboard / Technical menus
  ('Dashboard',      '/dashboard',                'grid',          'dashboard', 10),
  ('Whitelist',      '/dashboard/whitelist',      'check-square',  'dashboard', 20),
  ('Contract',       '/dashboard/contract',       'code',          'dashboard', 30),
  ('NFT Overview',   '/dashboard/nfts',           'image',         'dashboard', 40),
  ('NFT Studio',     '/dashboard/generator',      'cpu',           'dashboard', 50),
  -- Admin / RBAC menus (Technical Team only)
  ('Roles',          '/admin/roles',              'shield',        'admin',     10),
  ('Permissions',    '/admin/permissions',        'key',           'admin',     20),
  ('Menu Manager',   '/admin/menus',              'menu',          'admin',     30),
  ('Admin Users',    '/admin/users',              'user-check',    'admin',     40)
ON CONFLICT DO NOTHING;

-- ── 7. Assign menus to roles ──────────────────────────────────────────

-- admin → all presale menus
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'admin'
  AND m.module = 'presale'
  AND m.is_active = TRUE
ON CONFLICT DO NOTHING;

-- operation → presale menus (same as admin for ops)
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'operation'
  AND m.module = 'presale'
  AND m.is_active = TRUE
ON CONFLICT DO NOTHING;

-- sales_team → limited presale (overview, orders, customers)
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'sales_team'
  AND m.module = 'presale'
  AND m.href IN ('/presale', '/presale/orders', '/presale/customers')
ON CONFLICT DO NOTHING;

-- ext_referrer → overview + customers only
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'ext_referrer'
  AND m.module = 'presale'
  AND m.href IN ('/presale', '/presale/customers')
ON CONFLICT DO NOTHING;

-- technical_team → dashboard + admin menus
INSERT INTO role_menus (role_id, menu_id, sort_order)
SELECT r.id, m.id, m.sort_order
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'technical_team'
  AND m.module IN ('dashboard', 'admin')
  AND m.is_active = TRUE
ON CONFLICT DO NOTHING;

-- ── 8. Set home_url on roles ──────────────────────────────────────────
UPDATE roles SET home_url = '/presale'    WHERE code = 'admin'          AND home_url IS NULL;
UPDATE roles SET home_url = '/presale'    WHERE code = 'operation'      AND home_url IS NULL;
UPDATE roles SET home_url = '/presale'    WHERE code = 'sales_team'     AND home_url IS NULL;
UPDATE roles SET home_url = '/presale'    WHERE code = 'ext_referrer'   AND home_url IS NULL;
UPDATE roles SET home_url = '/dashboard'  WHERE code = 'technical_team' AND home_url IS NULL;

-- ── 9. Seed permissions into DB (from presaleAuth.ts source of truth) ─
-- These are the canonical permission keys. INSERT only if not already present.
INSERT INTO permissions (key, label, module, sort_order) VALUES
  ('dashboard.view',                'View Dashboard',           'dashboard',      10),
  ('orders.view',                   'View Orders',              'orders',         20),
  ('orders.create',                 'Create Order',             'orders',         21),
  ('orders.edit',                   'Edit Order',               'orders',         22),
  ('orders.delete',                 'Delete Order',             'orders',         23),
  ('orders.confirm_nft_payment',    'Confirm NFT Payment',      'orders',         24),
  ('orders.confirm_merch_payment',  'Confirm Merch Payment',    'orders',         25),
  ('nft.view',                      'View NFT Records',         'nft',            30),
  ('nft.edit',                      'Edit NFT Record',          'nft',            31),
  ('nft.confirm_delivery',          'Confirm NFT Delivery',     'nft',            32),
  ('products.view',                 'View Products',            'products',       40),
  ('products.create',               'Create Product',           'products',       41),
  ('products.edit',                 'Edit Product',             'products',       42),
  ('products.delete',               'Delete Product',           'products',       43),
  ('customers.view',                'View Customers',           'customers',      50),
  ('customers.create',              'Create Customer',          'customers',      51),
  ('customers.edit',                'Edit Customer',            'customers',      52),
  ('customers.delete',              'Delete Customer',          'customers',      53),
  ('reconciliation.view',           'View Reconciliation',      'reconciliation', 60),
  ('reconciliation.confirm',        'Confirm Reconciliation',   'reconciliation', 61),
  ('reconciliation.cancel',         'Cancel Reconciliation',    'reconciliation', 62),
  ('reports.view',                  'View Reports',             'reports',        70),
  ('users.view',                    'View Team Users',          'users',          80),
  ('users.create',                  'Create Team User',         'users',          81),
  ('users.edit',                    'Edit Team User',           'users',          82),
  ('users.delete',                  'Delete Team User',         'users',          83),
  ('users.revoke_permission',       'Grant/Revoke Permissions', 'users',          84)
ON CONFLICT (key) DO NOTHING;

-- ── 10. Seed role_permissions ─────────────────────────────────────────
-- admin → all permissions
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- operation → all presale permissions
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'operation'
  AND p.key IN (
    'dashboard.view',
    'orders.view', 'orders.create', 'orders.edit', 'orders.delete',
    'orders.confirm_nft_payment', 'orders.confirm_merch_payment',
    'nft.view', 'nft.edit', 'nft.confirm_delivery',
    'products.view', 'products.create', 'products.edit', 'products.delete',
    'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
    'reconciliation.view', 'reconciliation.confirm', 'reconciliation.cancel',
    'reports.view',
    'users.view', 'users.create', 'users.edit', 'users.delete', 'users.revoke_permission'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- technical_team → dashboard + nft + products + reports
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'technical_team'
  AND p.key IN (
    'dashboard.view',
    'nft.view', 'nft.edit', 'nft.confirm_delivery',
    'products.view', 'products.create', 'products.edit', 'products.delete',
    'reports.view'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- sales_team → view only: orders, customers, reports
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'sales_team'
  AND p.key IN (
    'dashboard.view',
    'orders.view', 'customers.view', 'reports.view'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ext_referrer → customers view only
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'ext_referrer'
  AND p.key IN ('dashboard.view', 'customers.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────
SELECT 'roles' AS table_name, COUNT(*) AS rows FROM roles
UNION ALL SELECT 'permissions', COUNT(*) FROM permissions
UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions
UNION ALL SELECT 'menus', COUNT(*) FROM menus
UNION ALL SELECT 'role_menus', COUNT(*) FROM role_menus;
