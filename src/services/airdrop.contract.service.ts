import { ethers, type Contract } from "ethers";
import { abi as BearthAirdrop_ABI } from "../abi/BearthAirdrop.abi.json";

// ── Singletons ────────────────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;
let _contractSigned: Contract | null = null;
let _contractRO:     Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) throw new Error("ETH_RPC_URL env var is required");
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

function getAirdropContractWithSigner(): Contract {
  if (!_contractSigned) {
    const addr       = process.env.AIRDROP_CONTRACT_ADDRESS;
    const privateKey = process.env.FIXED_PRIVATE_KEY;
    if (!addr)       throw new Error("AIRDROP_CONTRACT_ADDRESS env var is required");
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _contractSigned = new ethers.Contract(addr, BearthAirdrop_ABI, signer);
  }
  return _contractSigned;
}

function getAirdropContractReadOnly(): Contract {
  if (!_contractRO) {
    const addr = process.env.AIRDROP_CONTRACT_ADDRESS;
    if (!addr) throw new Error("AIRDROP_CONTRACT_ADDRESS env var is required");
    _contractRO = new ethers.Contract(addr, BearthAirdrop_ABI, getProvider());
  }
  return _contractRO;
}

async function callAirdropContract(
  methodName: string,
  args: unknown[] = [],
  overrides: Record<string, unknown> = {}
): Promise<ethers.TransactionReceipt> {
  const contract = getAirdropContractWithSigner();
  const tx = await (contract[methodName] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(
    ...args, overrides
  );
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${methodName} tx`);
  return receipt;
}

// ── ETH Airdrops ──────────────────────────────────────────────────────────────

export async function airdropETHEqual(
  recipients: string[],
  amountEachEth: string
): Promise<ethers.TransactionReceipt> {
  if (!recipients.length) throw new Error("recipients must not be empty");
  if (recipients.length > 500) throw new Error("Maximum 500 recipients");
  const amountWei = ethers.parseEther(amountEachEth);
  const totalWei  = amountWei * BigInt(recipients.length);
  return callAirdropContract("airdropEqual", [recipients, amountWei], { value: totalWei });
}

export async function airdropETHSkipFailed(
  recipients: string[],
  amountEachEth: string
): Promise<ethers.TransactionReceipt> {
  if (!recipients.length) throw new Error("recipients must not be empty");
  if (recipients.length > 500) throw new Error("Maximum 500 recipients");
  const amountWei = ethers.parseEther(amountEachEth);
  const totalWei  = amountWei * BigInt(recipients.length);
  return callAirdropContract("airdropEqualSkipFailed", [recipients, amountWei], { value: totalWei });
}

export async function airdropETHVariable(
  recipients: string[],
  amountsEth: string[]
): Promise<ethers.TransactionReceipt> {
  if (!recipients.length) throw new Error("recipients must not be empty");
  if (recipients.length !== amountsEth.length) throw new Error("recipients and amounts length mismatch");
  if (recipients.length > 500) throw new Error("Maximum 500 recipients");
  const amountsWei = amountsEth.map(a => ethers.parseEther(a));
  const totalWei   = amountsWei.reduce((s, a) => s + a, 0n);
  return callAirdropContract("airdrop", [recipients, amountsWei], { value: totalWei });
}

// ── ERC20 Airdrops ────────────────────────────────────────────────────────────

export async function airdropERC20Equal(
  tokenAddress: string,
  recipients: string[],
  amountEachWei: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(tokenAddress)) throw new Error("Invalid token address");
  if (!recipients.length) throw new Error("recipients must not be empty");
  if (recipients.length > 500) throw new Error("Maximum 500 recipients");
  return callAirdropContract("airdropERC20Equal", [tokenAddress, recipients, BigInt(amountEachWei)]);
}

export async function airdropERC20Variable(
  tokenAddress: string,
  recipients: string[],
  amountsWei: string[]
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(tokenAddress)) throw new Error("Invalid token address");
  if (!recipients.length) throw new Error("recipients must not be empty");
  if (recipients.length !== amountsWei.length) throw new Error("recipients and amounts length mismatch");
  if (recipients.length > 500) throw new Error("Maximum 500 recipients");
  return callAirdropContract("airdropERC20", [tokenAddress, recipients, amountsWei.map(a => BigInt(a))]);
}

// ── ERC721 Airdrop ────────────────────────────────────────────────────────────

export async function airdropERC721(
  tokenAddress: string,
  recipients: string[],
  tokenIds: number[]
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(tokenAddress)) throw new Error("Invalid NFT contract address");
  if (!recipients.length) throw new Error("recipients must not be empty");
  if (recipients.length !== tokenIds.length) throw new Error("recipients and tokenIds length mismatch");
  if (recipients.length > 500) throw new Error("Maximum 500 recipients");
  return callAirdropContract("airdropERC721", [tokenAddress, recipients, tokenIds]);
}

// ── Rescue ────────────────────────────────────────────────────────────────────

export async function airdropRescue(
  to: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to)) throw new Error("Invalid rescue address");
  return callAirdropContract("rescue", [to]);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function airdropQuoteEqual(
  recipientCount: number,
  amountEachEth: string
): Promise<{ totalEth: string; totalWei: string }> {
  const amountWei = ethers.parseEther(amountEachEth);
  const totalWei  = await getAirdropContractReadOnly().quoteEqual(recipientCount, amountWei);
  return { totalEth: ethers.formatEther(totalWei), totalWei: totalWei.toString() };
}
