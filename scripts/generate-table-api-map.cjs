const XLSX = require('xlsx');

// ── DATA ──────────────────────────────────────────────────────────────────────
const data = [
  // Domain | Table | Method | Route | Notes
  // AUTH & RBAC
  ['Auth & RBAC', 'users', 'POST', '/auth/admin/login', ''],
  ['Auth & RBAC', 'users', 'GET', '/auth/admin/me', ''],
  ['Auth & RBAC', 'users', 'POST', '/auth/admin/forgot-password', ''],
  ['Auth & RBAC', 'users', 'POST', '/auth/admin/reset-password', ''],
  ['Auth & RBAC', 'users', 'GET', '/presale/customers', ''],
  ['Auth & RBAC', 'users', 'POST', '/presale/customers', ''],
  ['Auth & RBAC', 'users', 'GET', '/presale/customers/:id', ''],
  ['Auth & RBAC', 'users', 'PUT', '/presale/customers/:id', ''],
  ['Auth & RBAC', 'users', 'PATCH', '/presale/customers/:id/status', ''],
  ['Auth & RBAC', 'users', 'DELETE', '/presale/customers/:id', ''],
  ['Auth & RBAC', 'users', 'GET', '/presale/referrers', ''],
  ['Auth & RBAC', 'users', 'POST', '/presale/referrers', ''],
  ['Auth & RBAC', 'users', 'GET', '/admin/users', ''],
  ['Auth & RBAC', 'users', 'POST', '/admin/users', ''],
  ['Auth & RBAC', 'users', 'PUT', '/admin/users/:id', ''],
  ['Auth & RBAC', 'users', 'DELETE', '/admin/users/:id', ''],
  ['Auth & RBAC', 'roles', 'GET', '/auth/admin/me', ''],
  ['Auth & RBAC', 'roles', 'GET', '/presale/customers', ''],
  ['Auth & RBAC', 'roles', 'POST', '/presale/customers', ''],
  ['Auth & RBAC', 'roles', 'GET', '/admin/users', ''],
  ['Auth & RBAC', 'roles', 'GET', '/admin/roles', ''],
  ['Auth & RBAC', 'permissions', 'GET', '/auth/admin/me', ''],
  ['Auth & RBAC', 'permissions', 'GET', '/admin/permissions', ''],
  ['Auth & RBAC', 'permissions', 'GET', '/admin/roles/:id/permissions', ''],
  ['Auth & RBAC', 'permissions', 'PUT', '/admin/roles/:id/permissions', ''],
  ['Auth & RBAC', 'permissions', 'GET', '/admin/users/:id/permissions', ''],
  ['Auth & RBAC', 'permissions', 'POST', '/admin/users/:id/permissions', ''],
  ['Auth & RBAC', 'permissions', 'DELETE', '/admin/users/:id/permissions/:permissionId', ''],
  ['Auth & RBAC', 'role_permissions', 'GET', '/auth/admin/me', ''],
  ['Auth & RBAC', 'role_permissions', 'GET', '/admin/roles/:id/permissions', ''],
  ['Auth & RBAC', 'role_permissions', 'PUT', '/admin/roles/:id/permissions', ''],
  ['Auth & RBAC', 'user_permission_overrides', 'DELETE', '/admin/users/:id', ''],
  ['Auth & RBAC', 'user_permission_overrides', 'GET', '/admin/users/:id/permissions', ''],
  ['Auth & RBAC', 'user_permission_overrides', 'POST', '/admin/users/:id/permissions', ''],
  ['Auth & RBAC', 'user_permission_overrides', 'DELETE', '/admin/users/:id/permissions/:permissionId', ''],
  ['Auth & RBAC', 'menus', 'GET', '/admin/menus', ''],
  ['Auth & RBAC', 'menus', 'GET', '/admin/roles/:id/menus', ''],
  ['Auth & RBAC', 'menus', 'PUT', '/admin/roles/:id/menus', ''],
  ['Auth & RBAC', 'role_menus', 'GET', '/admin/roles/:id/menus', ''],
  ['Auth & RBAC', 'role_menus', 'PUT', '/admin/roles/:id/menus', ''],

  // ORDERS & SALES
  ['Orders & Sales', 'orders', 'GET', '/presale/orders', ''],
  ['Orders & Sales', 'orders', 'POST', '/presale/orders', ''],
  ['Orders & Sales', 'orders', 'GET', '/presale/orders/:id', ''],
  ['Orders & Sales', 'orders', 'PUT', '/presale/orders/:id', ''],
  ['Orders & Sales', 'orders', 'DELETE', '/presale/orders/:id', ''],
  ['Orders & Sales', 'orders', 'GET', '/presale/reconciliation', ''],
  ['Orders & Sales', 'orders', 'GET', '/presale/reports', ''],
  ['Orders & Sales', 'order_nft_items', 'POST', '/presale/orders', ''],
  ['Orders & Sales', 'order_nft_items', 'GET', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_nft_items', 'DELETE', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_product_items', 'POST', '/presale/orders', ''],
  ['Orders & Sales', 'order_product_items', 'GET', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_product_items', 'DELETE', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_operation_logs', 'GET', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_operation_logs', 'PUT', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_operation_logs', 'DELETE', '/presale/orders/:id', ''],
  ['Orders & Sales', 'order_operation_logs', 'PUT', '/presale/nft/:id (confirm_delivery)', ''],
  ['Orders & Sales', 'order_operation_logs', 'GET', '/presale/reports', ''],
  ['Orders & Sales', 'order_fulfillment', 'POST', '/presale/fulfillment/initialize', ''],
  ['Orders & Sales', 'order_fulfillment', 'GET', '/presale/fulfillment', ''],
  ['Orders & Sales', 'order_fulfillment', 'GET', '/presale/fulfillment/:orderId', ''],
  ['Orders & Sales', 'order_fulfillment', 'POST', '/presale/fulfillment/:orderId', ''],
  ['Orders & Sales', 'order_return_items', 'GET', '/presale/inventory/returns', ''],
  ['Orders & Sales', 'order_return_items', 'POST', '/presale/inventory/returns', ''],
  ['Orders & Sales', 'order_return_items', 'POST', '/presale/inventory/returns/:id/process', ''],
  ['Orders & Sales', 'reconciliation_entries', 'GET', '/presale/reconciliation', ''],
  ['Orders & Sales', 'reconciliation_entries', 'GET', '/presale/reconciliation/:id', ''],
  ['Orders & Sales', 'reconciliation_entries', 'PUT', '/presale/reconciliation/:id (confirm)', ''],
  ['Orders & Sales', 'reconciliation_entries', 'PUT', '/presale/reconciliation/:id (cancel)', ''],

  // PRODUCTS & INVENTORY
  ['Products & Inventory', 'products', 'GET', '/presale/products', ''],
  ['Products & Inventory', 'products', 'POST', '/presale/products', ''],
  ['Products & Inventory', 'products', 'GET', '/presale/products/:id', ''],
  ['Products & Inventory', 'products', 'PUT', '/presale/products/:id', ''],
  ['Products & Inventory', 'products', 'DELETE', '/presale/products/:id', ''],
  ['Products & Inventory', 'products', 'GET', '/presale/inventory', ''],
  ['Products & Inventory', 'products', 'POST', '/presale/inventory/purchase-orders/:id/receive', ''],
  ['Products & Inventory', 'product_statuses', 'GET', '/presale/products', ''],
  ['Products & Inventory', 'product_statuses', 'POST', '/presale/products', ''],
  ['Products & Inventory', 'product_statuses', 'GET', '/presale/master', ''],
  ['Products & Inventory', 'product_categories', 'GET', '/presale/catalog/categories', ''],
  ['Products & Inventory', 'product_categories', 'POST', '/presale/catalog/categories', ''],
  ['Products & Inventory', 'product_categories', 'PUT', '/presale/catalog/categories/:id', ''],
  ['Products & Inventory', 'product_categories', 'DELETE', '/presale/catalog/categories/:id', ''],
  ['Products & Inventory', 'product_images', 'GET', '/presale/products/:id/images', ''],
  ['Products & Inventory', 'product_images', 'POST', '/presale/products/:id/images', ''],
  ['Products & Inventory', 'product_images', 'DELETE', '/presale/products/:id/images/:imageId', ''],
  ['Products & Inventory', 'product_images', 'PUT', '/presale/products/:id/images/reorder', ''],
  ['Products & Inventory', 'product_attributes', 'GET', '/presale/products/:id/attributes', ''],
  ['Products & Inventory', 'product_attributes', 'PUT', '/presale/products/:id/attributes', ''],
  ['Products & Inventory', 'product_variants', 'GET', '/presale/catalog/products/:productId/variants', ''],
  ['Products & Inventory', 'product_variants', 'POST', '/presale/catalog/products/:productId/variants', ''],
  ['Products & Inventory', 'product_variants', 'PUT', '/presale/catalog/products/:productId/variants/:variantId', ''],
  ['Products & Inventory', 'product_variants', 'DELETE', '/presale/catalog/products/:productId/variants/:variantId', ''],
  ['Products & Inventory', 'product_skus', 'POST', '/presale/catalog/products/:productId/skus/generate', ''],
  ['Products & Inventory', 'product_skus', 'PUT', '/presale/catalog/skus/:skuId', ''],
  ['Products & Inventory', 'product_skus', 'GET', '/presale/catalog/products/:productId/detail', ''],
  ['Products & Inventory', 'product_barcodes', '', '', 'No dedicated route — referenced via SKUs'],
  ['Products & Inventory', 'product_stock_adjustments', 'POST', '/presale/products/:id/adjust-stock', ''],
  ['Products & Inventory', 'product_stock_adjustments', 'GET', '/presale/products/:id/stock-history', ''],
  ['Products & Inventory', 'purchase_orders', 'GET', '/presale/inventory/purchase-orders', ''],
  ['Products & Inventory', 'purchase_orders', 'POST', '/presale/inventory/purchase-orders', ''],
  ['Products & Inventory', 'purchase_orders', 'GET', '/presale/inventory/purchase-orders/:id', ''],
  ['Products & Inventory', 'purchase_orders', 'POST', '/presale/inventory/purchase-orders/:id/receive', ''],
  ['Products & Inventory', 'purchase_order_items', 'POST', '/presale/inventory/purchase-orders', ''],
  ['Products & Inventory', 'purchase_order_items', 'GET', '/presale/inventory/purchase-orders/:id', ''],
  ['Products & Inventory', 'purchase_order_items', 'POST', '/presale/inventory/purchase-orders/:id/receive', ''],
  ['Products & Inventory', 'stock_adjustment_reasons', '', '', 'Lookup only — no dedicated route'],
  ['Products & Inventory', 'category_attribute_templates', 'GET', '/presale/products/attribute-templates', ''],

  // CATALOG & PRICING
  ['Catalog & Pricing', 'brands', 'GET', '/presale/catalog/brands', ''],
  ['Catalog & Pricing', 'brands', 'POST', '/presale/catalog/brands', ''],
  ['Catalog & Pricing', 'brands', 'PUT', '/presale/catalog/brands/:id', ''],
  ['Catalog & Pricing', 'brands', 'GET', '/presale/catalog/collections', ''],
  ['Catalog & Pricing', 'collections', 'GET', '/presale/catalog/collections', ''],
  ['Catalog & Pricing', 'collections', 'POST', '/presale/catalog/collections', ''],
  ['Catalog & Pricing', 'collections', 'PUT', '/presale/catalog/collections/:id', ''],
  ['Catalog & Pricing', 'price_lists', 'GET', '/presale/catalog/products/:productId/detail', 'Via SKU prices'],
  ['Catalog & Pricing', 'product_sku_prices', 'PUT', '/presale/catalog/skus/:skuId', ''],
  ['Catalog & Pricing', 'product_sku_prices', 'GET', '/presale/catalog/products/:productId/detail', ''],
  ['Catalog & Pricing', 'warehouses', 'GET', '/presale/catalog/warehouses', ''],
  ['Catalog & Pricing', 'inventory', 'GET', '/presale/catalog/inventory', ''],
  ['Catalog & Pricing', 'inventory', 'POST', '/presale/catalog/inventory/adjust', ''],
  ['Catalog & Pricing', 'inventory_transactions', 'POST', '/presale/catalog/inventory/adjust', 'Audit log on adjust'],
  ['Catalog & Pricing', 'stock_reservations', 'POST', '/presale/orders', 'Reserved on order create'],
  ['Catalog & Pricing', 'nft_product_assets', '', '', 'No route — DB-only NFT↔Product linkage'],

  // NFT RECORDS & LIFECYCLE
  ['NFT Records & Lifecycle', 'nft_records', 'GET', '/presale/nft', ''],
  ['NFT Records & Lifecycle', 'nft_records', 'POST', '/presale/nft', ''],
  ['NFT Records & Lifecycle', 'nft_records', 'POST', '/presale/nft/bulk', ''],
  ['NFT Records & Lifecycle', 'nft_records', 'GET', '/presale/nft/:id', ''],
  ['NFT Records & Lifecycle', 'nft_records', 'PUT', '/presale/nft/:id', ''],
  ['NFT Records & Lifecycle', 'nft_records', 'GET', '/nft-sell/collection/tokens', ''],
  ['NFT Records & Lifecycle', 'nft_records', 'POST', '/nft-sell/collection/reveal-wave', ''],
  ['NFT Records & Lifecycle', 'nft_stages', 'GET', '/presale/nft', ''],
  ['NFT Records & Lifecycle', 'nft_stages', 'POST', '/presale/nft', ''],
  ['NFT Records & Lifecycle', 'nft_stages', 'GET', '/presale/master', ''],
  ['NFT Records & Lifecycle', 'nft_stages', 'GET', '/presale/reports/sales-by-stage', ''],
  ['NFT Records & Lifecycle', 'nft_types', 'GET', '/presale/nft', ''],
  ['NFT Records & Lifecycle', 'nft_types', 'POST', '/presale/nft', ''],
  ['NFT Records & Lifecycle', 'nft_types', 'GET', '/presale/master', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'GET', '/presale/waves', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'GET', '/presale/waves/:id', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'PUT', '/presale/waves/:id', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'PUT', '/presale/nft/:id', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'GET', '/nft-sell/waves', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'POST', '/nft-sell/collection/reveal-wave', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'POST', '/nft-sell/waves/:num/auction-listing', ''],
  ['NFT Records & Lifecycle', 'nft_waves', 'PUT', '/nft-sell/waves/:num/dutch-auction', ''],

  // NFT GENERATION
  ['NFT Generation', 'nft_collections', 'GET', '/nft-gen/collections', ''],
  ['NFT Generation', 'nft_collections', 'POST', '/nft-gen/collections', ''],
  ['NFT Generation', 'nft_collections', 'GET', '/nft-gen/collections/:id', ''],
  ['NFT Generation', 'nft_collections', 'PUT', '/nft-gen/collections/:id', ''],
  ['NFT Generation', 'nft_collections', 'DELETE', '/nft-gen/collections/:id', ''],
  ['NFT Generation', 'nft_layers', 'GET', '/nft-gen/collections/:id/layers', ''],
  ['NFT Generation', 'nft_layers', 'POST', '/nft-gen/collections/:id/layers', ''],
  ['NFT Generation', 'nft_layers', 'PUT', '/nft-gen/collections/:id/layers/reorder', ''],
  ['NFT Generation', 'nft_layers', 'GET', '/nft-gen/layers/:id', ''],
  ['NFT Generation', 'nft_layers', 'PUT', '/nft-gen/layers/:id', ''],
  ['NFT Generation', 'nft_layers', 'DELETE', '/nft-gen/layers/:id', ''],
  ['NFT Generation', 'nft_traits', 'GET', '/nft-gen/layers/:id/traits', ''],
  ['NFT Generation', 'nft_traits', 'POST', '/nft-gen/layers/:id/traits', ''],
  ['NFT Generation', 'nft_traits', 'PUT', '/nft-gen/traits/:id', ''],
  ['NFT Generation', 'nft_traits', 'DELETE', '/nft-gen/traits/:id', ''],
  ['NFT Generation', 'nft_generation_jobs', 'POST', '/nft-gen/collections/:id/jobs', ''],
  ['NFT Generation', 'nft_generation_jobs', 'GET', '/nft-gen/jobs/:id', ''],
  ['NFT Generation', 'nft_generation_jobs', 'POST', '/nft-gen/jobs/:id/start', ''],
  ['NFT Generation', 'nft_generation_jobs', 'PATCH', '/nft-gen/jobs/:id/progress', ''],
  ['NFT Generation', 'nft_generation_jobs', 'POST', '/nft-gen/jobs/:id/complete', ''],
  ['NFT Generation', 'nft_generation_jobs', 'POST', '/nft-gen/jobs/:id/fail', ''],
  ['NFT Generation', 'nft_generated_items', 'GET', '/nft-gen/jobs/:id/items', ''],
  ['NFT Generation', 'nft_generated_items', 'GET', '/nft-gen/jobs/:id/rarity', ''],
  ['NFT Generation', 'nft_generated_items', 'PATCH', '/nft-gen/upload-batches/items/:itemId/ipfs', ''],
  ['NFT Generation', 'nft_item_traits', '', '', 'Populated internally during generation job — no direct route'],
  ['NFT Generation', 'nft_upload_batches', 'POST', '/nft-gen/jobs/:id/upload-batches', ''],
  ['NFT Generation', 'nft_upload_batches', 'GET', '/nft-gen/upload-batches/:id', ''],
  ['NFT Generation', 'nft_upload_batches', 'POST', '/nft-gen/upload-batches/:id/start', ''],
  ['NFT Generation', 'nft_upload_batches', 'PATCH', '/nft-gen/upload-batches/:id/progress', ''],
  ['NFT Generation', 'nft_upload_batches', 'POST', '/nft-gen/upload-batches/:id/complete', ''],
  ['NFT Generation', 'nft_upload_batches', 'POST', '/nft-gen/upload-batches/:id/fail', ''],

  // NFT SELLING ECOSYSTEM
  ['NFT Selling Ecosystem', 'nft_collection_config', 'GET', '/nft-sell/collection', ''],
  ['NFT Selling Ecosystem', 'nft_collection_config', 'GET', '/nft-sell/collection/stats', ''],
  ['NFT Selling Ecosystem', 'nft_royalty_config', 'GET', '/nft-sell/royalty', ''],
  ['NFT Selling Ecosystem', 'nft_purchase_limit_config', 'GET', '/nft-sell/customers/limits', ''],
  ['NFT Selling Ecosystem', 'nft_allowed_marketplaces', 'GET', '/nft-sell/royalty/marketplaces', ''],
  ['NFT Selling Ecosystem', 'nft_allowed_marketplaces', 'PUT', '/nft-sell/royalty/marketplaces', ''],
  ['NFT Selling Ecosystem', 'nft_contract_events', 'GET', '/nft-sell/collection/events', ''],
  ['NFT Selling Ecosystem', 'nft_contract_events', 'POST', '/nft-sell/waves/resync', ''],
  ['NFT Selling Ecosystem', 'nft_strategy_activations', 'GET', '/nft-sell/collection/launch-status', ''],
  ['NFT Selling Ecosystem', 'nft_admin_sales', 'GET', '/nft-sell/admin-sales', ''],
  ['NFT Selling Ecosystem', 'nft_admin_sales', 'POST', '/nft-sell/admin-sales', ''],
  ['NFT Selling Ecosystem', 'nft_admin_sales', 'POST', '/nft-sell/admin-sales/:id/mint', ''],
  ['NFT Selling Ecosystem', 'nft_admin_sales', 'PATCH', '/nft-sell/admin-sales/:id/status', ''],
  ['NFT Selling Ecosystem', 'nft_sale_modes', 'GET', '/nft-sell/lookups/sale-modes', ''],
  ['NFT Selling Ecosystem', 'nft_sale_modes', 'PUT', '/nft-sell/lookups/sale-modes', ''],
  ['NFT Selling Ecosystem', 'nft_sale_modes', 'PATCH', '/nft-sell/lookups/sale-modes/:code/toggle', ''],
  ['NFT Selling Ecosystem', 'nft_sale_modes', 'GET', '/nft-sell/admin-sales', 'Join for sale mode label'],
  ['NFT Selling Ecosystem', 'nft_payment_currencies', 'GET', '/nft-sell/lookups/currencies', ''],
  ['NFT Selling Ecosystem', 'nft_payment_currencies', 'PUT', '/nft-sell/lookups/currencies', ''],
  ['NFT Selling Ecosystem', 'nft_payment_currencies', 'PATCH', '/nft-sell/lookups/currencies/:code/toggle', ''],
  ['NFT Selling Ecosystem', 'nft_sale_statuses', 'GET', '/nft-sell/lookups/sale-statuses', ''],
  ['NFT Selling Ecosystem', 'nft_sale_statuses', 'GET', '/nft-sell/lookups', ''],
  ['NFT Selling Ecosystem', 'nft_wave_sale_methods', 'GET', '/nft-sell/lookups/wave-sale-methods', ''],
  ['NFT Selling Ecosystem', 'nft_wave_sale_methods', 'PATCH', '/nft-sell/lookups/wave-sale-methods/:code/toggle', ''],
  ['NFT Selling Ecosystem', 'nft_staking_config', 'GET', '/nft-sell/staking/config', ''],
  ['NFT Selling Ecosystem', 'nft_staking_config', 'PUT', '/nft-sell/staking/config', ''],

  // WHITELIST & WALLETS
  ['Whitelist & Wallets', 'customer_wallets', 'GET', '/presale/customers/:id/wallets', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'POST', '/presale/customers/:id/wallets', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'DELETE', '/presale/customers/:id/wallets/:walletId', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'GET', '/whitelist', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'POST', '/whitelist', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'POST', '/whitelist/add', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'DELETE', '/whitelist/:address', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'GET', '/whitelist/entries', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'GET', '/whitelist/export', ''],
  ['Whitelist & Wallets', 'customer_wallets', 'GET', '/proof', ''],
  ['Whitelist & Wallets', 'whitelist_state', 'GET', '/whitelist/merkle-root', ''],
  ['Whitelist & Wallets', 'whitelist_state', 'PUT', '/whitelist/merkle-root', ''],
  ['Whitelist & Wallets', 'whitelist_state', 'DELETE', '/whitelist/merkle-root', ''],
  ['Whitelist & Wallets', 'whitelist_state', 'GET', '/whitelist/entries', ''],
  ['Whitelist & Wallets', 'whitelist_state', 'GET', '/whitelist/export', ''],

  // OPENSEA CACHE
  ['OpenSea Cache', 'os_collections', 'GET', '/opensea/collections', ''],
  ['OpenSea Cache', 'os_collections', 'GET', '/opensea/collections/:slug', ''],
  ['OpenSea Cache', 'os_collections', 'POST', '/opensea/collections/:slug/sync', ''],
  ['OpenSea Cache', 'os_collections', 'GET', '/opensea/collections/trending', ''],
  ['OpenSea Cache', 'os_collections', 'GET', '/opensea/collections/top', ''],
  ['OpenSea Cache', 'os_collections', 'GET', '/opensea/accounts/:address/collections', ''],
  ['OpenSea Cache', 'os_collection_stats', 'GET', '/opensea/collections/:slug/stats', ''],
  ['OpenSea Cache', 'os_collection_stats', 'POST', '/opensea/collections/:slug/sync', ''],
  ['OpenSea Cache', 'os_collection_stats', 'GET', '/opensea/collections/trending', ''],
  ['OpenSea Cache', 'os_collection_stats', 'GET', '/opensea/collections/top', ''],
  ['OpenSea Cache', 'os_collection_traits', 'GET', '/opensea/collections/:slug/traits', ''],
  ['OpenSea Cache', 'os_nfts', 'GET', '/opensea/nfts/chain/:chain/contract/:contractAddress/:identifier', ''],
  ['OpenSea Cache', 'os_nfts', 'GET', '/opensea/nfts/collection/:slug', ''],
  ['OpenSea Cache', 'os_nfts', 'POST', '/opensea/nfts/collection/:slug/sync-all', ''],
  ['OpenSea Cache', 'os_nfts', 'GET', '/opensea/nfts/account/:address', ''],
  ['OpenSea Cache', 'os_listings', 'GET', '/opensea/listings/collection/:slug', ''],
  ['OpenSea Cache', 'os_listings', 'GET', '/opensea/listings/collection/:slug/best', ''],
  ['OpenSea Cache', 'os_listings', 'POST', '/opensea/listings/collection/:slug/sync', ''],
  ['OpenSea Cache', 'os_listings', 'GET', '/opensea/accounts/:address/listings', ''],
  ['OpenSea Cache', 'os_offers', 'GET', '/opensea/offers/collection/:slug', ''],
  ['OpenSea Cache', 'os_offers', 'GET', '/opensea/offers/collection/:slug/best', ''],
  ['OpenSea Cache', 'os_offers', 'POST', '/opensea/offers/collection/:slug/sync', ''],
  ['OpenSea Cache', 'os_offers', 'GET', '/opensea/accounts/:address/offers-received', ''],
  ['OpenSea Cache', 'os_offers', 'GET', '/opensea/accounts/:address/offers-made', ''],
  ['OpenSea Cache', 'os_events', 'GET', '/opensea/events/collection/:slug', ''],
  ['OpenSea Cache', 'os_events', 'GET', '/opensea/events/chain/:chain/contract/:contractAddress/nft/:tokenId', ''],
  ['OpenSea Cache', 'os_events', 'GET', '/opensea/events/account/:address', ''],
  ['OpenSea Cache', 'os_events', 'POST', '/opensea/events/collection/:slug/sync', ''],
  ['OpenSea Cache', 'os_events', 'GET', '/opensea/accounts/:address/pnl', ''],
  ['OpenSea Cache', 'os_accounts', 'GET', '/opensea/accounts', ''],
  ['OpenSea Cache', 'os_accounts', 'GET', '/opensea/accounts/:addressOrUsername', ''],
  ['OpenSea Cache', 'os_accounts', 'POST', '/opensea/accounts/:addressOrUsername/sync', ''],
  ['OpenSea Cache', 'os_accounts', 'GET', '/opensea/nfts/chain/:chain/contract/:contractAddress/:identifier/owners', ''],

  // LOOKUP & MASTER
  ['Lookup & Master', 'currencies', 'GET', '/presale/reconciliation', ''],
  ['Lookup & Master', 'currencies', 'GET', '/presale/master', ''],
  ['Lookup & Master', 'payment_methods', 'GET', '/presale/orders', ''],
  ['Lookup & Master', 'payment_methods', 'GET', '/presale/reconciliation', ''],
  ['Lookup & Master', 'payment_methods', 'GET', '/presale/master', ''],
  ['Lookup & Master', 'payment_methods', 'GET', '/presale/payment-methods', ''],
  ['Lookup & Master', 'payment_methods', 'POST', '/presale/payment-methods', ''],
  ['Lookup & Master', 'payment_methods', 'PUT', '/presale/payment-methods/:id', ''],
  ['Lookup & Master', 'payment_methods', 'DELETE', '/presale/payment-methods/:id', ''],
  ['Lookup & Master', 'payment_statuses', 'GET', '/presale/orders', ''],
  ['Lookup & Master', 'payment_statuses', 'GET', '/presale/master', ''],
  ['Lookup & Master', 'delivery_statuses', 'GET', '/presale/nft', ''],
  ['Lookup & Master', 'delivery_statuses', 'GET', '/presale/reports/delivery', ''],
  ['Lookup & Master', 'delivery_statuses', 'GET', '/presale/master', ''],
  ['Lookup & Master', 'exchange_rates', '', '', 'No route — internal currency conversion only'],

];

