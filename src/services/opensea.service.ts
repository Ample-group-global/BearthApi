import pool from "../pool";
import {
  openSeaClient,
  normalizeTraits,
  OsCollection, OsCollectionStats, OsCollectionTrait,
  OsNft, OsListing, OsOffer, OsEvent, OsAccount, PagedResult,
} from "./opensea-client";

async function seqUpsert<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) await fn(item);
}

// ── Row → DTO mappers ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function rowToCollection(r: Row): OsCollection {
  return {
    slug: String(r["slug"]),
    name: String(r["name"]),
    description: r["description"] != null ? String(r["description"]) : null,
    imageUrl: r["image_url"] != null ? String(r["image_url"]) : null,
    bannerImageUrl: r["banner_image_url"] != null ? String(r["banner_image_url"]) : null,
    externalUrl: r["external_url"] != null ? String(r["external_url"]) : null,
    twitterUsername: r["twitter_username"] != null ? String(r["twitter_username"]) : null,
    discordUrl: r["discord_url"] != null ? String(r["discord_url"]) : null,
    telegramUrl: r["telegram_url"] != null ? String(r["telegram_url"]) : null,
    instagramUsername: r["instagram_username"] != null ? String(r["instagram_username"]) : null,
    category: r["category"] != null ? String(r["category"]) : null,
    isDisabled: Boolean(r["is_disabled"]),
    isNsfw: Boolean(r["is_nsfw"]),
    traitOffersEnabled: Boolean(r["trait_offers_enabled"]),
    collectionOffersEnabled: Boolean(r["collection_offers_enabled"]),
    openseaUrl: r["opensea_url"] != null ? String(r["opensea_url"]) : null,
    chain: String(r["chain"] ?? "ethereum"),
    createdDate: r["created_date"] != null ? String(r["created_date"]) : null,
    syncedAt: r["synced_at"] != null ? String(r["synced_at"]) : null,
    fees: r["fees"] != null ? (typeof r["fees"] === "string" ? JSON.parse(r["fees"]) : r["fees"]) : null,
    owner: r["owner"] != null ? String(r["owner"]) : null,
  };
}

function rowToStats(r: Row): OsCollectionStats {
  return {
    collectionSlug: String(r["collection_slug"]),
    floorPrice: String(r["floor_price"] ?? "0"),
    averagePrice: String(r["average_price"] ?? "0"),
    numOwners: Number(r["num_owners"] ?? 0),
    totalSupply: Number(r["total_supply"] ?? 0),
    marketCap: String(r["market_cap"] ?? "0"),
    totalVolume: String(r["total_volume"] ?? "0"),
    oneDayVolume: String(r["one_day_volume"] ?? "0"),
    sevenDayVolume: String(r["seven_day_volume"] ?? "0"),
    thirtyDayVolume: String(r["thirty_day_volume"] ?? "0"),
    oneDaySales: Number(r["one_day_sales"] ?? 0),
    sevenDaySales: Number(r["seven_day_sales"] ?? 0),
    thirtyDaySales: Number(r["thirty_day_sales"] ?? 0),
  };
}

function rowToTrait(r: Row): OsCollectionTrait {
  return {
    traitType: String(r["trait_type"]),
    traitValue: String(r["trait_value"] ?? ""),
    count: Number(r["count"] ?? 0),
  };
}

function rowToNft(r: Row): OsNft {
  return {
    identifier: String(r["identifier"]),
    collectionSlug: String(r["collection_slug"]),
    contractAddress: String(r["contract_address"]),
    chain: String(r["chain"]),
    tokenStandard: r["token_standard"] != null ? String(r["token_standard"]) : null,
    name: r["name"] != null ? String(r["name"]) : null,
    description: r["description"] != null ? String(r["description"]) : null,
    imageUrl: r["image_url"] != null ? String(r["image_url"]) : null,
    displayImageUrl: r["display_image_url"] != null ? String(r["display_image_url"]) : null,
    displayAnimationUrl: r["display_animation_url"] != null ? String(r["display_animation_url"]) : null,
    metadataUrl: r["metadata_url"] != null ? String(r["metadata_url"]) : null,
    openseaUrl: r["opensea_url"] != null ? String(r["opensea_url"]) : null,
    isDisabled: Boolean(r["is_disabled"]),
    isNsfw: Boolean(r["is_nsfw"]),
    isSuspicious: Boolean(r["is_suspicious"]),
    creatorAddress: r["creator_address"] != null ? String(r["creator_address"]) : null,
    traits: normalizeTraits(r["traits_json"]),
    owners: r["owners_json"],
    rarity: r["rarity_json"],
    updatedAt: r["updated_at"] != null ? String(r["updated_at"]) : null,
  };
}

