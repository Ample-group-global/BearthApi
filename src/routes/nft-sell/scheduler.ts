import { Router } from "express";
import { ethers } from "ethers";
import { requireAdmin } from "../../adminAuth";
import { abi as SchedulerABI } from "../../abi/BearthScheduler.abi.json";

const router = Router();

function getProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.ETH_RPC_URL;
  if (!rpcUrl) throw new Error("ETH_RPC_URL env var is required");
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getSchedulerRO(): ethers.Contract {
  const addr = process.env.SCHEDULER_CONTRACT_ADDRESS;
  if (!addr) throw new Error("SCHEDULER_CONTRACT_ADDRESS env var is required");
  return new ethers.Contract(addr, SchedulerABI, getProvider());
}

function getSchedulerSigned(): ethers.Contract {
  const addr       = process.env.SCHEDULER_CONTRACT_ADDRESS;
  const privateKey = process.env.FIXED_PRIVATE_KEY;
  if (!addr)       throw new Error("SCHEDULER_CONTRACT_ADDRESS env var is required");
  if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
  const signer = new ethers.Wallet(privateKey, getProvider());
  return new ethers.Contract(addr, SchedulerABI, signer);
}

async function callScheduler(method: string, args: unknown[] = []): Promise<ethers.TransactionReceipt> {
  const contract = getSchedulerSigned();
  const tx       = await (contract[method] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(...args);
  const receipt  = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${method}`);
  return receipt;
}

// GET /api/nft-sell/scheduler/status — full status snapshot
router.get("/status", async (_req, res, next) => {
  try {
    const c = getSchedulerRO();
    const s = await c.getStatus();
    res.json({
      autoPhaseEnabled:       s._autoPhaseEnabled,
      autoRevealEnabled:      s._autoRevealEnabled,
      autoWaveRevealEnabled:  s._autoWaveRevealEnabled,
      currentPhase:           Number(s._currentPhase),
      paidMintScheduledAt:    Number(s._paidMintScheduledAt),
      paidMintReady:          s._paidMintReady,
      revealedScheduledAt:    Number(s._revealedScheduledAt),
      revealedReady:          s._revealedReady,
      revealAt:               Number(s._revealAt),
      revealURI:              s._revealURI,
      revealReady:            s._revealReady,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/auto-wave-reveal — toggle auto wave reveal mode
// Body: { enabled: boolean }
router.post("/auto-wave-reveal", requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });
    const receipt = await callScheduler("setAutoWaveRevealEnabled", [enabled]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/auto-phase — toggle auto phase mode
// Body: { enabled: boolean }
router.post("/auto-phase", requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });
    const receipt = await callScheduler("setAutoPhaseEnabled", [enabled]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/auto-reveal — toggle auto reveal mode
// Body: { enabled: boolean }
router.post("/auto-reveal", requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });
    const receipt = await callScheduler("setAutoRevealEnabled", [enabled]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/schedule-phase — schedule a phase transition
// Body: { phase: 1|2, timestamp: number (unix seconds) }
router.post("/schedule-phase", requireAdmin, async (req, res, next) => {
  try {
    const { phase, timestamp } = req.body as { phase: number; timestamp: number };
    if (phase !== 1 && phase !== 2) return res.status(400).json({ error: "phase must be 1 (PaidMint) or 2 (Revealed)" });
    if (!timestamp || timestamp <= Math.floor(Date.now() / 1000))
      return res.status(400).json({ error: "timestamp must be in the future (unix seconds)" });
    const receipt = await callScheduler("schedulePhaseTransition", [phase, timestamp]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/scheduler/schedule-phase/:phase — cancel scheduled phase
router.delete("/schedule-phase/:phase", requireAdmin, async (req, res, next) => {
  try {
    const phase = parseInt(req.params.phase);
    if (phase !== 1 && phase !== 2) return res.status(400).json({ error: "phase must be 1 or 2" });
    const receipt = await callScheduler("cancelScheduledPhase", [phase]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/trigger-phase/:phase — public trigger (auto mode must be on)
router.post("/trigger-phase/:phase", async (req, res, next) => {
  try {
    const phase = parseInt(req.params.phase);
    if (phase !== 1 && phase !== 2) return res.status(400).json({ error: "phase must be 1 or 2" });
    const receipt = await callScheduler("triggerScheduledPhase", [phase]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/schedule-reveal — schedule a reveal
// Body: { uri: string, timestamp: number }
router.post("/schedule-reveal", requireAdmin, async (req, res, next) => {
  try {
    const { uri, timestamp } = req.body as { uri: string; timestamp: number };
    if (!uri?.startsWith("ipfs://")) return res.status(400).json({ error: "uri must start with ipfs://" });
    if (!timestamp || timestamp <= Math.floor(Date.now() / 1000))
      return res.status(400).json({ error: "timestamp must be in the future (unix seconds)" });
    const receipt = await callScheduler("scheduleReveal", [uri, timestamp]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/scheduler/schedule-reveal — cancel scheduled reveal
router.delete("/schedule-reveal", requireAdmin, async (req, res, next) => {
  try {
    const receipt = await callScheduler("cancelScheduledReveal", []);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/trigger-reveal — public trigger (auto reveal mode must be on)
router.post("/trigger-reveal", async (req, res, next) => {
  try {
    const receipt = await callScheduler("triggerScheduledReveal", []);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/manual-phase — manual immediate phase set
// Body: { phase: 1|2 }
router.post("/manual-phase", requireAdmin, async (req, res, next) => {
  try {
    const { phase } = req.body as { phase: number };
    if (phase !== 1 && phase !== 2) return res.status(400).json({ error: "phase must be 1 (PaidMint) or 2 (Revealed)" });
    const receipt = await callScheduler("manualSetPhase", [phase]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/manual-reveal — manual immediate reveal
// Body: { uri: string }
router.post("/manual-reveal", requireAdmin, async (req, res, next) => {
  try {
    const { uri } = req.body as { uri: string };
    if (!uri?.startsWith("ipfs://")) return res.status(400).json({ error: "uri must start with ipfs://" });
    const receipt = await callScheduler("manualReveal", [uri]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/scheduler/wave-reveal-status/:waveNum — per-wave reveal schedule
router.get("/wave-reveal-status/:waveNum", async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNum);
    if (waveNum < 1 || waveNum > 7) return res.status(400).json({ error: "waveNum must be 1–7" });
    const c = getSchedulerRO();
    const s = await c.getWaveRevealStatus(waveNum);
    res.json({
      waveNum,
      scheduledAt: Number(s.scheduledAt),
      uri:         s.uri,
      ready:       s.ready,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/schedule-wave-reveal — schedule a per-wave reveal
// Body: { waveNum: 1-7, uri: string, timestamp: number }
router.post("/schedule-wave-reveal", requireAdmin, async (req, res, next) => {
  try {
    const { waveNum, uri, timestamp } = req.body as { waveNum: number; uri: string; timestamp: number };
    if (!waveNum || waveNum < 1 || waveNum > 7) return res.status(400).json({ error: "waveNum must be 1–7" });
    if (!uri?.startsWith("ipfs://")) return res.status(400).json({ error: "uri must start with ipfs://" });
    if (!timestamp || timestamp <= Math.floor(Date.now() / 1000))
      return res.status(400).json({ error: "timestamp must be in the future (unix seconds)" });
    const receipt = await callScheduler("scheduleWaveReveal", [waveNum, uri, timestamp]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/scheduler/schedule-wave-reveal/:waveNum — cancel wave reveal schedule
router.delete("/schedule-wave-reveal/:waveNum", requireAdmin, async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNum);
    if (waveNum < 1 || waveNum > 7) return res.status(400).json({ error: "waveNum must be 1–7" });
    const receipt = await callScheduler("cancelScheduledWaveReveal", [waveNum]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/trigger-wave-reveal/:waveNum — public trigger (auto wave reveal mode must be on)
router.post("/trigger-wave-reveal/:waveNum", async (req, res, next) => {
  try {
    const waveNum = parseInt(req.params.waveNum);
    if (waveNum < 1 || waveNum > 7) return res.status(400).json({ error: "waveNum must be 1–7" });
    const receipt = await callScheduler("triggerScheduledWaveReveal", [waveNum]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/manual-wave-reveal — immediate per-wave reveal
// Body: { waveNum: 1-7, uri: string }
router.post("/manual-wave-reveal", requireAdmin, async (req, res, next) => {
  try {
    const { waveNum, uri } = req.body as { waveNum: number; uri: string };
    if (!waveNum || waveNum < 1 || waveNum > 7) return res.status(400).json({ error: "waveNum must be 1–7" });
    if (!uri?.startsWith("ipfs://")) return res.status(400).json({ error: "uri must start with ipfs://" });
    const receipt = await callScheduler("manualWaveReveal", [waveNum, uri]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/pause
router.post("/pause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await callScheduler("pause", []);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/scheduler/unpause
router.post("/unpause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await callScheduler("unpause", []);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
