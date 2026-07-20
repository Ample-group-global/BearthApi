import { Router } from "express";
import { requireRole } from "../adminAuth";
import { openSeaClient } from "../services/opensea-client";
import * as svc from "../services/opensea.service";

const router = Router();

function auth(req: Parameters<typeof requireRole>[0]): void {
  requireRole(req);
}

// ── Collections ───────────────────────────────────────────────────────────────
// specific routes MUST come before parameterized /:slug

router.get("/collections/trending", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getTrendingCollections(limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/top", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getTopCollections(limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const chain = req.query["chain"] as string | undefined;
    const creatorUsername = req.query["creator_username"] as string | undefined;
    const data = await svc.listCollections(limit, chain, creatorUsername);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/:slug/stats", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.getCollectionStats(req.params["slug"]!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/:slug/traits", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.getCollectionTraits(req.params["slug"]!);
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/collections/:slug/sync", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.syncCollection(req.params["slug"]!);
    if (!data) return res.status(404).json({ error: "Collection not found on OpenSea" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/:slug/holders", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 20;
    const cursor = req.query["cursor"] as string | undefined;
    const data = await openSeaClient.getCollectionHolders(req.params["slug"]!, limit, cursor);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/:slug/floor-prices", async (req, res, next) => {
  try {
    auth(req);
    const timeframe = req.query["timeframe"] as string | undefined;
    const resolution = req.query["resolution"] ? Number(req.query["resolution"]) : undefined;
    const data = await openSeaClient.getCollectionFloorPrices(req.params["slug"]!, timeframe, resolution);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/:slug/offer-aggregates", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 20;
    const cursor = req.query["cursor"] as string | undefined;
    const data = await openSeaClient.getCollectionOfferAggregates(req.params["slug"]!, limit, cursor);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/collections/:slug", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.getCollection(req.params["slug"]!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

// ── NFTs ──────────────────────────────────────────────────────────────────────
// specific sub-routes before parameterized

router.get("/nfts/chain/:chain/contract/:contractAddress/:identifier/owners", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, identifier } = req.params as Record<string, string>;
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getNftOwners(chain!, contractAddress!, identifier!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/nfts/chain/:chain/contract/:contractAddress/:identifier/sync", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, identifier } = req.params as Record<string, string>;
    const data = await svc.syncNft(chain!, contractAddress!, identifier!);
    if (!data) return res.status(404).json({ error: "NFT not found on OpenSea" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/nfts/chain/:chain/contract/:contractAddress/:identifier/analytics", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, identifier } = req.params as Record<string, string>;
    const data = await openSeaClient.getNftAnalytics(chain!, contractAddress!, identifier!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/nfts/chain/:chain/contract/:contractAddress/:identifier/refresh", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, identifier } = req.params as Record<string, string>;
    const ignoreCached = req.query["ignoreCachedItemUrls"] === "true";
    await openSeaClient.refreshNftMetadata(chain!, contractAddress!, identifier!, ignoreCached);
    res.json({ message: "Metadata refresh triggered" });
  } catch (e) { next(e); }
});

router.get("/nfts/chain/:chain/contract/:contractAddress/:identifier", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, identifier } = req.params as Record<string, string>;
    const data = await svc.getNft(chain!, contractAddress!, identifier!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/nfts/chain/:chain/contract/:contractAddress", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress } = req.params as Record<string, string>;
    const limit = Number(req.query["limit"]) || 50;
    const next = req.query["next"] as string | undefined;
    const data = await svc.listNftsByContract(chain!, contractAddress!, limit, next);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/nfts/collection/:slug", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const next = req.query["next"] as string | undefined;
    const data = await svc.listNftsByCollection(req.params["slug"]!, limit, next);
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/nfts/collection/:slug/sync-all", async (req, res, next) => {
  try {
    auth(req);
    const result = await svc.syncAllNftsByCollection(req.params["slug"]!);
    res.json({ message: `Synced ${result.synced} NFTs`, synced: result.synced });
  } catch (e) { next(e); }
});

router.get("/nfts/account/:address", async (req, res, next) => {
  try {
    auth(req);
    const chain = req.query["chain"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getNftsByAccount(req.params["address"]!, chain, limit);
    res.json(data);
  } catch (e) { next(e); }
});

// ── Listings ──────────────────────────────────────────────────────────────────

router.get("/listings/collection/:slug/best", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getBestListingsByCollection(req.params["slug"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/listings/collection/:slug/sync", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.syncListingsByCollection(req.params["slug"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/listings/collection/:slug", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getListingsByCollection(req.params["slug"]!, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/listings/chain/:chain/contract/:contractAddress/nft/:tokenId/best", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, tokenId } = req.params as Record<string, string>;
    const data = await svc.getBestListingByNft(chain!, contractAddress!, tokenId!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/listings/chain/:chain/contract/:contractAddress/nft/:tokenId", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, tokenId } = req.params as Record<string, string>;
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getListingsByNft(chain!, contractAddress!, tokenId!, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

// ── Offers ────────────────────────────────────────────────────────────────────

router.get("/offers/collection/:slug/best", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getBestOffersByCollection(req.params["slug"]!, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/offers/collection/:slug/traits", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getTraitOffersByCollection(req.params["slug"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/offers/collection/:slug/sync", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.syncOffersByCollection(req.params["slug"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/offers/collection/:slug", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getOffersByCollection(req.params["slug"]!, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/offers/chain/:chain/contract/:contractAddress/nft/:tokenId/best", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, tokenId } = req.params as Record<string, string>;
    const data = await svc.getBestOfferByNft(chain!, contractAddress!, tokenId!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/offers/chain/:chain/contract/:contractAddress/nft/:tokenId", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, tokenId } = req.params as Record<string, string>;
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getOffersByNft(chain!, contractAddress!, tokenId!, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

// ── Events ────────────────────────────────────────────────────────────────────

router.get("/events/collection/:slug", async (req, res, next) => {
  try {
    auth(req);
    const eventType = req.query["event_type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getEventsByCollection(req.params["slug"]!, eventType, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/events/chain/:chain/contract/:contractAddress/nft/:tokenId", async (req, res, next) => {
  try {
    auth(req);
    const { chain, contractAddress, tokenId } = req.params as Record<string, string>;
    const eventType = req.query["event_type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const data = await svc.getEventsByNft(chain!, contractAddress!, tokenId!, eventType, limit, offset);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/events/account/:address", async (req, res, next) => {
  try {
    auth(req);
    const eventType = req.query["event_type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const result = await openSeaClient.getEvents(req.params["address"]!, eventType, limit);
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/events/collection/:slug/sync", async (req, res, next) => {
  try {
    auth(req);
    const eventType = req.query["event_type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.syncEventsByCollection(req.params["slug"]!, eventType, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/events", async (req, res, next) => {
  try {
    auth(req);
    const address = req.query["address"] as string | undefined;
    const eventType = req.query["event_type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getEvents(address, eventType, limit);
    res.json(data);
  } catch (e) { next(e); }
});

// ── Accounts ──────────────────────────────────────────────────────────────────
// specific sub-routes before parameterized /:addressOrUsername

router.get("/accounts", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const offset = Number(req.query["offset"]) || 0;
    const search = req.query["search"] as string | undefined;
    const data = await svc.listAccounts(limit, offset, search);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/resolve", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.resolveAccount(req.params["address"]!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/listings", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getListingsByAccount(req.params["address"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/offers-received", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getOffersReceivedByAccount(req.params["address"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/offers-made", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getOffersMadeByAccount(req.params["address"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/collections", async (req, res, next) => {
  try {
    auth(req);
    const limit = Number(req.query["limit"]) || 50;
    const data = await svc.getCollectionsByAccount(req.params["address"]!, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.post("/accounts/:addressOrUsername/sync", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.syncAccount(req.params["addressOrUsername"]!);
    if (!data) return res.status(404).json({ error: "Account not found on OpenSea" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/portfolio", async (req, res, next) => {
  try {
    auth(req);
    const timeframe = req.query["timeframe"] as string | undefined;
    const data = await openSeaClient.getPortfolioStats(req.params["address"]!, timeframe);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:address/pnl", async (req, res, next) => {
  try {
    auth(req);
    const data = await openSeaClient.getWalletPnl(req.params["address"]!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/accounts/:addressOrUsername", async (req, res, next) => {
  try {
    auth(req);
    const data = await svc.getAccount(req.params["addressOrUsername"]!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

// ── Chains, Contracts, Search ─────────────────────────────────────────────────

router.get("/chains", async (req, res, next) => {
  try {
    auth(req);
    const data = await openSeaClient.getChains();
    res.json({ chains: data });
  } catch (e) { next(e); }
});

router.get("/contracts/:chain/:address", async (req, res, next) => {
  try {
    auth(req);
    const { chain, address } = req.params as Record<string, string>;
    const data = await openSeaClient.getContract(chain!, address!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/search", async (req, res, next) => {
  try {
    auth(req);
    const query = req.query["query"] as string | undefined;
    if (!query?.trim()) return res.status(400).json({ error: "query parameter is required" });
    const type = req.query["type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 50;
    const data = await openSeaClient.search(query, type, limit);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/drops", async (req, res, next) => {
  try {
    auth(req);
    const type = req.query["type"] as string | undefined;
    const limit = Number(req.query["limit"]) || 20;
    const chains = req.query["chains"] as string | undefined;
    const cursor = req.query["cursor"] as string | undefined;
    const data = await openSeaClient.getDrops(type, limit, chains, cursor);
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/drops/:slug", async (req, res, next) => {
  try {
    auth(req);
    const data = await openSeaClient.getDrop(req.params["slug"]!);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (e) { next(e); }
});

router.get("/profile/shelves", async (req, res, next) => {
  try {
    auth(req);
    const address = req.query["address"] as string | undefined;
    if (!address) return res.status(400).json({ error: "address query param required" });
    const data = await openSeaClient.getProfileShelves(address);
    res.json(data);
  } catch (e) { next(e); }
});

export default router;