// ── BUILD WORKBOOK ─────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

// ── SHEET 1: Full Mapping ──────────────────────────────────────────────────────
const headers = ['Domain', 'Table Name', 'HTTP Method', 'API Route', 'Notes'];
const sheet1Data = [headers, ...data];
const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);

// Column widths
ws1['!cols'] = [
  { wch: 28 },  // Domain
  { wch: 34 },  // Table Name
  { wch: 10 },  // Method
  { wch: 75 },  // Route
  { wch: 45 },  // Notes
];

// Freeze header row
ws1['!freeze'] = { xSplit: 0, ySplit: 1 };

// Style header row
const headerRange = XLSX.utils.decode_range(ws1['!ref']);
for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
  const cell = ws1[XLSX.utils.encode_cell({ r: 0, c: col })];
  if (cell) {
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F3864' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } },
      },
    };
  }
}

// Domain color map
const domainColors = {
  'Auth & RBAC':                  'D6E4F7',
  'Orders & Sales':               'FFF2CC',
  'Products & Inventory':         'E2EFDA',
  'Catalog & Pricing':            'FCE4D6',
  'NFT Records & Lifecycle':      'EAD1DC',
  'NFT Generation':               'D9D2E9',
  'NFT Selling Ecosystem':        'CFE2F3',
  'Whitelist & Wallets':          'F4CCCC',
  'OpenSea Cache':                'D0E0E3',
  'Lookup & Master':              'FFF9C4',
};

