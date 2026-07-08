import {
  pgTable, uuid, varchar, text, boolean, integer, numeric,
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

export const paymentStatuses = pgTable("payment_statuses", {
  id:   uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
});

export const productStatuses = pgTable("product_statuses", {
  id:   uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
});

export const deliveryStatuses = pgTable("delivery_statuses", {
  id:   uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
});

export const nftStages = pgTable("nft_stages", {
  id:          uuid("id").primaryKey().defaultRandom(),
  code:        varchar("code", { length: 50 }).notNull().unique(),
  name:        varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  sortOrder:   integer("sort_order").notNull().default(0),
});

export const nftTypes = pgTable("nft_types", {
  id:   uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
});

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
  nftPaymentStatusId:    uuid("nft_payment_status_id").references(() => paymentStatuses.id),
  nftConfirmedAt:        timestamp("nft_confirmed_at",   { withTimezone: true }),
  nftConfirmedBy:        uuid("nft_confirmed_by").references(() => users.id),
  // Merch payment
  merchPaymentMethodId:  uuid("merch_payment_method_id").references(() => paymentMethods.id),
  merchAmountTwd:        numeric("merch_amount_twd", { precision: 18, scale: 2 }),
  merchCurrencyId:       uuid("merch_currency_id").references(() => currencies.id),
  merchPaymentStatusId:  uuid("merch_payment_status_id").references(() => paymentStatuses.id),
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
  stageId:             uuid("stage_id").notNull().references(() => nftStages.id),
  nftTypeId:           uuid("nft_type_id").references(() => nftTypes.id),
  deliveryStatusId:    uuid("delivery_status_id").references(() => deliveryStatuses.id),
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
  statusId:     uuid("status_id").references(() => productStatuses.id),
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
  customer:          one(users,          { fields: [orders.customerId],          references: [users.id], relationName: "customer_orders" }),
  referrer:          one(users,          { fields: [orders.referrerId],          references: [users.id], relationName: "referrer_orders" }),
  nftPaymentStatus:  one(paymentStatuses,{ fields: [orders.nftPaymentStatusId],  references: [paymentStatuses.id] }),
  merchPaymentStatus:one(paymentStatuses,{ fields: [orders.merchPaymentStatusId],references: [paymentStatuses.id] }),
  nftItems:          many(orderNftItems),
  productItems:      many(orderProductItems),
  logs:              many(orderOperationLogs),
  reconciliations:   many(reconciliationEntries),
}));
