import { Router } from "express";
import { ethers } from "ethers";

const router = Router();
const ETH_ADDR = /^0x[a-fA-F0-9]{40}$/;

const RPC_URL         = process.env.ETH_RPC_URL      || "https://ethereum-sepolia-rpc.publicnode.com";
const CONTRACT_ADDR   = process.env.CONTRACT_ADDRESS  || "";
const UPGRADE_ADDR    = process.env.UPGRADE_NFT_ADDRESS || "";

const NFT_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function totalSupply() external view returns (uint256)",
];

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

/**
 * Scan ownerOf(1..totalSupply) to find all token IDs owned by addr.
 * Handles tokens beyond totalSupply (ERC721A burn counter discrepancy)
 * by checking up to totalSupply + extra buffer.
 */
async function getOwnedTokenIds(addr: string, contractAddress: string): Promise<number[]> {
  if (!contractAddress) return [];
  const provider = getProvider();
  const nft = new ethers.Contract(contractAddress, NFT_ABI, provider);

  const [balance, supply] = await Promise.all([
    nft.balanceOf(addr).catch(() => 0n),
    nft.totalSupply().catch(() => 0n),
  ]);

  if (Number(balance) === 0) return [];

  // Scan up to supply + 20 buffer (burned tokens reduce supply but IDs still exist)
  const scanLimit = Number(supply) + 20;
  const checks = Array.from({ length: scanLimit }, (_, i) =>
    nft.ownerOf(i + 1)
      .then((owner: string) => owner.toLowerCase() === addr.toLowerCase() ? i + 1 : null)
      .catch(() => null)
  );
  const results = await Promise.all(checks);
  return results.filter((id): id is number => id !== null);
}

/**
 * GET /api/nfts/owned?address=0x...&collection=genesis|upgrade
 *
 * Returns token IDs currently owned by the given wallet address.
 * Reads directly from the blockchain for accuracy — no DB dependency.
 */
router.get("/owned", async (req, res, next) => {
  const { address, collection = "genesis" } = req.query;

  if (!address || !ETH_ADDR.test(address as string)) {
    res.status(400).json({ detail: "Invalid or missing address parameter" });
    return;
  }

  const addr = (address as string).toLowerCase();

  try {
    let tokenIds: number[] = [];

    if ((collection as string) === "upgrade") {
      tokenIds = await getOwnedTokenIds(addr, UPGRADE_ADDR);
    } else {
      tokenIds = await getOwnedTokenIds(addr, CONTRACT_ADDR);
    }

    res.json({ tokenIds, collection: collection as string });
  } catch (e) {
    next(e);
  }
});

export default router;
