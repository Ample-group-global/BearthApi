const BASE_URL = "https://api.opensea.io/api/v2";

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  const key = process.env.OPENSEA_API_KEY;
  if (key) h["x-api-key"] = key;
  return h;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}/${path}`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}/${path}`, {
      method: "POST",
      headers: { ...buildHeaders(), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface PagedResult<T> {
  data: T[];
  next?: string | null;
}

export interface OsCollectionFee {
  fee: number;
  recipient: string;
  required: boolean;
}

export interface OsCollection {
  slug: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  bannerImageUrl?: string | null;
  externalUrl?: string | null;
  twitterUsername?: string | null;
  discordUrl?: string | null;
  telegramUrl?: string | null;
  instagramUsername?: string | null;
  category?: string | null;
  isDisabled: boolean;
  isNsfw: boolean;
  traitOffersEnabled: boolean;
  collectionOffersEnabled: boolean;
  openseaUrl?: string | null;
  chain: string;
  createdDate?: string | null;
  syncedAt?: string | null;
  fees?: OsCollectionFee[] | null;
  owner?: string | null;
}

export interface OsCollectionStats {
  collectionSlug: string;
  floorPrice: string;
  averagePrice: string;
  numOwners: number;
  totalSupply: number;
  marketCap: string;
  totalVolume: string;
  oneDayVolume: string;
  sevenDayVolume: string;
  thirtyDayVolume: string;
  oneDaySales: number;
  sevenDaySales: number;
  thirtyDaySales: number;
}

export interface OsCollectionTrait {
  traitType: string;
  traitValue: string;
  count: number;
}

export interface OsNft {
  identifier: string;
  collectionSlug: string;
  contractAddress: string;
  chain: string;
  tokenStandard?: string | null;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  displayImageUrl?: string | null;
  displayAnimationUrl?: string | null;
  metadataUrl?: string | null;
  openseaUrl?: string | null;
  isDisabled: boolean;
  isNsfw: boolean;
  isSuspicious: boolean;
  creatorAddress?: string | null;
  traits?: unknown;
  owners?: unknown;
  rarity?: unknown;
  updatedAt?: string | null;
}

export interface OsListing {
  orderHash: string;
  chain: string;
  protocol: string;
  contractAddress: string;
  tokenId: string;
  orderType: string;
  maker: string;
  taker?: string | null;
  price: string;
  priceCurrency?: string | null;
  priceDecimals?: string | null;
  priceUsd?: string | null;
  startDate: string;
  expirationDate: string;
  cancelled: boolean;
  finalized: boolean;
  protocolData?: unknown;
}

export interface OsOffer {
  orderHash: string;
  chain: string;
  protocol: string;
  offerType: string;
  maker: string;
  taker?: string | null;
  price: string;
  priceCurrency?: string | null;
  priceDecimals?: string | null;
  priceUsd?: string | null;
  startDate: string;
  expirationDate: string;
  cancelled: boolean;
  finalized: boolean;
  traitCriteria?: string | null;
  protocolData?: unknown;
}

export interface OsEvent {
  eventType: string;
  chain: string;
  contractAddress: string;
  tokenId: string;
  collectionSlug?: string | null;
  orderHash?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  maker?: string | null;
  taker?: string | null;
  price?: string | null;
  priceCurrency?: string | null;
  quantity?: string | null;
  transactionHash?: string | null;
  eventTimestamp: string;
}

export interface OsAccount {
  address: string;
  username?: string | null;
  profileImageUrl?: string | null;
  bannerImageUrl?: string | null;
  bio?: string | null;
  website?: string | null;
  twitterUsername?: string | null;
  openseaUrl?: string | null;
}

export interface OsCollectionHolder {
  address: string;
  quantity: number;
}

export interface OsFloorPrice {
  floor_price: number;
  timestamp: string;
}

export interface OsOfferAggregate {
  price: string;
  currency: string;
  quantity: number;
}

export interface OsNftAnalytics {
  sales: number;
  volume: string;
  floorPrice: string;
  averagePrice: string;
  numOwners: number;
}

export interface OsDropStage {
  uuid: string;
  stageType: string;
  label: string | null;
  price: string | null;
  priceCurrencyAddress: string | null;
  startTime: string | null;
  endTime: string | null;
  maxPerWallet: number | null;
}

export interface OsDrop {
  collectionSlug: string;
  collectionName: string;
  chain: string;
  contractAddress: string;
  dropType: string;
  isMinting: boolean;
  imageUrl: string | null;
  openseaUrl: string | null;
  activeStage: OsDropStage | null;
  nextStage: OsDropStage | null;
  stages?: OsDropStage[];
  totalSupply?: number | null;
  maxSupply?: number | null;
}

export interface OsPortfolioStats {
  totalValueUsd: number | null;
  nftValueUsd: number | null;
  tokenValueUsd: number | null;
  pnlAbsolute: number | null;
  pnlPercentage: number | null;
  timeframe: string;
}

export interface OsWalletPnl {
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  totalPnlUsd: number | null;
  netInvestedUsd: number | null;
  currentValueUsd: number | null;
  returnPercentage: string | null;
}

export interface OsProfileShelf {
  id: string;
  title: string;
  description: string | null;
  displayOrder: number;
  items: { chain: string; contractAddress: string; tokenId: string }[];
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function bool(v: unknown): boolean {
  return v === true || v === 1;
}

function num(v: unknown): number {
  const x = Number(v);
  return isNaN(x) ? 0 : x;
}

function arrFirst(v: unknown, key: string): unknown {
  if (!Array.isArray(v) || !v.length) return null;
  return asObj(v[0])?.[key] ?? null;
}

function unixToIso(v: unknown): string {
  const secs = Number(v);
  if (isNaN(secs) || secs === 0) return new Date().toISOString();
  return new Date(secs * 1000).toISOString();
}

export function normalizeTraits(
  raw: unknown
): { traitType: string; traitValue: string; displayType: string | null }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map(t => {
      const o = asObj(t);
      if (!o) return null;
      return {
        // OpenSea API uses trait_type/value; normalized format uses traitType/traitValue
        traitType: str(o["trait_type"] ?? o["traitType"]) || "",
        traitValue: str(o["value"] ?? o["display_value"] ?? o["traitValue"]) || "",
        displayType: str(o["display_type"] ?? o["displayType"]),
      };
    })
    .filter((x): x is { traitType: string; traitValue: string; displayType: string | null } => x !== null);
}

function mapDropStage(n: unknown): OsDropStage | null {
  const obj = asObj(n);
  if (!obj) return null;
  return {
    uuid: str(obj["uuid"]) || "",
    stageType: str(obj["stage_type"]) || "",
    label: str(obj["label"]),
    price: str(obj["price"]),
    priceCurrencyAddress: str(obj["price_currency_address"]),
    startTime: str(obj["start_time"]),
    endTime: str(obj["end_time"]),
    maxPerWallet: obj["max_per_wallet"] != null ? Number(obj["max_per_wallet"]) : null,
  };
}

function mapDrop(n: unknown): OsDrop | null {
  const obj = asObj(n);
  if (!obj) return null;
  return {
    collectionSlug: str(obj["collection_slug"]) || "",
    collectionName: str(obj["collection_name"]) || "",
    chain: str(obj["chain"]) || "",
    contractAddress: str(obj["contract_address"]) || "",
    dropType: str(obj["drop_type"]) || "",
    isMinting: bool(obj["is_minting"]),
    imageUrl: str(obj["image_url"]),
    openseaUrl: str(obj["opensea_url"]),
    activeStage: mapDropStage(obj["active_stage"]),
    nextStage: mapDropStage(obj["next_stage"]),
    stages: Array.isArray(obj["stages"])
      ? (obj["stages"] as unknown[]).map(mapDropStage).filter((s): s is OsDropStage => s !== null)
      : undefined,
    totalSupply: obj["total_supply"] != null ? Number(obj["total_supply"]) : null,
    maxSupply: obj["max_supply"] != null ? Number(obj["max_supply"]) : null,
  };
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapCollection(n: unknown): OsCollection | null {
  const obj = asObj(n);
  if (!obj) return null;
  const rawFees = Array.isArray(obj["fees"]) ? obj["fees"] : [];
  const fees: OsCollectionFee[] = rawFees
    .map((f: unknown) => {
      const fo = asObj(f);
      if (!fo) return null;
      return { fee: Number(fo["fee"] ?? 0), recipient: str(fo["recipient"]) ?? "", required: bool(fo["required"]) };
    })
    .filter((f): f is OsCollectionFee => f !== null);
  return {
    slug: str(obj["collection"]) || str(obj["slug"]) || "",
    name: str(obj["name"]) || "",
    description: str(obj["description"]),
    imageUrl: str(obj["image_url"]),
    bannerImageUrl: str(obj["banner_image_url"]),
    externalUrl: str(obj["external_url"]),
    twitterUsername: str(obj["twitter_username"]),
    discordUrl: str(obj["discord_url"]),
    telegramUrl: str(obj["telegram_url"]),
    instagramUsername: str(obj["instagram_username"]),
    category: str(obj["category"]),
    isDisabled: bool(obj["is_disabled"]),
    isNsfw: bool(obj["is_nsfw"]),
    traitOffersEnabled: bool(obj["trait_offers_enabled"]),
    collectionOffersEnabled: bool(obj["collection_offers_enabled"]),
    openseaUrl: str(obj["opensea_url"]),
    chain: str(arrFirst(obj["contracts"], "chain")) || str(obj["chain"]) || "ethereum",
    createdDate: str(obj["created_date"]),
    fees: fees.length > 0 ? fees : null,
    owner: str(obj["owner"]),
  };
}

function mapStats(slug: string, n: unknown): OsCollectionStats | null {
  const obj = asObj(n);
  if (!obj) return null;
  const total = asObj(obj["total"]);
  const intervals = Array.isArray(obj["intervals"]) ? obj["intervals"] : [];
  const iv0 = asObj(intervals[0]);
  const iv1 = asObj(intervals[1]);
  const iv2 = asObj(intervals[2]);
  return {
    collectionSlug: slug,
    floorPrice: str(total?.["floor_price"]) || "0",
    averagePrice: str(total?.["average_price"]) || "0",
    numOwners: num(total?.["num_owners"]),
    totalSupply: num(total?.["total_supply"]),
    marketCap: str(total?.["market_cap"]) || "0",
    totalVolume: str(total?.["volume"]) || "0",
    oneDayVolume: str(iv0?.["volume"]) || "0",
    sevenDayVolume: str(iv1?.["volume"]) || "0",
    thirtyDayVolume: str(iv2?.["volume"]) || "0",
    oneDaySales: num(iv0?.["sales"]),
    sevenDaySales: num(iv1?.["sales"]),
    thirtyDaySales: num(iv2?.["sales"]),
  };
}

function mapNft(n: unknown): OsNft | null {
  const obj = asObj(n);
  if (!obj) return null;
  return {
    identifier: str(obj["identifier"]) || "",
    collectionSlug: str(obj["collection"]) || "",
    contractAddress: str(obj["contract"]) || "",
    chain: str(obj["chain"]) || "",
    tokenStandard: str(obj["token_standard"]),
    name: str(obj["name"]),
    description: str(obj["description"]),
    imageUrl: str(obj["image_url"]),
    displayImageUrl: str(obj["display_image_url"]),
    displayAnimationUrl: str(obj["display_animation_url"]),
    metadataUrl: str(obj["metadata_url"]),
    openseaUrl: str(obj["opensea_url"]),
    isDisabled: bool(obj["is_disabled"]),
    isNsfw: bool(obj["is_nsfw"]),
    isSuspicious: bool(obj["is_suspicious"]),
    creatorAddress: str(obj["creator"]),
    traits: normalizeTraits(obj["traits"]),
    owners: obj["owners"],
    rarity: obj["rarity"],
    updatedAt: str(obj["updated_at"]),
  };
}

function mapListing(n: unknown): OsListing | null {
  const obj = asObj(n);
  if (!obj) return null;
  const priceNode = asObj(obj["price"]);
  const current = asObj(priceNode?.["current"]);
  const protocolData = asObj(obj["protocol_data"]);
  const parameters = asObj(protocolData?.["parameters"]);
  const offerArr = Array.isArray(parameters?.["offer"]) ? (parameters!["offer"] as unknown[]) : [];
  const offerParam = asObj(offerArr[0]);
  const endTime = obj["closing_date"] ?? parameters?.["endTime"];
  const startTime = parameters?.["startTime"];
  // fallback contract/tokenId from maker_asset_bundle
  const bundle = asObj(obj["maker_asset_bundle"]);
  const bundleAssets = Array.isArray(bundle?.["assets"]) ? (bundle!["assets"] as unknown[]) : [];
  const firstAsset = asObj(bundleAssets[0]);
  return {
    orderHash: str(obj["order_hash"]) || "",
    chain: str(obj["chain"]) || "",
    protocol: str(obj["protocol_address"]) || "",
    contractAddress:
      str(offerParam?.["token"]) ||
      str(asObj(firstAsset?.["asset_contract"])?.["address"]) || "",
    tokenId:
      str(offerParam?.["identifierOrCriteria"]) ||
      str(firstAsset?.["token_id"]) || "",
    orderType: str(obj["type"]) || str(obj["order_type"]) || "",
    maker: str(asObj(obj["maker"])?.["address"]) || "",
    taker: str(asObj(obj["taker"])?.["address"]),
    price: str(current?.["value"]) || "0",
    priceCurrency: str(current?.["currency"]),
    priceDecimals: str(current?.["decimals"]),
    priceUsd: str(current?.["usd_price"]),
    startDate: startTime ? unixToIso(startTime) : new Date().toISOString(),
    expirationDate: unixToIso(endTime),
    cancelled: bool(obj["cancelled"]),
    finalized: bool(obj["finalized"]),
    protocolData: obj["protocol_data"],
  };
}

function mapOffer(n: unknown): OsOffer | null {
  const obj = asObj(n);
  if (!obj) return null;
  const priceNode = asObj(obj["price"]);
  const current = asObj(priceNode?.["current"]);
  const protocolData = asObj(obj["protocol_data"]);
  const parameters = asObj(protocolData?.["parameters"]);
  const endTime = obj["closing_date"] ?? parameters?.["endTime"];
  const startTime = parameters?.["startTime"];
  return {
    orderHash: str(obj["order_hash"]) || "",
    chain: str(obj["chain"]) || "",
    protocol: str(obj["protocol_address"]) || "",
    offerType: str(obj["type"]) || str(obj["order_type"]) || "",
    maker: str(asObj(obj["maker"])?.["address"]) || "",
    taker: str(asObj(obj["taker"])?.["address"]),
    price: str(current?.["value"]) || "0",
    priceCurrency: str(current?.["currency"]),
    priceDecimals: str(current?.["decimals"]),
    priceUsd: str(current?.["usd_price"]),
    startDate: startTime ? unixToIso(startTime) : new Date().toISOString(),
    expirationDate: unixToIso(endTime),
    cancelled: bool(obj["cancelled"]),
    finalized: bool(obj["finalized"]),
    traitCriteria: typeof obj["trait_criteria"] === "object"
      ? JSON.stringify(obj["trait_criteria"])
      : str(obj["trait_criteria"]),
    protocolData: obj["protocol_data"],
  };
}

function mapEvent(n: unknown): OsEvent | null {
  const obj = asObj(n);
  if (!obj) return null;
  const nft = asObj(obj["nft"]);
  const payment = asObj(obj["payment"]);
  return {
    eventType: str(obj["event_type"]) || "",
    chain: str(obj["chain"]) || "",
    contractAddress: str(nft?.["contract"]) || "",
    tokenId: str(nft?.["identifier"]) || "",
    collectionSlug: str(nft?.["collection"]),
    orderHash: str(obj["order_hash"]),
    fromAddress: str(obj["from_address"]),
    toAddress: str(obj["to_address"]),
    maker: str(obj["seller"]),
    taker: str(obj["buyer"]),
    price: str(payment?.["quantity"]),
    priceCurrency: str(payment?.["symbol"]),
    quantity: str(obj["quantity"]),
    transactionHash: str(obj["transaction"]),
    eventTimestamp: unixToIso(obj["event_timestamp"]),
  };
}

function mapAccount(n: unknown): OsAccount | null {
  const obj = asObj(n);
  if (!obj) return null;
  const socials = Array.isArray(obj["social_media_accounts"]) ? obj["social_media_accounts"] as unknown[] : [];
  return {
    address: str(obj["address"]) || "",
    username: str(obj["username"]),
    profileImageUrl: str(obj["profile_image_url"]),
    bannerImageUrl: str(obj["banner_image_url"]),
    bio: str(obj["bio"]),
    website: str(obj["website"]),
    twitterUsername: str(asObj(socials[0])?.["username"]),
    openseaUrl: str(obj["opensea_url"]),
  };
}

// ── Client ────────────────────────────────────────────────────────────────────

type RawNode = Record<string, unknown>;

export const openSeaClient = {
  async getCollection(slug: string): Promise<OsCollection | null> {
    const data = await get<RawNode>(`collections/${slug}`);
    return data ? mapCollection(data) : null;
  },

  async listCollections(limit: number, chain?: string | null, creatorUsername?: string | null): Promise<PagedResult<OsCollection>> {
    const data = await get<RawNode>(`collections${qs({ limit, chain, creator_username: creatorUsername })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["collections"]) ? data["collections"] : []).map(mapCollection).filter((x): x is OsCollection => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getTrendingCollections(limit: number): Promise<PagedResult<OsCollection>> {
    const data = await get<RawNode>(`collections/trending${qs({ limit })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["collections"]) ? data["collections"] : []).map(mapCollection).filter((x): x is OsCollection => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getTopCollections(limit: number): Promise<PagedResult<OsCollection>> {
    const data = await get<RawNode>(`collections/top${qs({ limit })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["collections"]) ? data["collections"] : []).map(mapCollection).filter((x): x is OsCollection => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getCollectionStats(slug: string): Promise<OsCollectionStats | null> {
    const data = await get<RawNode>(`collections/${slug}/stats`);
    return data ? mapStats(slug, data) : null;
  },

  async getCollectionTraits(slug: string): Promise<OsCollectionTrait[]> {
    // Correct endpoint: /api/v2/traits/{slug}
    // Response: { categories: { traitType: "string", ... }, counts: { traitType: { value: count, ... }, ... } }
    const data = await get<RawNode>(`traits/${slug}`);
    if (!data) return [];
    const traits: OsCollectionTrait[] = [];
    const counts = asObj(data["counts"]);
    if (!counts) return traits;
    for (const [traitType, values] of Object.entries(counts)) {
      const traitCounts = asObj(values);
      if (!traitCounts) continue;
      for (const [value, count] of Object.entries(traitCounts)) {
        traits.push({ traitType, traitValue: value, count: num(count) });
      }
    }
    return traits;
  },

  async getNft(chain: string, contractAddress: string, identifier: string): Promise<OsNft | null> {
    const data = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${identifier}`);
    return data ? mapNft(data["nft"]) : null;
  },

  async listNftsByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsNft>> {
    const data = await get<RawNode>(`collection/${slug}/nfts${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["nfts"]) ? data["nfts"] : []).map(mapNft).filter((x): x is OsNft => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async listNftsByContract(chain: string, contractAddress: string, limit: number, next?: string | null): Promise<PagedResult<OsNft>> {
    const data = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["nfts"]) ? data["nfts"] : []).map(mapNft).filter((x): x is OsNft => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getNftsByAccount(address: string, chain?: string | null, limit?: number, next?: string | null): Promise<PagedResult<OsNft>> {
    const resolvedChain = chain ?? "ethereum";
    const data = await get<RawNode>(`chain/${resolvedChain}/account/${address}/nfts${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["nfts"]) ? data["nfts"] : []).map(mapNft).filter((x): x is OsNft => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getNftOwners(chain: string, contractAddress: string, identifier: string, limit: number, next?: string | null): Promise<PagedResult<unknown>> {
    const data = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${identifier}/owners${qs({ limit, next })}`);
    if (!data) return { data: [] };
    return { data: Array.isArray(data["owners"]) ? data["owners"] : [], next: str(data["next"]) };
  },

  async getListingsByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsListing>> {
    const data = await get<RawNode>(`listings/collection/${slug}/all${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["listings"]) ? data["listings"] : []).map(mapListing).filter((x): x is OsListing => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getBestListingsByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsListing>> {
    const data = await get<RawNode>(`listings/collection/${slug}/best${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["listings"]) ? data["listings"] : []).map(mapListing).filter((x): x is OsListing => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getBestListingByNft(chain: string, contractAddress: string, tokenId: string): Promise<OsListing | null> {
    // v2 has no chain/.../best_listing endpoint — resolve slug first, then use listings/collection/{slug}/nfts/{id}/best
    const nftData = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`);
    if (!nftData) return null;
    const slug = str(asObj(nftData["nft"])?.["collection"]);
    if (!slug) return null;
    const data = await get<RawNode>(`listings/collection/${slug}/nfts/${tokenId}/best`);
    if (!data) return null;
    return mapListing(data);
  },

  async getListingsByNft(chain: string, contractAddress: string, tokenId: string, limit: number, next?: string | null): Promise<PagedResult<OsListing>> {
    // v2 has no chain/.../nfts/{id}/listings endpoint — resolve slug and use best listing
    const nftData = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`);
    if (!nftData) return { data: [] };
    const slug = str(asObj(nftData["nft"])?.["collection"]);
    if (!slug) return { data: [] };
    const data = await get<RawNode>(`listings/collection/${slug}/nfts/${tokenId}/best`);
    if (!data) return { data: [] };
    const listing = mapListing(data);
    return { data: listing ? [listing] : [] };
  },

  async getOffersByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsOffer>> {
    const data = await get<RawNode>(`offers/collection/${slug}/all${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["offers"]) ? data["offers"] : []).map(mapOffer).filter((x): x is OsOffer => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getBestOffersByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsOffer>> {
    const data = await get<RawNode>(`offers/collection/${slug}/best${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["offers"]) ? data["offers"] : []).map(mapOffer).filter((x): x is OsOffer => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getTraitOffersByCollection(slug: string, limit: number, next?: string | null): Promise<PagedResult<OsOffer>> {
    const data = await get<RawNode>(`offers/collection/${slug}/traits${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["offers"]) ? data["offers"] : []).map(mapOffer).filter((x): x is OsOffer => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getBestOfferByNft(chain: string, contractAddress: string, tokenId: string): Promise<OsOffer | null> {
    // v2 has no chain/.../best_offer endpoint — resolve slug first, then use offers/collection/{slug}/nfts/{id}/best
    const nftData = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`);
    if (!nftData) return null;
    const slug = str(asObj(nftData["nft"])?.["collection"]);
    if (!slug) return null;
    const data = await get<RawNode>(`offers/collection/${slug}/nfts/${tokenId}/best`);
    if (!data) return null;
    return mapOffer(data);
  },

  async getOffersByNft(chain: string, contractAddress: string, tokenId: string, limit: number, next?: string | null): Promise<PagedResult<OsOffer>> {
    // v2 has no "all offers per NFT" endpoint — resolve slug and return best offer
    const nftData = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`);
    if (!nftData) return { data: [] };
    const slug = str(asObj(nftData["nft"])?.["collection"]);
    if (!slug) return { data: [] };
    const data = await get<RawNode>(`offers/collection/${slug}/nfts/${tokenId}/best`);
    if (!data) return { data: [] };
    const offer = mapOffer(data);
    return { data: offer ? [offer] : [] };
  },

  async getEventsByCollection(slug: string, eventType?: string | null, limit?: number, next?: string | null): Promise<PagedResult<OsEvent>> {
    const data = await get<RawNode>(`events/collection/${slug}${qs({ limit, event_type: eventType, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["asset_events"]) ? data["asset_events"] : []).map(mapEvent).filter((x): x is OsEvent => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getEventsByNft(chain: string, contractAddress: string, tokenId: string, eventType?: string | null, limit?: number, next?: string | null): Promise<PagedResult<OsEvent>> {
    const data = await get<RawNode>(`events/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}${qs({ limit, event_type: eventType, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["asset_events"]) ? data["asset_events"] : []).map(mapEvent).filter((x): x is OsEvent => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getEvents(address?: string | null, eventType?: string | null, limit?: number, next?: string | null): Promise<PagedResult<OsEvent>> {
    const data = await get<RawNode>(`events${qs({ account_address: address, event_type: eventType, limit, next })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["asset_events"]) ? data["asset_events"] : []).map(mapEvent).filter((x): x is OsEvent => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getAccount(addressOrUsername: string): Promise<OsAccount | null> {
    const data = await get<RawNode>(`accounts/${addressOrUsername}`);
    return data ? mapAccount(data) : null;
  },

  async resolveAccount(identifier: string): Promise<OsAccount | null> {
    const data = await get<RawNode>(`accounts/${identifier}/resolve`);
    return data ? mapAccount(data) : null;
  },

  async getListingsByAccount(address: string, limit: number, next?: string | null): Promise<PagedResult<OsListing>> {
    // OpenSea v2 has no accounts/{address}/listings endpoint — use sale events as listing history
    const data = await get<RawNode>(`events/accounts/${address}${qs({ limit, event_type: "sale", next })}`);
    if (!data) return { data: [] };
    const events = Array.isArray(data["asset_events"]) ? data["asset_events"] : [];
    const items: OsListing[] = events.map((n: unknown) => {
      const o = asObj(n);
      if (!o) return null;
      const nft = asObj(o["nft"]);
      const payment = asObj(o["payment"]);
      return {
        orderHash: str(o["order_hash"]) || "",
        chain: str(o["chain"]) || "",
        protocol: "",
        contractAddress: str(nft?.["contract"]) || "",
        tokenId: str(nft?.["identifier"]) || "",
        orderType: "sale",
        maker: str(o["seller"]) || "",
        taker: str(o["buyer"]),
        price: str(payment?.["quantity"]) || "0",
        priceCurrency: str(payment?.["symbol"]),
        priceDecimals: null,
        priceUsd: null,
        startDate: unixToIso(o["event_timestamp"]),
        expirationDate: "",
        cancelled: false,
        finalized: true,
        protocolData: null,
      } as OsListing;
    }).filter((x): x is OsListing => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getOffersReceivedByAccount(address: string, limit: number, next?: string | null): Promise<PagedResult<OsOffer>> {
    // OpenSea v2 has no accounts/{address}/offers-received endpoint — use offer events
    const data = await get<RawNode>(`events/accounts/${address}${qs({ limit, event_type: "offer", next })}`);
    if (!data) return { data: [] };
    const events = Array.isArray(data["asset_events"]) ? data["asset_events"] : [];
    const items: OsOffer[] = events.map((n: unknown) => {
      const o = asObj(n);
      if (!o) return null;
      const nft = asObj(o["nft"]);
      const payment = asObj(o["payment"]);
      return {
        orderHash: str(o["order_hash"]) || "",
        chain: str(o["chain"]) || "",
        protocol: "",
        offerType: "offer",
        maker: str(o["seller"]) || str(nft?.["contract"]) || "",
        taker: str(o["buyer"]),
        price: str(payment?.["quantity"]) || "0",
        priceCurrency: str(payment?.["symbol"]),
        priceDecimals: null,
        priceUsd: null,
        startDate: unixToIso(o["event_timestamp"]),
        expirationDate: "",
        cancelled: false,
        finalized: false,
        traitCriteria: null,
        protocolData: null,
      } as OsOffer;
    }).filter((x): x is OsOffer => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getOffersMadeByAccount(address: string, limit: number, next?: string | null): Promise<PagedResult<OsOffer>> {
    // OpenSea v2 does not expose offers-made separately — reuse offer events for the account
    const data = await get<RawNode>(`events/accounts/${address}${qs({ limit, event_type: "offer", next })}`);
    if (!data) return { data: [] };
    const events = Array.isArray(data["asset_events"]) ? data["asset_events"] : [];
    const items: OsOffer[] = events.map((n: unknown) => {
      const o = asObj(n);
      if (!o) return null;
      const nft = asObj(o["nft"]);
      const payment = asObj(o["payment"]);
      return {
        orderHash: str(o["order_hash"]) || "",
        chain: str(o["chain"]) || "",
        protocol: "",
        offerType: "offer",
        maker: str(o["seller"]) || str(nft?.["contract"]) || "",
        taker: str(o["buyer"]),
        price: str(payment?.["quantity"]) || "0",
        priceCurrency: str(payment?.["symbol"]),
        priceDecimals: null,
        priceUsd: null,
        startDate: unixToIso(o["event_timestamp"]),
        expirationDate: "",
        cancelled: false,
        finalized: false,
        traitCriteria: null,
        protocolData: null,
      } as OsOffer;
    }).filter((x): x is OsOffer => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getCollectionsByAccount(address: string, limit: number, next?: string | null): Promise<PagedResult<OsCollection>> {
    // OpenSea v2 has no accounts/{address}/collections endpoint — derive from owned NFTs on ethereum
    const data = await get<RawNode>(`chain/ethereum/account/${address}/nfts${qs({ limit, next })}`);
    if (!data) return { data: [] };
    const nfts = Array.isArray(data["nfts"]) ? data["nfts"] : [];
    const seen = new Set<string>();
    const collections: OsCollection[] = [];
    for (const n of nfts) {
      const o = asObj(n);
      if (!o) continue;
      const slug = str(o["collection"]);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      collections.push({
        slug,
        name: slug,
        chain: "ethereum",
        isDisabled: false,
        isNsfw: false,
        traitOffersEnabled: false,
        collectionOffersEnabled: false,
      });
    }
    return { data: collections, next: str(data["next"]) };
  },

  async getChains(): Promise<unknown[]> {
    const data = await get<RawNode>("chains");
    return data && Array.isArray(data["chains"]) ? data["chains"] : [];
  },

  async getContract(chain: string, address: string): Promise<unknown> {
    return get(`contracts/${chain}/${address}`);
  },

  async search(query: string, type?: string | null, limit?: number): Promise<PagedResult<unknown>> {
    const data = await get<unknown>(`search${qs({ query, result_type: type, limit })}`);
    if (!data) return { data: [] };
    if (Array.isArray(data)) return { data };
    const obj = asObj(data);
    const arr = Array.isArray(obj?.["results"]) ? obj!["results"] as unknown[] : [];
    return { data: arr, next: str(obj?.["next"]) };
  },

  async getCollectionHolders(slug: string, limit: number, cursor?: string | null): Promise<PagedResult<OsCollectionHolder>> {
    const data = await get<RawNode>(`collections/${slug}/holders${qs({ limit, cursor })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["holders"]) ? data["holders"] : []).map((h: unknown) => {
      const o = asObj(h);
      if (!o) return null;
      return { address: str(o["address"]) || "", quantity: num(o["quantity"]) };
    }).filter((x): x is OsCollectionHolder => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getCollectionFloorPrices(slug: string, timeframe?: string | null, resolution?: number | null): Promise<OsFloorPrice[]> {
    const data = await get<RawNode>(`collections/${slug}/floor_prices${qs({ timeframe, resolution })}`);
    if (!data) return [];
    const raw = Array.isArray(data["floor_prices"]) ? data["floor_prices"] : (Array.isArray(data) ? data as unknown[] : []);
    return (raw as unknown[]).map((fp: unknown) => {
      const o = asObj(fp);
      if (!o) return null;
      return { floor_price: num(o["floor_price"] ?? o["floor"]), timestamp: str(o["timestamp"] ?? o["date"]) || "" };
    }).filter((x): x is OsFloorPrice => x !== null);
  },

  async getCollectionOfferAggregates(slug: string, limit: number, cursor?: string | null): Promise<PagedResult<OsOfferAggregate>> {
    const data = await get<RawNode>(`collections/${slug}/offer_aggregates${qs({ limit, cursor })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["offer_aggregates"]) ? data["offer_aggregates"] : (Array.isArray(data) ? data as unknown[] : [])).map((o: unknown) => {
      const obj = asObj(o);
      if (!obj) return null;
      const priceNode = asObj(obj["price"]) ?? obj;
      return { price: str(priceNode["value"] ?? priceNode["amount"] ?? obj["price"]) || "0", currency: str(priceNode["currency"] ?? obj["currency"]) || "", quantity: num(obj["quantity"] ?? obj["count"]) };
    }).filter((x): x is OsOfferAggregate => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getNftAnalytics(chain: string, contractAddress: string, identifier: string): Promise<OsNftAnalytics | null> {
    const data = await get<RawNode>(`chain/${chain}/contract/${contractAddress}/nfts/${identifier}/analytics`);
    if (!data) return null;
    return {
      sales: num(data["sales"]),
      volume: str(data["volume"]) || "0",
      floorPrice: str(data["floor_price"] ?? data["floorPrice"]) || "0",
      averagePrice: str(data["average_price"] ?? data["averagePrice"]) || "0",
      numOwners: num(data["num_owners"] ?? data["numOwners"]),
    };
  },

  async refreshNftMetadata(chain: string, contractAddress: string, identifier: string, ignoreCachedItemUrls?: boolean): Promise<boolean> {
    const path = `chain/${chain}/contract/${contractAddress}/nfts/${identifier}/refresh${ignoreCachedItemUrls ? "?ignoreCachedItemUrls=true" : ""}`;
    const result = await post<RawNode>(path);
    return result !== null;
  },

  async getDrops(type?: string | null, limit?: number, chains?: string | null, cursor?: string | null): Promise<PagedResult<OsDrop>> {
    const data = await get<RawNode>(`drops${qs({ type, limit, chains, cursor })}`);
    if (!data) return { data: [] };
    const items = (Array.isArray(data["drops"]) ? data["drops"] : (Array.isArray(data) ? data as unknown[] : [])).map(mapDrop).filter((x): x is OsDrop => x !== null);
    return { data: items, next: str(data["next"]) };
  },

  async getDrop(slug: string): Promise<OsDrop | null> {
    const data = await get<RawNode>(`drops/${slug}`);
    return data ? mapDrop(data) : null;
  },

  async getPortfolioStats(address: string, timeframe?: string | null): Promise<OsPortfolioStats | null> {
    const data = await get<RawNode>(`account/${address}/portfolio${qs({ timeframe })}`);
    if (!data) return null;
    return {
      totalValueUsd: data["total_value_usd"] != null ? Number(data["total_value_usd"]) : null,
      nftValueUsd: data["nft_value_usd"] != null ? Number(data["nft_value_usd"]) : null,
      tokenValueUsd: data["token_value_usd"] != null ? Number(data["token_value_usd"]) : null,
      pnlAbsolute: data["pnl_absolute"] != null ? Number(data["pnl_absolute"]) : null,
      pnlPercentage: data["pnl_percentage"] != null ? Number(data["pnl_percentage"]) : null,
      timeframe: str(data["timeframe"]) || "DAY",
    };
  },

  async getWalletPnl(address: string): Promise<OsWalletPnl | null> {
    const data = await get<RawNode>(`account/${address}/pnl`);
    if (!data) return null;
    return {
      realizedPnlUsd: data["realized_pnl_usd"] != null ? Number(data["realized_pnl_usd"]) : null,
      unrealizedPnlUsd: data["unrealized_pnl_usd"] != null ? Number(data["unrealized_pnl_usd"]) : null,
      totalPnlUsd: data["total_pnl_usd"] != null ? Number(data["total_pnl_usd"]) : null,
      netInvestedUsd: data["net_invested_usd"] != null ? Number(data["net_invested_usd"]) : null,
      currentValueUsd: data["current_value_usd"] != null ? Number(data["current_value_usd"]) : null,
      returnPercentage: str(data["return_percentage"]),
    };
  },

  async getProfileShelves(address: string): Promise<OsProfileShelf[]> {
    const data = await get<RawNode>(`profile/shelves${qs({ address })}`);
    if (!data) return [];
    const raw = Array.isArray(data) ? data as unknown[] : (Array.isArray(data["shelves"]) ? data["shelves"] as unknown[] : []);
    return raw.map((s: unknown) => {
      const obj = asObj(s);
      if (!obj) return null;
      const items = Array.isArray(obj["items"]) ? (obj["items"] as unknown[]).map((item: unknown) => {
        const io = asObj(item);
        if (!io) return null;
        return { chain: str(io["chain"]) || "", contractAddress: str(io["contract_address"]) || "", tokenId: str(io["token_id"]) || "" };
      }).filter((x): x is { chain: string; contractAddress: string; tokenId: string } => x !== null) : [];
      return {
        id: str(obj["id"]) || "",
        title: str(obj["title"]) || "",
        description: str(obj["description"]),
        displayOrder: num(obj["display_order"]),
        items,
      };
    }).filter((x): x is OsProfileShelf => x !== null);
  },
};
