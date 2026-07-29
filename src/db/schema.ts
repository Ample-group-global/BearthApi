import {
  pgTable, uuid, varchar, text, boolean, integer, numeric, serial,
  timestamp, date, bigint, jsonb, index, uniqueIndex, type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { relations } from "drizzle-orm";

// ── Auth / RBAC ───────────────────────────────────────────────────────────────

export const roles = pgTable("roles", {
  id:       uuid("id").primaryKey().defaultRandom(),
  code:     varchar("code", { length: 50 }).notNull().unique(),
  name:     varchar("name", { length: 100 }).notNull(),
  homeUrl:  text("home_url"),
  isActive: boolean("is_active").notNull().default(true),
});

export const permissions = pgTable("permissions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  key:       varchar("key", { length: 100 }).notNull().unique(),
  label:     varchar("label", { length: 150 }).notNull(),
  module:    varchar("module", { length: 50 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId:       uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  isGranted:    boolean("is_granted").notNull().default(true),
});

export const users = pgTable("users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userCode:     varchar("user_code", { length: 10 }).unique(),
  email:        varchar("email", { length: 255 }).unique(),
  firstName:    varchar("first_name", { length: 100 }).notNull().default(""),
  lastName:     varchar("last_name",  { length: 100 }).notNull().default(""),
  phone:        varchar("phone", { length: 50 }),
  lineId:       varchar("line_id", { length: 100 }),
  referrerId:   uuid("referrer_id").references((): AnyPgColumn => users.id),
  notes:        text("notes"),
  roleId:       uuid("role_id").references(() => roles.id),
  passwordHash: text("password_hash"),
  isActive:     boolean("is_active").notNull().default(true),
  lastLoginAt:  timestamp("last_login_at", { withTimezone: true }),
  createdAt:    timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_users_role_id").on(t.roleId),
  index("idx_users_referrer_id").on(t.referrerId),
]);

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  isGranted:    boolean("is_granted").notNull(),
  reason:       text("reason"),
  actionedAt:   timestamp("actioned_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Menu / Navigation (new) ───────────────────────────────────────────────────

export const menus = pgTable("menus", {
  id:        uuid("id").primaryKey().defaultRandom(),
  label:     text("label").notNull(),
  href:      text("href").notNull(),
  icon:      text("icon"),
  module:    varchar("module", { length: 50 }),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
});

export const roleMenus = pgTable("role_menus", {
  roleId:    uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  menuId:    uuid("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ── Unified Lookup Table (v12: replaces payment_statuses, product_statuses,
//    delivery_statuses, nft_stages, nft_types, nft_sale_modes, nft_sale_statuses,
//    nft_payment_currencies, stock_adjustment_reasons) ──────────────────────────

export const lookupValues = pgTable("lookup_values", {
  id:          uuid("id").primaryKey().defaultRandom(),
  category:    varchar("category",    { length: 50  }).notNull(),
  code:        varchar("code",        { length: 100 }).notNull(),
  label:       varchar("label",       { length: 200 }).notNull(),
  isActive:    boolean("is_active").notNull().default(true),
  sortOrder:   integer("sort_order").notNull().default(0),
  colorHex:    varchar("color_hex",   { length: 7   }),
  symbol:      varchar("symbol",      { length: 10  }),
  isCrypto:    boolean("is_crypto"),
  tag:         varchar("tag",         { length: 50  }),
  description: text("description"),
  notes:       text("notes"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_lookup_values_category_code").on(t.category, t.code),
  index("idx_lookup_values_category").on(t.category),
]);

// ── Lookup / Master Tables ────────────────────────────────────────────────────

export const currencies = pgTable("currencies", {
  id:     uuid("id").primaryKey().defaultRandom(),
  code:   varchar("code", { length: 10 }).notNull().unique(),
  name:   varchar("name", { length: 50 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
});

export const paymentMethods = pgTable("payment_methods", {
  id:        uuid("id").primaryKey().defaultRandom(),
  code:      varchar("code", { length: 50 }).notNull().unique(),
  name:      varchar("name", { length: 100 }).notNull(),
  isActive:  boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// payment_statuses, product_statuses, delivery_statuses, nft_stages, nft_types
// were merged into lookupValues (migrate_v12). Use lookupValues with .category filter.

export const exchangeRates = pgTable("exchange_rates", {
  id:            uuid("id").primaryKey().defaultRandom(),
  fromCode:      varchar("from_code", { length: 10 }).notNull(),
  toCode:        varchar("to_code",   { length: 10 }).notNull(),
  rate:          numeric("rate", { precision: 20, scale: 8 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
});

// ── Business Tables ───────────────────────────────────────────────────────────

export const orders = pgTable("orders", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  orderNumber:           varchar("order_number", { length: 50 }).notNull().unique(),
  customerId:            uuid("customer_id").notNull().references(() => users.id),
  referrerId:            uuid("referrer_id").references(() => users.id),
  purchaseDate:          date("purchase_date").notNull().default("now()"),
  paymentNotes:          text("payment_notes"),
  notes:                 text("notes"),
  // NFT payment
  nftPaymentMethodId:    uuid("nft_payment_method_id").references(() => paymentMethods.id),
  nftAmountTwd:          numeric("nft_amount_twd",  { precision: 18, scale: 2 }),
  nftAmountEth:          numeric("nft_amount_eth",  { precision: 18, scale: 8 }),
  nftCurrencyId:         uuid("nft_currency_id").references(() => currencies.id),
  nftPaymentStatusId:    uuid("nft_payment_status_id").references(() => lookupValues.id),
  nftConfirmedAt:        timestamp("nft_confirmed_at",   { withTimezone: true }),
  nftConfirmedBy:        uuid("nft_confirmed_by").references(() => users.id),
  // Merch payment
  merchPaymentMethodId:  uuid("merch_payment_method_id").references(() => paymentMethods.id),
  merchAmountTwd:        numeric("merch_amount_twd", { precision: 18, scale: 2 }),
  merchCurrencyId:       uuid("merch_currency_id").references(() => currencies.id),
  merchPaymentStatusId:  uuid("merch_payment_status_id").references(() => lookupValues.id),
  merchConfirmedAt:      timestamp("merch_confirmed_at",  { withTimezone: true }),
  merchConfirmedBy:      uuid("merch_confirmed_by").references(() => users.id),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_orders_customer_id").on(t.customerId),
  index("idx_orders_nft_status_id").on(t.nftPaymentStatusId),
]);

export const nftRecords = pgTable("nft_records", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  serialNumber:        varchar("serial_number", { length: 50 }).notNull().unique(),
  notes:               text("notes"),
  stageId:             uuid("stage_id").notNull().references(() => lookupValues.id),
  nftTypeId:           uuid("nft_type_id").references(() => lookupValues.id),
  deliveryStatusId:    uuid("delivery_status_id").references(() => lookupValues.id),
  deliveredAt:         timestamp("delivered_at", { withTimezone: true }),
  // NFT generation + lifecycle (Generate → Metadata → IPFS → Mint [blind] → Reveal → Sell)
  traits:              jsonb("traits"),                // {"Background":"Blue","Body":"Gold",...}
  imageIpfsHash:       text("image_ipfs_hash"),        // CID of actual image (hidden pre-reveal)
  metadataIpfsHash:    text("metadata_ipfs_hash"),     // CID of actual metadata JSON
  metadataUri:         text("metadata_uri"),           // ipfs://<metadataIpfsHash>
  // Blind box: generic placeholder shown until reveal event
  blindBoxUri:         text("blind_box_uri"),          // URI of placeholder metadata
  isRevealed:          boolean("is_revealed").notNull().default(false),
  revealedAt:          timestamp("revealed_at", { withTimezone: true }),
  // On-chain
  tokenId:             bigint("token_id", { mode: "number" }),
  mintTxHash:          text("mint_tx_hash"),
  mintedAt:            timestamp("minted_at", { withTimezone: true }),
  ownerAddress:        text("owner_address"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderNftItems = pgTable("order_nft_items", {
  id:            uuid("id").primaryKey().defaultRandom(),
  orderId:       uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  nftRecordId:   uuid("nft_record_id").notNull().references(() => nftRecords.id),
  walletAddress: text("wallet_address"),
  unitPriceTwd:  numeric("unit_price_twd", { precision: 18, scale: 2 }),
  unitPriceEth:  numeric("unit_price_eth", { precision: 18, scale: 8 }),
  currencyId:    uuid("currency_id").references(() => currencies.id),
  notes:         text("notes"),
});

export const products = pgTable("products", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         varchar("name", { length: 200 }).notNull(),
  description:  text("description"),
  retailPrice:  numeric("retail_price",  { precision: 18, scale: 2 }),
  presalePrice: numeric("presale_price", { precision: 18, scale: 2 }),
  statusId:     uuid("status_id").references(() => lookupValues.id),
  stockQty:     integer("stock_qty"),
  sortOrder:    integer("sort_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderProductItems = pgTable("order_product_items", {
  id:        uuid("id").primaryKey().defaultRandom(),
  orderId:   uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity:  integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
  notes:     text("notes"),
});

export const orderOperationLogs = pgTable("order_operation_logs", {
  id:          uuid("id").primaryKey().defaultRandom(),
  orderId:     uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  userId:      uuid("user_id").references(() => users.id),
  action:      text("action").notNull(),
  description: text("description").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationEntries = pgTable("reconciliation_entries", {
  id:              uuid("id").primaryKey().defaultRandom(),
  orderId:         uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  customerId:      uuid("customer_id").references(() => users.id),
  entryType:       varchar("entry_type", { length: 50 }).notNull(),
  amountTwd:       numeric("amount_twd", { precision: 18, scale: 2 }),
  amountEth:       numeric("amount_eth", { precision: 18, scale: 8 }),
  currencyId:      uuid("currency_id").references(() => currencies.id),
  paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id),
  status:          varchar("status", { length: 30 }).notNull().default("pending"),
  notes:           text("notes"),
  confirmedAt:     timestamp("confirmed_at",  { withTimezone: true }),
  cancelledAt:     timestamp("cancelled_at",  { withTimezone: true }),
  createdAt:       timestamp("created_at",    { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at",    { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_recon_order_id").on(t.orderId),
  index("idx_recon_status").on(t.status),
]);

// ── Whitelist / On-chain ──────────────────────────────────────────────────────

export const customerWallets = pgTable("customer_wallets", {
  id:            uuid("id").primaryKey().defaultRandom(),
  userId:        uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  address:       text("address").notNull(),
  isWhitelisted: boolean("is_whitelisted").notNull().default(true),
  addedAt:       timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_customer_wallets_address_lower").on(t.address),
]);

export const whitelistState = pgTable("whitelist_state", {
  id:             integer("id").primaryKey().default(1),
  merkleRoot:     text("merkle_root").notNull().default("0x0"),
  manualOverride: boolean("manual_override").notNull().default(false),
  lastUpdated:    timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  role:               one(roles,       { fields: [users.roleId],     references: [roles.id] }),
  referrer:           one(users,       { fields: [users.referrerId], references: [users.id], relationName: "referral" }),
  referrals:          many(users,      { relationName: "referral" }),
  permOverrides:      many(userPermissionOverrides),
  wallets:            many(customerWallets),
  ordersAsCustomer:   many(orders, { relationName: "customer_orders" }),
  ordersAsReferrer:   many(orders, { relationName: "referrer_orders" }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users:       many(users),
  permissions: many(rolePermissions),
  menus:       many(roleMenus),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer:          one(users,         { fields: [orders.customerId],          references: [users.id], relationName: "customer_orders" }),
  referrer:          one(users,         { fields: [orders.referrerId],          references: [users.id], relationName: "referrer_orders" }),
  nftPaymentStatus:  one(lookupValues,  { fields: [orders.nftPaymentStatusId],  references: [lookupValues.id] }),
  merchPaymentStatus:one(lookupValues,  { fields: [orders.merchPaymentStatusId],references: [lookupValues.id] }),
  nftItems:          many(orderNftItems),
  productItems:      many(orderProductItems),
  logs:              many(orderOperationLogs),
  reconciliations:   many(reconciliationEntries),
}));

// ── OpenSea Cache Tables ──────────────────────────────────────────────────────

export const osCollections = pgTable("os_collections", {
  id:                       serial("id").primaryKey(),
  slug:                     varchar("slug", { length: 300 }).notNull().unique(),
  name:                     varchar("name", { length: 500 }).notNull(),
  description:              text("description"),
  imageUrl:                 varchar("image_url", { length: 2000 }),
  bannerImageUrl:           varchar("banner_image_url", { length: 2000 }),
  externalUrl:              varchar("external_url", { length: 2000 }),
  twitterUsername:          varchar("twitter_username", { length: 300 }),
  discordUrl:               varchar("discord_url", { length: 2000 }),
  telegramUrl:              varchar("telegram_url", { length: 2000 }),
  instagramUsername:        varchar("instagram_username", { length: 300 }),
  wikiUrl:                  varchar("wiki_url", { length: 2000 }),
  category:                 varchar("category", { length: 200 }),
  isDisabled:               boolean("is_disabled").notNull().default(false),
  isNsfw:                   boolean("is_nsfw").notNull().default(false),
  traitOffersEnabled:       boolean("trait_offers_enabled").notNull().default(false),
  collectionOffersEnabled:  boolean("collection_offers_enabled").notNull().default(false),
  openseaUrl:               varchar("opensea_url", { length: 2000 }),
  projectUrl:               varchar("project_url", { length: 2000 }),
  wikipediaUrl:             varchar("wikipedia_url", { length: 2000 }),
  chain:                    varchar("chain", { length: 100 }).notNull().default("ethereum"),
  createdDate:              timestamp("created_date", { withTimezone: true }),
  syncedAt:                 timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osCollectionStats = pgTable("os_collection_stats", {
  id:                      serial("id").primaryKey(),
  collectionSlug:          varchar("collection_slug", { length: 300 }).notNull().unique(),
  floorPrice:              numeric("floor_price", { precision: 28, scale: 10 }).notNull().default("0"),
  floorPriceCurrency:      varchar("floor_price_currency", { length: 50 }),
  averagePrice:            numeric("average_price", { precision: 28, scale: 10 }).notNull().default("0"),
  numOwners:               bigint("num_owners", { mode: "number" }).notNull().default(0),
  totalSupply:             bigint("total_supply", { mode: "number" }).notNull().default(0),
  numReported:             bigint("num_reported", { mode: "number" }).notNull().default(0),
  marketCap:               numeric("market_cap", { precision: 28, scale: 10 }).notNull().default("0"),
  totalVolume:             numeric("total_volume", { precision: 28, scale: 10 }).notNull().default("0"),
  oneDayVolume:            numeric("one_day_volume", { precision: 28, scale: 10 }).notNull().default("0"),
  sevenDayVolume:          numeric("seven_day_volume", { precision: 28, scale: 10 }).notNull().default("0"),
  thirtyDayVolume:         numeric("thirty_day_volume", { precision: 28, scale: 10 }).notNull().default("0"),
  oneDaySales:             bigint("one_day_sales", { mode: "number" }).notNull().default(0),
  sevenDaySales:           bigint("seven_day_sales", { mode: "number" }).notNull().default(0),
  thirtyDaySales:          bigint("thirty_day_sales", { mode: "number" }).notNull().default(0),
  oneDayAveragePrice:      numeric("one_day_average_price", { precision: 28, scale: 10 }).notNull().default("0"),
  sevenDayAveragePrice:    numeric("seven_day_average_price", { precision: 28, scale: 10 }).notNull().default("0"),
  thirtyDayAveragePrice:   numeric("thirty_day_average_price", { precision: 28, scale: 10 }).notNull().default("0"),
  oneDayChange:            numeric("one_day_change", { precision: 18, scale: 4 }).notNull().default("0"),
  sevenDayChange:          numeric("seven_day_change", { precision: 18, scale: 4 }).notNull().default("0"),
  thirtyDayChange:         numeric("thirty_day_change", { precision: 18, scale: 4 }).notNull().default("0"),
  syncedAt:                timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osCollectionTraits = pgTable("os_collection_traits", {
  id:             serial("id").primaryKey(),
  collectionSlug: varchar("collection_slug", { length: 200 }).notNull(),
  traitType:      varchar("trait_type", { length: 200 }).notNull(),
  traitValue:     varchar("trait_value", { length: 400 }).notNull().default(""),
  count:          bigint("count", { mode: "number" }).notNull().default(0),
  syncedAt:       timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osNfts = pgTable("os_nfts", {
  id:                   serial("id").primaryKey(),
  identifier:           varchar("identifier", { length: 200 }).notNull(),
  collectionSlug:       varchar("collection_slug", { length: 300 }).notNull(),
  contractAddress:      varchar("contract_address", { length: 200 }).notNull(),
  chain:                varchar("chain", { length: 100 }).notNull(),
  tokenStandard:        varchar("token_standard", { length: 50 }),
  name:                 varchar("name", { length: 500 }),
  description:          text("description"),
  imageUrl:             varchar("image_url", { length: 2000 }),
  displayImageUrl:      varchar("display_image_url", { length: 2000 }),
  displayAnimationUrl:  varchar("display_animation_url", { length: 2000 }),
  metadataUrl:          varchar("metadata_url", { length: 2000 }),
  openseaUrl:           varchar("opensea_url", { length: 2000 }),
  isDisabled:           boolean("is_disabled").notNull().default(false),
  isNsfw:               boolean("is_nsfw").notNull().default(false),
  isSuspicious:         boolean("is_suspicious").notNull().default(false),
  creatorAddress:       varchar("creator_address", { length: 200 }),
  traitsJson:           jsonb("traits_json"),
  ownersJson:           jsonb("owners_json"),
  rarityJson:           jsonb("rarity_json"),
  updatedAt:            timestamp("updated_at", { withTimezone: true }),
  syncedAt:             timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osListings = pgTable("os_listings", {
  id:              serial("id").primaryKey(),
  orderHash:       varchar("order_hash", { length: 200 }).notNull().unique(),
  chain:           varchar("chain", { length: 100 }).notNull(),
  protocol:        varchar("protocol", { length: 200 }),
  collectionSlug:  varchar("collection_slug", { length: 300 }),
  contractAddress: varchar("contract_address", { length: 200 }).notNull(),
  tokenId:         varchar("token_id", { length: 200 }).notNull(),
  orderType:       varchar("order_type", { length: 100 }).notNull(),
  maker:           varchar("maker", { length: 200 }).notNull(),
  taker:           varchar("taker", { length: 200 }),
  price:           numeric("price", { precision: 38, scale: 18 }).notNull().default("0"),
  priceCurrency:   varchar("price_currency", { length: 50 }),
  priceDecimals:   numeric("price_decimals", { precision: 10, scale: 0 }),
  priceUsd:        numeric("price_usd", { precision: 28, scale: 10 }),
  startDate:       timestamp("start_date", { withTimezone: true }).notNull(),
  expirationDate:  timestamp("expiration_date", { withTimezone: true }).notNull(),
  cancelled:       boolean("cancelled").notNull().default(false),
  finalized:       boolean("finalized").notNull().default(false),
  markedInvalid:   boolean("marked_invalid").notNull().default(false),
  protocolData:    jsonb("protocol_data"),
  syncedAt:        timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osOffers = pgTable("os_offers", {
  id:              serial("id").primaryKey(),
  orderHash:       varchar("order_hash", { length: 200 }).notNull().unique(),
  chain:           varchar("chain", { length: 100 }).notNull(),
  protocol:        varchar("protocol", { length: 200 }),
  collectionSlug:  varchar("collection_slug", { length: 300 }),
  contractAddress: varchar("contract_address", { length: 200 }),
  tokenId:         varchar("token_id", { length: 200 }),
  offerType:       varchar("offer_type", { length: 100 }).notNull(),
  maker:           varchar("maker", { length: 200 }).notNull(),
  taker:           varchar("taker", { length: 200 }),
  price:           numeric("price", { precision: 38, scale: 18 }).notNull().default("0"),
  priceCurrency:   varchar("price_currency", { length: 50 }),
  priceDecimals:   numeric("price_decimals", { precision: 10, scale: 0 }),
  priceUsd:        numeric("price_usd", { precision: 28, scale: 10 }),
  startDate:       timestamp("start_date", { withTimezone: true }).notNull(),
  expirationDate:  timestamp("expiration_date", { withTimezone: true }).notNull(),
  cancelled:       boolean("cancelled").notNull().default(false),
  finalized:       boolean("finalized").notNull().default(false),
  markedInvalid:   boolean("marked_invalid").notNull().default(false),
  traitCriteria:   text("trait_criteria"),
  protocolData:    jsonb("protocol_data"),
  syncedAt:        timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osEvents = pgTable("os_events", {
  id:              serial("id").primaryKey(),
  eventType:       varchar("event_type", { length: 100 }).notNull(),
  chain:           varchar("chain", { length: 100 }).notNull(),
  contractAddress: varchar("contract_address", { length: 200 }).notNull(),
  tokenId:         varchar("token_id", { length: 200 }).notNull(),
  collectionSlug:  varchar("collection_slug", { length: 300 }),
  orderHash:       varchar("order_hash", { length: 200 }),
  fromAddress:     varchar("from_address", { length: 200 }),
  toAddress:       varchar("to_address", { length: 200 }),
  maker:           varchar("maker", { length: 200 }),
  taker:           varchar("taker", { length: 200 }),
  price:           numeric("price", { precision: 38, scale: 18 }),
  priceCurrency:   varchar("price_currency", { length: 50 }),
  priceUsd:        numeric("price_usd", { precision: 28, scale: 10 }),
  quantity:        numeric("quantity", { precision: 28, scale: 10 }),
  transactionHash: varchar("transaction_hash", { length: 200 }),
  blockNumber:     bigint("block_number", { mode: "number" }),
  eventTimestamp:  timestamp("event_timestamp", { withTimezone: true }).notNull(),
  paymentToken:    varchar("payment_token", { length: 200 }),
  syncedAt:        timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const osAccounts = pgTable("os_accounts", {
  id:               serial("id").primaryKey(),
  address:          varchar("address", { length: 200 }).notNull().unique(),
  username:         varchar("username", { length: 300 }),
  profileImageUrl:  varchar("profile_image_url", { length: 2000 }),
  bannerImageUrl:   varchar("banner_image_url", { length: 2000 }),
  bio:              text("bio"),
  website:          varchar("website", { length: 2000 }),
  twitterUsername:  varchar("twitter_username", { length: 300 }),
  instagramUsername:varchar("instagram_username", { length: 300 }),
  openseaUrl:       varchar("opensea_url", { length: 2000 }),
  syncedAt:         timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
