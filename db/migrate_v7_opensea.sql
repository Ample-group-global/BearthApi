-- migrate_v7_opensea.sql  |  OpenSea cache tables
-- Run against: BearthDev (Railway PostgreSQL)

-- ── os_collections ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_collections (
    id                        SERIAL PRIMARY KEY,
    slug                      VARCHAR(300)   NOT NULL UNIQUE,
    name                      VARCHAR(500)   NOT NULL,
    description               TEXT,
    image_url                 VARCHAR(2000),
    banner_image_url          VARCHAR(2000),
    external_url              VARCHAR(2000),
    twitter_username          VARCHAR(300),
    discord_url               VARCHAR(2000),
    telegram_url              VARCHAR(2000),
    instagram_username        VARCHAR(300),
    wiki_url                  VARCHAR(2000),
    category                  VARCHAR(200),
    is_disabled               BOOLEAN        NOT NULL DEFAULT FALSE,
    is_nsfw                   BOOLEAN        NOT NULL DEFAULT FALSE,
    trait_offers_enabled      BOOLEAN        NOT NULL DEFAULT FALSE,
    collection_offers_enabled BOOLEAN        NOT NULL DEFAULT FALSE,
    opensea_url               VARCHAR(2000),
    project_url               VARCHAR(2000),
    wikipedia_url             VARCHAR(2000),
    chain                     VARCHAR(100)   NOT NULL DEFAULT 'ethereum',
    created_date              TIMESTAMPTZ,
    synced_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── os_collection_stats ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_collection_stats (
    id                        SERIAL PRIMARY KEY,
    collection_slug           VARCHAR(300)   NOT NULL UNIQUE,
    floor_price               NUMERIC(28,10) NOT NULL DEFAULT 0,
    floor_price_currency      VARCHAR(50),
    average_price             NUMERIC(28,10) NOT NULL DEFAULT 0,
    num_owners                BIGINT         NOT NULL DEFAULT 0,
    total_supply              BIGINT         NOT NULL DEFAULT 0,
    num_reported              BIGINT         NOT NULL DEFAULT 0,
    market_cap                NUMERIC(28,10) NOT NULL DEFAULT 0,
    total_volume              NUMERIC(28,10) NOT NULL DEFAULT 0,
    one_day_volume            NUMERIC(28,10) NOT NULL DEFAULT 0,
    seven_day_volume          NUMERIC(28,10) NOT NULL DEFAULT 0,
    thirty_day_volume         NUMERIC(28,10) NOT NULL DEFAULT 0,
    one_day_sales             BIGINT         NOT NULL DEFAULT 0,
    seven_day_sales           BIGINT         NOT NULL DEFAULT 0,
    thirty_day_sales          BIGINT         NOT NULL DEFAULT 0,
    one_day_average_price     NUMERIC(28,10) NOT NULL DEFAULT 0,
    seven_day_average_price   NUMERIC(28,10) NOT NULL DEFAULT 0,
    thirty_day_average_price  NUMERIC(28,10) NOT NULL DEFAULT 0,
    one_day_change            NUMERIC(18,4)  NOT NULL DEFAULT 0,
    seven_day_change          NUMERIC(18,4)  NOT NULL DEFAULT 0,
    thirty_day_change         NUMERIC(18,4)  NOT NULL DEFAULT 0,
    synced_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── os_collection_traits ──────────────────────────────────────────────────────
-- trait_value NOT NULL (OpenSea API always returns string keys from counts object)
CREATE TABLE IF NOT EXISTS os_collection_traits (
    id              SERIAL PRIMARY KEY,
    collection_slug VARCHAR(200)  NOT NULL,
    trait_type      VARCHAR(200)  NOT NULL,
    trait_value     VARCHAR(400)  NOT NULL DEFAULT '',
    count           BIGINT        NOT NULL DEFAULT 0,
    synced_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_os_traits UNIQUE (collection_slug, trait_type, trait_value)
);

-- ── os_nfts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_nfts (
    id                    SERIAL PRIMARY KEY,
    identifier            VARCHAR(200)  NOT NULL,
    collection_slug       VARCHAR(300)  NOT NULL,
    contract_address      VARCHAR(200)  NOT NULL,
    chain                 VARCHAR(100)  NOT NULL,
    token_standard        VARCHAR(50),
    name                  VARCHAR(500),
    description           TEXT,
    image_url             VARCHAR(2000),
    display_image_url     VARCHAR(2000),
    display_animation_url VARCHAR(2000),
    metadata_url          VARCHAR(2000),
    opensea_url           VARCHAR(2000),
    is_disabled           BOOLEAN       NOT NULL DEFAULT FALSE,
    is_nsfw               BOOLEAN       NOT NULL DEFAULT FALSE,
    is_suspicious         BOOLEAN       NOT NULL DEFAULT FALSE,
    creator_address       VARCHAR(200),
    traits_json           JSONB,
    owners_json           JSONB,
    rarity_json           JSONB,
    updated_at            TIMESTAMPTZ,
    synced_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_os_nfts UNIQUE (chain, contract_address, identifier)
);
CREATE INDEX IF NOT EXISTS ix_os_nfts_collection ON os_nfts (collection_slug);

-- ── os_listings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_listings (
    id               SERIAL PRIMARY KEY,
    order_hash       VARCHAR(200)   NOT NULL UNIQUE,
    chain            VARCHAR(100)   NOT NULL,
    protocol         VARCHAR(200),
    collection_slug  VARCHAR(300),
    contract_address VARCHAR(200)   NOT NULL,
    token_id         VARCHAR(200)   NOT NULL,
    order_type       VARCHAR(100)   NOT NULL,
    maker            VARCHAR(200)   NOT NULL,
    taker            VARCHAR(200),
    price            NUMERIC(38,18) NOT NULL DEFAULT 0,
    price_currency   VARCHAR(50),
    price_decimals   NUMERIC(10,0),
    price_usd        NUMERIC(28,10),
    start_date       TIMESTAMPTZ    NOT NULL,
    expiration_date  TIMESTAMPTZ    NOT NULL,
    cancelled        BOOLEAN        NOT NULL DEFAULT FALSE,
    finalized        BOOLEAN        NOT NULL DEFAULT FALSE,
    marked_invalid   BOOLEAN        NOT NULL DEFAULT FALSE,
    protocol_data    JSONB,
    synced_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_os_listings_collection ON os_listings (collection_slug);
CREATE INDEX IF NOT EXISTS ix_os_listings_nft ON os_listings (chain, contract_address, token_id);

-- ── os_offers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_offers (
    id               SERIAL PRIMARY KEY,
    order_hash       VARCHAR(200)   NOT NULL UNIQUE,
    chain            VARCHAR(100)   NOT NULL,
    protocol         VARCHAR(200),
    collection_slug  VARCHAR(300),
    contract_address VARCHAR(200),
    token_id         VARCHAR(200),
    offer_type       VARCHAR(100)   NOT NULL,
    maker            VARCHAR(200)   NOT NULL,
    taker            VARCHAR(200),
    price            NUMERIC(38,18) NOT NULL DEFAULT 0,
    price_currency   VARCHAR(50),
    price_decimals   NUMERIC(10,0),
    price_usd        NUMERIC(28,10),
    start_date       TIMESTAMPTZ    NOT NULL,
    expiration_date  TIMESTAMPTZ    NOT NULL,
    cancelled        BOOLEAN        NOT NULL DEFAULT FALSE,
    finalized        BOOLEAN        NOT NULL DEFAULT FALSE,
    marked_invalid   BOOLEAN        NOT NULL DEFAULT FALSE,
    trait_criteria   TEXT,
    protocol_data    JSONB,
    synced_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_os_offers_collection ON os_offers (collection_slug);
CREATE INDEX IF NOT EXISTS ix_os_offers_nft ON os_offers (chain, contract_address, token_id);

-- ── os_events ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_events (
    id               SERIAL PRIMARY KEY,
    event_type       VARCHAR(100)   NOT NULL,
    chain            VARCHAR(100)   NOT NULL,
    contract_address VARCHAR(200)   NOT NULL,
    token_id         VARCHAR(200)   NOT NULL,
    collection_slug  VARCHAR(300),
    order_hash       VARCHAR(200),
    from_address     VARCHAR(200),
    to_address       VARCHAR(200),
    maker            VARCHAR(200),
    taker            VARCHAR(200),
    price            NUMERIC(38,18),
    price_currency   VARCHAR(50),
    price_usd        NUMERIC(28,10),
    quantity         NUMERIC(28,10),
    transaction_hash VARCHAR(200),
    block_number     BIGINT,
    event_timestamp  TIMESTAMPTZ    NOT NULL,
    payment_token    VARCHAR(200),
    synced_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_os_events_collection ON os_events (collection_slug);
CREATE INDEX IF NOT EXISTS ix_os_events_nft ON os_events (chain, contract_address, token_id);
CREATE INDEX IF NOT EXISTS ix_os_events_from ON os_events (from_address);
CREATE INDEX IF NOT EXISTS ix_os_events_to ON os_events (to_address);

-- ── os_accounts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_accounts (
    id                 SERIAL PRIMARY KEY,
    address            VARCHAR(200)  NOT NULL UNIQUE,
    username           VARCHAR(300),
    profile_image_url  VARCHAR(2000),
    banner_image_url   VARCHAR(2000),
    bio                TEXT,
    website            VARCHAR(2000),
    twitter_username   VARCHAR(300),
    instagram_username VARCHAR(300),
    opensea_url        VARCHAR(2000),
    synced_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_os_accounts_username ON os_accounts (username);
