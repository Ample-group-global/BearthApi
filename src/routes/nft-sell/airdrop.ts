import { Router } from "express";
import { requireAdmin } from "../../adminAuth";
import {
  airdropETHEqual,
  airdropETHSkipFailed,
  airdropETHVariable,
  airdropERC20Equal,
  airdropERC20Variable,
  airdropERC721,
  airdropRescue,
  airdropQuoteEqual,
} from "../../services/airdrop.contract.service";

const router = Router();

// GET /api/nft-sell/airdrop/quote — preview total ETH required for equal airdrop
// Query: ?recipientCount=100&amountEachEth=0.01
router.get("/quote", async (req, res, next) => {
  try {
    const recipientCount = parseInt(req.query.recipientCount as string, 10);
    const amountEachEth  = req.query.amountEachEth as string;
    if (!recipientCount || !amountEachEth)
      return res.status(400).json({ error: "recipientCount and amountEachEth required" });
    const quote = await airdropQuoteEqual(recipientCount, amountEachEth);
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/eth/equal — same ETH to all recipients, all-or-nothing
// Body: { recipients: string[], amountEachEth: string }
router.post("/eth/equal", requireAdmin, async (req, res, next) => {
  try {
    const { recipients, amountEachEth } = req.body as {
      recipients: string[]; amountEachEth: string;
    };
    if (!Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "recipients array required" });
    if (!amountEachEth)
      return res.status(400).json({ error: "amountEachEth required (ETH string, e.g. '0.01')" });

    const receipt = await airdropETHEqual(recipients, amountEachEth);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/eth/skip-failed — same ETH, skips contracts that can't receive
// Body: { recipients: string[], amountEachEth: string }
router.post("/eth/skip-failed", requireAdmin, async (req, res, next) => {
  try {
    const { recipients, amountEachEth } = req.body as {
      recipients: string[]; amountEachEth: string;
    };
    if (!Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "recipients array required" });
    if (!amountEachEth)
      return res.status(400).json({ error: "amountEachEth required" });

    const receipt = await airdropETHSkipFailed(recipients, amountEachEth);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/eth/variable — different ETH amount per recipient
// Body: { recipients: string[], amountsEth: string[] }
router.post("/eth/variable", requireAdmin, async (req, res, next) => {
  try {
    const { recipients, amountsEth } = req.body as {
      recipients: string[]; amountsEth: string[];
    };
    if (!Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "recipients array required" });
    if (!Array.isArray(amountsEth) || amountsEth.length !== recipients.length)
      return res.status(400).json({ error: "amountsEth must be same length as recipients" });

    const receipt = await airdropETHVariable(recipients, amountsEth);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/erc20/equal — same ERC20 amount to all recipients
// Body: { tokenAddress: string, recipients: string[], amountEachWei: string }
// Note: caller must approve BearthAirdrop contract on the token before calling this
router.post("/erc20/equal", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, recipients, amountEachWei } = req.body as {
      tokenAddress: string; recipients: string[]; amountEachWei: string;
    };
    if (!tokenAddress || !Array.isArray(recipients) || !recipients.length || !amountEachWei)
      return res.status(400).json({ error: "tokenAddress, recipients[], amountEachWei required" });

    const receipt = await airdropERC20Equal(tokenAddress, recipients, amountEachWei);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/erc20/variable — different ERC20 amount per recipient
// Body: { tokenAddress: string, recipients: string[], amountsWei: string[] }
router.post("/erc20/variable", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, recipients, amountsWei } = req.body as {
      tokenAddress: string; recipients: string[]; amountsWei: string[];
    };
    if (!tokenAddress || !Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "tokenAddress, recipients[], amountsWei[] required" });
    if (!Array.isArray(amountsWei) || amountsWei.length !== recipients.length)
      return res.status(400).json({ error: "amountsWei must be same length as recipients" });

    const receipt = await airdropERC20Variable(tokenAddress, recipients, amountsWei);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/nft — airdrop specific ERC721 token IDs to recipients
// Body: { tokenAddress: string, recipients: string[], tokenIds: number[] }
// Note: caller must setApprovalForAll on tokenAddress to BearthAirdrop contract first
router.post("/nft", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, recipients, tokenIds } = req.body as {
      tokenAddress: string; recipients: string[]; tokenIds: number[];
    };
    if (!tokenAddress || !Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "tokenAddress, recipients[], tokenIds[] required" });
    if (!Array.isArray(tokenIds) || tokenIds.length !== recipients.length)
      return res.status(400).json({ error: "tokenIds must be same length as recipients" });

    const receipt = await airdropERC721(tokenAddress, recipients, tokenIds);
    res.json({ ok: true, txHash: receipt.hash, count: recipients.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/airdrop/rescue — sweep any stuck ETH from the airdrop contract
// Body: { to: string }
router.post("/rescue", requireAdmin, async (req, res, next) => {
  try {
    const { to } = req.body as { to: string };
    if (!to) return res.status(400).json({ error: "to address required" });
    const receipt = await airdropRescue(to);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