function rowToListing(r: Row): OsListing {
  return {
    orderHash: String(r["order_hash"]),
    chain: String(r["chain"]),
    protocol: String(r["protocol"] ?? ""),
    contractAddress: String(r["contract_address"]),
    tokenId: String(r["token_id"]),
    orderType: String(r["order_type"]),
    maker: String(r["maker"]),
    taker: r["taker"] != null ? String(r["taker"]) : null,
    price: String(r["price"] ?? "0"),
    priceCurrency: r["price_currency"] != null ? String(r["price_currency"]) : null,
    priceDecimals: r["price_decimals"] != null ? String(r["price_decimals"]) : null,
    priceUsd: r["price_usd"] != null ? String(r["price_usd"]) : null,
    startDate: String(r["start_date"]),
    expirationDate: String(r["expiration_date"]),
    cancelled: Boolean(r["cancelled"]),
    finalized: Boolean(r["finalized"]),
    protocolData: r["protocol_data"],
  };
}

function rowToOffer(r: Row): OsOffer {
  return {
    orderHash: String(r["order_hash"]),
    chain: String(r["chain"]),
    protocol: String(r["protocol"] ?? ""),
    offerType: String(r["offer_type"]),
    maker: String(r["maker"]),
    taker: r["taker"] != null ? String(r["taker"]) : null,
    price: String(r["price"] ?? "0"),
    priceCurrency: r["price_currency"] != null ? String(r["price_currency"]) : null,
    priceDecimals: r["price_decimals"] != null ? String(r["price_decimals"]) : null,
    priceUsd: r["price_usd"] != null ? String(r["price_usd"]) : null,
    startDate: String(r["start_date"]),
    expirationDate: String(r["expiration_date"]),
    cancelled: Boolean(r["cancelled"]),
    finalized: Boolean(r["finalized"]),
    traitCriteria: r["trait_criteria"] != null ? String(r["trait_criteria"]) : null,
    protocolData: r["protocol_data"],
  };
}

function rowToEvent(r: Row): OsEvent {
  return {
    eventType: String(r["event_type"]),
    chain: String(r["chain"]),
    contractAddress: String(r["contract_address"]),
    tokenId: String(r["token_id"]),
    collectionSlug: r["collection_slug"] != null ? String(r["collection_slug"]) : null,
    orderHash: r["order_hash"] != null ? String(r["order_hash"]) : null,
    fromAddress: r["from_address"] != null ? String(r["from_address"]) : null,
    toAddress: r["to_address"] != null ? String(r["to_address"]) : null,
    maker: r["maker"] != null ? String(r["maker"]) : null,
    taker: r["taker"] != null ? String(r["taker"]) : null,
    price: r["price"] != null ? String(r["price"]) : null,
    priceCurrency: r["price_currency"] != null ? String(r["price_currency"]) : null,
    quantity: r["quantity"] != null ? String(r["quantity"]) : null,
    transactionHash: r["transaction_hash"] != null ? String(r["transaction_hash"]) : null,
    eventTimestamp: String(r["event_timestamp"]),
  };
}

