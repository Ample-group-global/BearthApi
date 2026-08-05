import { ethers } from "ethers";
import { logger } from "../logger";

let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) throw new Error("ETH_RPC_URL env var is required");
    // Long polling interval to avoid overwhelming public RPC rate limits in development
    _provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { polling: true, pollingInterval: 60_000 });
    // Suppress RPC-level errors at the provider so they don't become unhandled rejections.
    // Thousands of unhandled rejections flood stderr synchronously, blocking Node.js's event loop.
    _provider.on("error", (err: Error) => {
      logger.warn("[provider] RPC error", err);
    });
  }
  return _provider;
}