const methodColors = {
  'GET':    'C6EFCE',
  'POST':   'FFEB9C',
  'PUT':    'BDD7EE',
  'PATCH':  'EDEDED',
  'DELETE': 'FFC7CE',
  '':       'F2F2F2',
};

// Apply row styles
for (let row = 1; row <= data.length; row++) {
  const domain = data[row - 1][0];
  const method = data[row - 1][2];
  const domainFill = domainColors[domain] || 'FFFFFF';
  const methodFill = methodColors[method] || 'FFFFFF';

  for (let col = 0; col <= 4; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: row, c: col });
    if (!ws1[cellAddr]) ws1[cellAddr] = { t: 's', v: '' };
    ws1[cellAddr].s = {
      fill: { fgColor: { rgb: col === 2 ? methodFill : domainFill } },
      font: { name: 'Calibri', sz: 10, bold: col === 1 },
      alignment: { vertical: 'center', wrapText: true },
      border: {
        top:    { style: 'thin', color: { rgb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
        left:   { style: 'thin', color: { rgb: 'CCCCCC' } },
        right:  { style: 'thin', color: { rgb: 'CCCCCC' } },
      },
    };
  }
}

XLSX.utils.book_append_sheet(wb, ws1, 'Table-API Mapping');

// ── SHEET 2: Summary by Domain ─────────────────────────────────────────────────
const domainMap = {};
for (const row of data) {
  const [domain, table] = row;
  if (!domainMap[domain]) domainMap[domain] = new Set();
  domainMap[domain].add(table);
}