function rowToAccount(r: Row): OsAccount {
  return {
    address: String(r["address"]),
    username: r["username"] != null ? String(r["username"]) : null,
    profileImageUrl: r["profile_image_url"] != null ? String(r["profile_image_url"]) : null,
    bannerImageUrl: r["banner_image_url"] != null ? String(r["banner_image_url"]) : null,
    bio: r["bio"] != null ? String(r["bio"]) : null,
    website: r["website"] != null ? String(r["website"]) : null,
    twitterUsername: r["twitter_username"] != null ? String(r["twitter_username"]) : null,
    openseaUrl: r["opensea_url"] != null ? String(r["opensea_url"]) : null,
  };
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertCollection(c: OsCollection): Promise<void> {
  const feesJson = c.fees != null ? JSON.stringify(c.fees) : null;
  await pool.query(
    `INSERT INTO os_collections
       (slug, name, description, image_url, banner_image_url, external_url,
        twitter_username, discord_url, telegram_url, instagram_username, category,
        is_disabled, is_nsfw, trait_offers_enabled, collection_offers_enabled,
        opensea_url, chain, created_date, fees, owner)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (slug) DO UPDATE SET
       name=EXCLUDED.name, description=EXCLUDED.description, image_url=EXCLUDED.image_url,
       banner_image_url=EXCLUDED.banner_image_url, external_url=EXCLUDED.external_url,
       twitter_username=EXCLUDED.twitter_username, discord_url=EXCLUDED.discord_url,
       telegram_url=EXCLUDED.telegram_url, instagram_username=EXCLUDED.instagram_username,
       category=EXCLUDED.category, is_disabled=EXCLUDED.is_disabled, is_nsfw=EXCLUDED.is_nsfw,
       trait_offers_enabled=EXCLUDED.trait_offers_enabled,
       collection_offers_enabled=EXCLUDED.collection_offers_enabled,
       opensea_url=EXCLUDED.opensea_url, chain=EXCLUDED.chain, created_date=EXCLUDED.created_date,
       fees=EXCLUDED.fees, owner=EXCLUDED.owner, synced_at=NOW(), updated_at=NOW()`,
    [c.slug, c.name, c.description, c.imageUrl, c.bannerImageUrl, c.externalUrl,
     c.twitterUsername, c.discordUrl, c.telegramUrl, c.instagramUsername, c.category,
     c.isDisabled, c.isNsfw, c.traitOffersEnabled, c.collectionOffersEnabled,
     c.openseaUrl, c.chain, c.createdDate, feesJson, c.owner ?? null]
  );
}

async function upsertStats(s: OsCollectionStats): Promise<void> {
  await pool.query(
    `INSERT INTO os_collection_stats
       (collection_slug, floor_price, average_price, num_owners, total_supply, market_cap,
        total_volume, one_day_volume, seven_day_volume, thirty_day_volume,
        one_day_sales, seven_day_sales, thirty_day_sales)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (collection_slug) DO UPDATE SET
       floor_price=EXCLUDED.floor_price, average_price=EXCLUDED.average_price,
       num_owners=EXCLUDED.num_owners, total_supply=EXCLUDED.total_supply,
       market_cap=EXCLUDED.market_cap, total_volume=EXCLUDED.total_volume,
       one_day_volume=EXCLUDED.one_day_volume, seven_day_volume=EXCLUDED.seven_day_volume,
       thirty_day_volume=EXCLUDED.thirty_day_volume, one_day_sales=EXCLUDED.one_day_sales,
       seven_day_sales=EXCLUDED.seven_day_sales, thirty_day_sales=EXCLUDED.thirty_day_sales,
       synced_at=NOW()`,
    [s.collectionSlug, s.floorPrice, s.averagePrice, s.numOwners, s.totalSupply, s.marketCap,
     s.totalVolume, s.oneDayVolume, s.sevenDayVolume, s.thirtyDayVolume,
     s.oneDaySales, s.sevenDaySales, s.thirtyDaySales]
  );
}

async function upsertTrait(t: OsCollectionTrait, collectionSlug: string): Promise<void> {
  await pool.query(
    `INSERT INTO os_collection_traits (collection_slug, trait_type, trait_value, count)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (collection_slug, trait_type, trait_value) DO UPDATE SET
       count=EXCLUDED.count, synced_at=NOW()`,
    [collectionSlug, t.traitType, t.traitValue, t.count]
  );
}

async function batchUpsertTraits(traits: OsCollectionTrait[], collectionSlug: string): Promise<void> {
  if (!traits.length) return;
  const BATCH = 200;
  for (let i = 0; i < traits.length; i += BATCH) {
    const chunk = traits.slice(i, i + BATCH);
    const placeholders = chunk.map((_, idx) => `($${idx * 4 + 1},$${idx * 4 + 2},$${idx * 4 + 3},$${idx * 4 + 4})`).join(",");
    const values = chunk.flatMap(t => [collectionSlug, t.traitType, t.traitValue, t.count]);
    await pool.query(
      `INSERT INTO os_collection_traits (collection_slug, trait_type, trait_value, count)
       VALUES ${placeholders}
       ON CONFLICT (collection_slug, trait_type, trait_value) DO UPDATE SET
         count=EXCLUDED.count, synced_at=NOW()`,
      values
    );
  }
}

async function upsertNft(n: OsNft): Promise<void> {
  const traitsJson = n.traits ? JSON.stringify(n.traits) : null;
  const ownersJson = n.owners ? JSON.stringify(n.owners) : null;
  const rarityJson = n.rarity ? JSON.stringify(n.rarity) : null;
  await pool.query(
    `INSERT INTO os_nfts
       (identifier, collection_slug, contract_address, chain, token_standard, name, description,
        image_url, display_image_url, display_animation_url, metadata_url, opensea_url,
        is_disabled, is_nsfw, is_suspicious, creator_address,
        traits_json, owners_json, rarity_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (chain, contract_address, identifier) DO UPDATE SET
       collection_slug=EXCLUDED.collection_slug, token_standard=EXCLUDED.token_standard,
       name=EXCLUDED.name, description=EXCLUDED.description,
       image_url=EXCLUDED.image_url, display_image_url=EXCLUDED.display_image_url,
       display_animation_url=EXCLUDED.display_animation_url, metadata_url=EXCLUDED.metadata_url,
       opensea_url=EXCLUDED.opensea_url, is_disabled=EXCLUDED.is_disabled,
       is_nsfw=EXCLUDED.is_nsfw, is_suspicious=EXCLUDED.is_suspicious,
       creator_address=EXCLUDED.creator_address, traits_json=EXCLUDED.traits_json,
       owners_json=EXCLUDED.owners_json, rarity_json=EXCLUDED.rarity_json,
       updated_at=EXCLUDED.updated_at, synced_at=NOW()`,
    [n.identifier, n.collectionSlug, n.contractAddress, n.chain, n.tokenStandard,
     n.name, n.description, n.imageUrl, n.displayImageUrl, n.displayAnimationUrl,
     n.metadataUrl, n.openseaUrl, n.isDisabled, n.isNsfw, n.isSuspicious,
     n.creatorAddress, traitsJson, ownersJson, rarityJson, n.updatedAt]
  );
}

async function upsertListing(l: OsListing, collectionSlug?: string | null): Promise<void> {
  if (!l.orderHash) return;
  const protocolDataJson = l.protocolData ? JSON.stringify(l.protocolData) : null;
  await pool.query(
    `INSERT INTO os_listings
       (order_hash, chain, protocol, collection_slug, contract_address, token_id, order_type,
        maker, taker, price, price_currency, price_decimals, price_usd,
        start_date, expiration_date, cancelled, finalized, protocol_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (order_hash) DO UPDATE SET
       chain=EXCLUDED.chain, protocol=EXCLUDED.protocol, collection_slug=EXCLUDED.collection_slug,
       contract_address=EXCLUDED.contract_address, token_id=EXCLUDED.token_id,
       order_type=EXCLUDED.order_type, maker=EXCLUDED.maker, taker=EXCLUDED.taker,
       price=EXCLUDED.price, price_currency=EXCLUDED.price_currency,
       price_decimals=EXCLUDED.price_decimals, price_usd=EXCLUDED.price_usd,
       start_date=EXCLUDED.start_date, expiration_date=EXCLUDED.expiration_date,
       cancelled=EXCLUDED.cancelled, finalized=EXCLUDED.finalized,
       protocol_data=EXCLUDED.protocol_data, synced_at=NOW()`,
    [l.orderHash, l.chain, l.protocol, collectionSlug ?? null, l.contractAddress, l.tokenId,
     l.orderType, l.maker, l.taker, l.price, l.priceCurrency, l.priceDecimals, l.priceUsd,
     l.startDate, l.expirationDate, l.cancelled, l.finalized, protocolDataJson]
  );
}

async function upsertOffer(of: OsOffer, collectionSlug?: string | null): Promise<void> {
  if (!of.orderHash) return;
  const protocolDataJson = of.protocolData ? JSON.stringify(of.protocolData) : null;
  await pool.query(
    `INSERT INTO os_offers
       (order_hash, chain, protocol, collection_slug, offer_type,
        maker, taker, price, price_currency, price_decimals, price_usd,
        start_date, expiration_date, cancelled, finalized, trait_criteria, protocol_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (order_hash) DO UPDATE SET
       chain=EXCLUDED.chain, protocol=EXCLUDED.protocol, collection_slug=EXCLUDED.collection_slug,
       offer_type=EXCLUDED.offer_type, maker=EXCLUDED.maker, taker=EXCLUDED.taker,
       price=EXCLUDED.price, price_currency=EXCLUDED.price_currency,
       price_decimals=EXCLUDED.price_decimals, price_usd=EXCLUDED.price_usd,
       start_date=EXCLUDED.start_date, expiration_date=EXCLUDED.expiration_date,
       cancelled=EXCLUDED.cancelled, finalized=EXCLUDED.finalized,
       trait_criteria=EXCLUDED.trait_criteria, protocol_data=EXCLUDED.protocol_data,
       synced_at=NOW()`,
    [of.orderHash, of.chain, of.protocol, collectionSlug ?? null, of.offerType,
     of.maker, of.taker, of.price, of.priceCurrency, of.priceDecimals, of.priceUsd,
     of.startDate, of.expirationDate, of.cancelled, of.finalized, of.traitCriteria, protocolDataJson]
  );
}

async function insertEvent(e: OsEvent): Promise<void> {
  await pool.query(
    `INSERT INTO os_events
       (event_type, chain, contract_address, token_id, collection_slug, order_hash,
        from_address, to_address, maker, taker, price, price_currency,
        quantity, transaction_hash, event_timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [e.eventType, e.chain, e.contractAddress, e.tokenId, e.collectionSlug, e.orderHash,
     e.fromAddress, e.toAddress, e.maker, e.taker, e.price, e.priceCurrency,
     e.quantity, e.transactionHash, e.eventTimestamp]
  );
}

async function upsertAccount(a: OsAccount): Promise<void> {
  if (!a.address) return;
  await pool.query(
    `INSERT INTO os_accounts
       (address, username, profile_image_url, banner_image_url, bio, website, twitter_username, opensea_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (address) DO UPDATE SET
       username=EXCLUDED.username, profile_image_url=EXCLUDED.profile_image_url,
       banner_image_url=EXCLUDED.banner_image_url, bio=EXCLUDED.bio,
       website=EXCLUDED.website, twitter_username=EXCLUDED.twitter_username,
       opensea_url=EXCLUDED.opensea_url, synced_at=NOW(), updated_at=NOW()`,
    [a.address, a.username, a.profileImageUrl, a.bannerImageUrl,
     a.bio, a.website, a.twitterUsername, a.openseaUrl]
  );
}

// ── Collections ───────────────────────────────────────────────────────────────

export async function getCollection(slug: string): Promise<OsCollection | null> {
  const { rows } = await pool.query("SELECT * FROM os_collections WHERE slug=$1", [slug]);
  if (rows.length) return rowToCollection(rows[0] as Row);
  const data = await openSeaClient.getCollection(slug);
  if (!data) return null;
  await upsertCollection(data);
  return data;
}

export async function listCollections(limit: number, chain?: string | null, creatorUsername?: string | null): Promise<PagedResult<OsCollection>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (chain) { conditions.push(`chain=$${params.length + 1}`); params.push(chain); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const { rows } = await pool.query(`SELECT * FROM os_collections ${where} ORDER BY updated_at DESC LIMIT $${params.length}`, params);
  if (rows.length) return { data: rows.map(r => rowToCollection(r as Row)) };
  const result = await openSeaClient.listCollections(limit, chain, creatorUsername);
  await seqUpsert(result.data, upsertCollection);
  return result;
}

export async function getTrendingCollections(limit: number): Promise<PagedResult<OsCollection>> {
  return openSeaClient.getTrendingCollections(limit);
}

export async function getTopCollections(limit: number): Promise<PagedResult<OsCollection>> {
  return openSeaClient.getTopCollections(limit);
}

export async function getCollectionStats(slug: string): Promise<OsCollectionStats | null> {
  const { rows } = await pool.query("SELECT * FROM os_collection_stats WHERE collection_slug=$1", [slug]);
  if (rows.length) return rowToStats(rows[0] as Row);
  const data = await openSeaClient.getCollectionStats(slug);
  if (!data) return null;
  await upsertStats(data);
  return data;
}

export async function getCollectionTraits(slug: string): Promise<OsCollectionTrait[]> {
  // 1. Check cached collection-level traits
  const { rows } = await pool.query("SELECT * FROM os_collection_traits WHERE collection_slug=$1 ORDER BY trait_type, trait_value", [slug]);
  if (rows.length) return rows.map(r => rowToTrait(r as Row));

  // 2. Try OpenSea API (correct endpoint: /api/v2/traits/{slug})
  const data = await openSeaClient.getCollectionTraits(slug);
  if (data.length) {
    await batchUpsertTraits(data, slug);
    return data;
  }

  // 3. Fallback: aggregate from os_nfts.traits_json when OpenSea has no data for this collection
  const { rows: nftRows } = await pool.query("SELECT traits_json FROM os_nfts WHERE collection_slug=$1 AND traits_json IS NOT NULL", [slug]);
  if (!nftRows.length) return [];

  const countMap: Record<string, Record<string, number>> = {};
  for (const row of nftRows) {
    const traits = normalizeTraits((row as Row)["traits_json"]);
    if (!traits) continue;
    for (const t of traits) {
      if (!t.traitType) continue;
      countMap[t.traitType] = countMap[t.traitType] ?? {};
      countMap[t.traitType]![t.traitValue] = (countMap[t.traitType]![t.traitValue] ?? 0) + 1;
    }
  }

  const aggregated: OsCollectionTrait[] = [];
  for (const [traitType, values] of Object.entries(countMap)) {
    for (const [traitValue, count] of Object.entries(values)) {
      aggregated.push({ traitType, traitValue, count });
    }
  }
  aggregated.sort((a, b) => a.traitType.localeCompare(b.traitType) || a.traitValue.localeCompare(b.traitValue));

  if (aggregated.length) {
    await batchUpsertTraits(aggregated, slug);
  }
  return aggregated;
}

export async function syncCollection(slug: string): Promise<OsCollection | null> {
  const data = await openSeaClient.getCollection(slug);
  if (data) await upsertCollection(data);
  return data;
}

// ── NFTs ──────────────────────────────────────────────────────────────────────

export async function getNft(chain: string, contractAddress: string, identifier: string): Promise<OsNft | null> {
  const { rows } = await pool.query("SELECT * FROM os_nfts WHERE chain=$1 AND contract_address=$2 AND identifier=$3", [chain, contractAddress, identifier]);
  if (rows.length) return rowToNft(rows[0] as Row);
  const data = await openSeaClient.getNft(chain, contractAddress, identifier);
  if (!data) return null;
  await upsertNft(data);
  return data;
}

const NFT_ORDER = `ORDER BY CASE WHEN identifier ~ '^[0-9]+$' THEN identifier::BIGINT ELSE 9999999999 END, identifier`;

export async function listNftsByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsNft>> {
  // DB cursor format: "db:{offset}" — used to page through locally cached NFTs
  const isDbCursor = next?.startsWith("db:");
  const dbOffset = isDbCursor ? parseInt(next!.slice(3), 10) : 0;

  if (!next || isDbCursor) {
    const { rows } = await pool.query(`SELECT * FROM os_nfts WHERE collection_slug=$1 ${NFT_ORDER} LIMIT $2 OFFSET $3`, [slug, limit, dbOffset]);
    if (rows.length > 0) {
      // Return next DB cursor only if this page was full (more rows may exist)
      const nextCursor = rows.length === limit ? `db:${dbOffset + limit}` : undefined;
      return { data: rows.map(r => rowToNft(r as Row)), next: nextCursor };
    }
    // DB exhausted at this offset — nothing more to return from cache
    if (isDbCursor) return { data: [] };
  }

  // DB was empty on first request → fall through to OpenSea
  const collRow = await pool.query("SELECT chain FROM os_collections WHERE slug=$1", [slug]);
  const collChain: string = String(collRow.rows[0]?.["chain"] ?? "");
  const result = await openSeaClient.listNftsByCollection(slug, limit, next ?? undefined);
  if (collChain) result.data.forEach(n => { if (!n.chain) n.chain = collChain; });
  await seqUpsert(result.data, upsertNft);
  return result;
}

export async function syncAllNftsByCollection(slug: string): Promise<{ synced: number }> {
  const collRow = await pool.query("SELECT chain FROM os_collections WHERE slug=$1", [slug]);
  const collChain: string = String(collRow.rows[0]?.["chain"] ?? "");

  let total = 0;
  let cursor: string | null | undefined = undefined;
  const PAGE = 200; // max OpenSea allows

  do {
    const result = await openSeaClient.listNftsByCollection(slug, PAGE, cursor);
    if (result.data.length === 0) break;
    if (collChain) result.data.forEach(n => { if (!n.chain) n.chain = collChain; });
    await seqUpsert(result.data, upsertNft);
    total += result.data.length;
    cursor = result.next;
    // Respect OpenSea free-tier rate limit (60 req/min)
    if (cursor) await new Promise(r => setTimeout(r, 1100));
  } while (cursor);

  return { synced: total };
}

export async function listNftsByContract(chain: string, contractAddress: string, limit: number, next?: string | null): Promise<PagedResult<OsNft>> {
  // When a cursor is provided, go straight to OpenSea for the next page
  if (!next) {
    // Include NFTs stored without chain (synced via collection endpoint before chain was captured)
    const { rows } = await pool.query(`SELECT * FROM os_nfts WHERE (chain=$1 OR chain='') AND contract_address=$2 ${NFT_ORDER} LIMIT $3`, [chain, contractAddress, limit]);
    if (rows.length) return { data: rows.map(r => rowToNft(r as Row)) };
  }
  const result = await openSeaClient.listNftsByContract(chain, contractAddress, limit, next);
  // Fill chain on results so they're stored correctly
  result.data.forEach(n => { if (!n.chain) n.chain = chain; });
  await seqUpsert(result.data, upsertNft);
  return result;
}

export async function getNftsByAccount(address: string, chain?: string | null, limit?: number): Promise<PagedResult<OsNft>> {
  return openSeaClient.getNftsByAccount(address, chain, limit ?? 50);
}

export async function getNftOwners(chain: string, contractAddress: string, identifier: string, limit: number): Promise<PagedResult<unknown>> {
  return openSeaClient.getNftOwners(chain, contractAddress, identifier, limit);
}

export async function syncNft(chain: string, contractAddress: string, identifier: string): Promise<OsNft | null> {
  const data = await openSeaClient.getNft(chain, contractAddress, identifier);
  if (data) await upsertNft(data);
  return data;
}

// ── Listings ──────────────────────────────────────────────────────────────────

export async function getListingsByCollection(slug: string, limit: number, offset: number): Promise<PagedResult<OsListing>> {
  const { rows } = await pool.query("SELECT * FROM os_listings WHERE collection_slug=$1 ORDER BY synced_at DESC LIMIT $2 OFFSET $3", [slug, limit, offset]);
  if (rows.length) return { data: rows.map(r => rowToListing(r as Row)) };
  const result = await openSeaClient.getListingsByCollection(slug, limit);
  await seqUpsert(result.data, l => upsertListing(l, slug));
  return result;
}

export async function getListingsByNft(chain: string, contractAddress: string, tokenId: string, limit: number, offset: number): Promise<PagedResult<OsListing>> {
  const { rows } = await pool.query("SELECT * FROM os_listings WHERE chain=$1 AND contract_address=$2 AND token_id=$3 ORDER BY synced_at DESC LIMIT $4 OFFSET $5", [chain, contractAddress, tokenId, limit, offset]);
  if (rows.length) return { data: rows.map(r => rowToListing(r as Row)) };
  const result = await openSeaClient.getListingsByNft(chain, contractAddress, tokenId, limit);
  await seqUpsert(result.data, l => upsertListing(l));
  return result;
}

export async function getBestListingByNft(chain: string, contractAddress: string, tokenId: string): Promise<OsListing | null> {
  return openSeaClient.getBestListingByNft(chain, contractAddress, tokenId);
}

export async function getBestListingsByCollection(slug: string, limit: number): Promise<PagedResult<OsListing>> {
  return openSeaClient.getBestListingsByCollection(slug, limit);
}

export async function syncListingsByCollection(slug: string, limit: number): Promise<PagedResult<OsListing>> {
  const result = await openSeaClient.getListingsByCollection(slug, limit);
  await seqUpsert(result.data, l => upsertListing(l, slug));
  return result;
}

// ── Offers ────────────────────────────────────────────────────────────────────

export async function getOffersByCollection(slug: string, limit: number, offset: number): Promise<PagedResult<OsOffer>> {
  const { rows } = await pool.query("SELECT * FROM os_offers WHERE collection_slug=$1 ORDER BY synced_at DESC LIMIT $2 OFFSET $3", [slug, limit, offset]);
  if (rows.length) return { data: rows.map(r => rowToOffer(r as Row)) };
  const result = await openSeaClient.getOffersByCollection(slug, limit);
  await seqUpsert(result.data, of => upsertOffer(of, slug));
  return result;
}

export async function getBestOffersByCollection(slug: string, limit: number, offset: number): Promise<PagedResult<OsOffer>> {
  return openSeaClient.getBestOffersByCollection(slug, limit);
}

export async function getOffersByNft(chain: string, contractAddress: string, tokenId: string, limit: number, offset: number): Promise<PagedResult<OsOffer>> {
  const { rows } = await pool.query("SELECT * FROM os_offers WHERE chain=$1 AND contract_address=$2 AND token_id=$3 ORDER BY synced_at DESC LIMIT $4 OFFSET $5", [chain, contractAddress, tokenId, limit, offset]);
  if (rows.length) return { data: rows.map(r => rowToOffer(r as Row)) };
  const result = await openSeaClient.getOffersByNft(chain, contractAddress, tokenId, limit);
  await seqUpsert(result.data, of => upsertOffer(of));
  return result;
}

export async function getBestOfferByNft(chain: string, contractAddress: string, tokenId: string): Promise<OsOffer | null> {
  return openSeaClient.getBestOfferByNft(chain, contractAddress, tokenId);
}

export async function getTraitOffersByCollection(slug: string, limit: number): Promise<PagedResult<OsOffer>> {
  return openSeaClient.getTraitOffersByCollection(slug, limit);
}

export async function syncOffersByCollection(slug: string, limit: number): Promise<PagedResult<OsOffer>> {
  const result = await openSeaClient.getOffersByCollection(slug, limit);
  await seqUpsert(result.data, of => upsertOffer(of, slug));
  return result;
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function getEventsByCollection(slug: string, eventType?: string | null, limit?: number, offset?: number): Promise<PagedResult<OsEvent>> {
  const lim = limit ?? 50;
  const off = offset ?? 0;
  const conditions: string[] = ["collection_slug=$1"];
  const params: unknown[] = [slug];
  if (eventType) { conditions.push(`event_type=$${params.length + 1}`); params.push(eventType); }
  params.push(lim, off);
  const { rows } = await pool.query(`SELECT * FROM os_events WHERE ${conditions.join(" AND ")} ORDER BY event_timestamp DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  if (rows.length) return { data: rows.map(r => rowToEvent(r as Row)) };
  const result = await openSeaClient.getEventsByCollection(slug, eventType, lim);
  await seqUpsert(result.data, insertEvent);
  return result;
}

export async function getEventsByNft(chain: string, contractAddress: string, tokenId: string, eventType?: string | null, limit?: number, offset?: number): Promise<PagedResult<OsEvent>> {
  const lim = limit ?? 50;
  const off = offset ?? 0;
  const conditions: string[] = ["chain=$1", "contract_address=$2", "token_id=$3"];
  const params: unknown[] = [chain, contractAddress, tokenId];
  if (eventType) { conditions.push(`event_type=$${params.length + 1}`); params.push(eventType); }
  params.push(lim, off);
  const { rows } = await pool.query(`SELECT * FROM os_events WHERE ${conditions.join(" AND ")} ORDER BY event_timestamp DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  if (rows.length) return { data: rows.map(r => rowToEvent(r as Row)) };
  const result = await openSeaClient.getEventsByNft(chain, contractAddress, tokenId, eventType, lim);
  await seqUpsert(result.data, insertEvent);
  return result;
}

export async function getEvents(address?: string | null, eventType?: string | null, limit?: number): Promise<PagedResult<OsEvent>> {
  return openSeaClient.getEvents(address, eventType, limit ?? 50);
}

export async function syncEventsByCollection(slug: string, eventType?: string | null, limit?: number): Promise<PagedResult<OsEvent>> {
  const result = await openSeaClient.getEventsByCollection(slug, eventType, limit ?? 50);
  await seqUpsert(result.data, insertEvent);
  return result;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function getAccount(addressOrUsername: string): Promise<OsAccount | null> {
  const { rows } = await pool.query("SELECT * FROM os_accounts WHERE address=$1 OR username=$1 LIMIT 1", [addressOrUsername]);
  if (rows.length) return rowToAccount(rows[0] as Row);
  const data = await openSeaClient.getAccount(addressOrUsername);
  if (!data) return null;
  await upsertAccount(data);
  return data;
}

export async function resolveAccount(identifier: string): Promise<OsAccount | null> {
  return openSeaClient.resolveAccount(identifier);
}

export async function getListingsByAccount(address: string, limit: number): Promise<PagedResult<OsListing>> {
  return openSeaClient.getListingsByAccount(address, limit);
}

export async function getOffersReceivedByAccount(address: string, limit: number): Promise<PagedResult<OsOffer>> {
  return openSeaClient.getOffersReceivedByAccount(address, limit);
}

export async function getOffersMadeByAccount(address: string, limit: number): Promise<PagedResult<OsOffer>> {
  return openSeaClient.getOffersMadeByAccount(address, limit);
}

export async function getCollectionsByAccount(address: string, limit: number): Promise<PagedResult<OsCollection>> {
  return openSeaClient.getCollectionsByAccount(address, limit);
}

export async function syncAccount(addressOrUsername: string): Promise<OsAccount | null> {
  const data = await openSeaClient.getAccount(addressOrUsername);
  if (data) await upsertAccount(data);
  return data;
}

export async function listAccounts(limit: number, offset: number, search?: string): Promise<PagedResult<OsAccount>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(`(address ILIKE $${params.length + 1} OR username ILIKE $${params.length + 1})`);
    params.push(pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);
  const { rows } = await pool.query(`SELECT * FROM os_accounts ${where} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { data: rows.map(r => rowToAccount(r as Row)) };
}