const summaryHeaders = ['Domain', 'Table Count', 'Tables'];
const summaryData = [summaryHeaders];
for (const [domain, tables] of Object.entries(domainMap)) {
  summaryData.push([domain, tables.size, [...tables].join(', ')]);
}
summaryData.push(['', '', '']);
summaryData.push(['TOTAL TABLES', new Set(data.map(r => r[1])).size, '']);

const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
ws2['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 100 }];

// Style summary header
for (let col = 0; col <= 2; col++) {
  const cell = ws2[XLSX.utils.encode_cell({ r: 0, c: col })];
  if (cell) {
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F3864' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }
}

// Style summary rows
for (let row = 1; row < summaryData.length; row++) {
  const domain = summaryData[row][0];
  const fill = domainColors[domain] || 'FFFFFF';
  for (let col = 0; col <= 2; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: row, c: col });
    if (!ws2[cellAddr]) ws2[cellAddr] = { t: 's', v: '' };
    ws2[cellAddr].s = {
      fill: { fgColor: { rgb: fill } },
      font: { name: 'Calibri', sz: 10, bold: col === 1 || domain === 'TOTAL TABLES' },
      alignment: { vertical: 'center', wrapText: true },
      border: {
        top:    { style: 'thin', color: { rgb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
        left:   { style: 'thin', color: { rgb: 'CCCCCC' } },
        right:  { style: 'thin', color: { rgb: 'CCCCCC' } },
      },
    };
  }
}

XLSX.utils.book_append_sheet(wb, ws2, 'Summary by Domain');

// ── SHEET 3: Uncovered Tables ──────────────────────────────────────────────────
const uncovered = data.filter(r => r[2] === '').map(r => [r[0], r[1], r[4]]);
const ws3 = XLSX.utils.aoa_to_sheet([
  ['Domain', 'Table Name', 'Reason / Notes'],
  ...uncovered,
]);
ws3['!cols'] = [{ wch: 28 }, { wch: 34 }, { wch: 55 }];

for (let col = 0; col <= 2; col++) {
  const cell = ws3[XLSX.utils.encode_cell({ r: 0, c: col })];
  if (cell) {
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '990000' } },
      alignment: { horizontal: 'center' },
    };
  }
}

XLSX.utils.book_append_sheet(wb, ws3, 'No-Route Tables');

// ── WRITE FILE ─────────────────────────────────────────────────────────────────
const outPath = './BearthDev_Table_API_Mapping.xlsx';
XLSX.writeFile(wb, outPath, { bookType: 'xlsx', cellStyles: true });
console.log('Excel file written to:', outPath);
console.log('Total data rows:', data.length);
console.log('Unique tables:', new Set(data.map(r => r[1])).size);
console.log('Uncovered tables:', uncovered.length);
