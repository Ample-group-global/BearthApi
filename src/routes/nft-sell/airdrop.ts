import { Router } from "express";
import { requireAdmin } from "../../adminAuth";
import { requireRegisteredWallets } from "../../services/customer-whitelist.service";
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

router.get("/quote", async (req, res, next) => {
  try {
    const recipientCount = parseInt(req.query.recipientCount as string, 10);
    const amountEachEth = req.query.amountEachEth as string;
    if (!recipientCount || !amountEachEth)
      return res.status(400).json({ error: "recipientCount and amountEachEth required" });
    const quote = await airdropQuoteEqual(recipientCount, amountEachEth);
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.post("/eth/equal", requireAdmin, async (req, res, next) => {
  try {
    const { recipients, amountEachEth } = req.body as {
      recipients: string[]; amountEachEth: string;
    };
    if (!Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "recipients array required" });
    if (!amountEachEth)
      return res.status(400).json({ error: "amountEachEth required (ETH string, e.g. '0.01')" });

    await requireRegisteredWallets(recipients);
    const receipt = await airdropETHEqual(recipients, amountEachEth);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

router.post("/eth/skip-failed", requireAdmin, async (req, res, next) => {
  try {
    const { recipients, amountEachEth } = req.body as {
      recipients: string[]; amountEachEth: string;
    };
    if (!Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "recipients array required" });
    if (!amountEachEth)
      return res.status(400).json({ error: "amountEachEth required" });

    await requireRegisteredWallets(recipients);
    const receipt = await airdropETHSkipFailed(recipients, amountEachEth);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

router.post("/eth/variable", requireAdmin, async (req, res, next) => {
  try {
    const { recipients, amountsEth } = req.body as {
      recipients: string[]; amountsEth: string[];
    };
    if (!Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "recipients array required" });
    if (!Array.isArray(amountsEth) || amountsEth.length !== recipients.length)
      return res.status(400).json({ error: "amountsEth must be same length as recipients" });

    await requireRegisteredWallets(recipients);
    const receipt = await airdropETHVariable(recipients, amountsEth);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});
router.post("/erc20/equal", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, recipients, amountEachWei } = req.body as {
      tokenAddress: string; recipients: string[]; amountEachWei: string;
    };
    if (!tokenAddress || !Array.isArray(recipients) || !recipients.length || !amountEachWei)
      return res.status(400).json({ error: "tokenAddress, recipients[], amountEachWei required" });

    await requireRegisteredWallets(recipients);
    const receipt = await airdropERC20Equal(tokenAddress, recipients, amountEachWei);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});

router.post("/erc20/variable", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, recipients, amountsWei } = req.body as {
      tokenAddress: string; recipients: string[]; amountsWei: string[];
    };
    if (!tokenAddress || !Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "tokenAddress, recipients[], amountsWei[] required" });
    if (!Array.isArray(amountsWei) || amountsWei.length !== recipients.length)
      return res.status(400).json({ error: "amountsWei must be same length as recipients" });

    await requireRegisteredWallets(recipients);
    const receipt = await airdropERC20Variable(tokenAddress, recipients, amountsWei);
    res.json({ ok: true, txHash: receipt.hash, recipientCount: recipients.length });
  } catch (err) {
    next(err);
  }
});
router.post("/nft", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, recipients, tokenIds } = req.body as {
      tokenAddress: string; recipients: string[]; tokenIds: number[];
    };
    if (!tokenAddress || !Array.isArray(recipients) || !recipients.length)
      return res.status(400).json({ error: "tokenAddress, recipients[], tokenIds[] required" });
    if (!Array.isArray(tokenIds) || tokenIds.length !== recipients.length)
      return res.status(400).json({ error: "tokenIds must be same length as recipients" });

    await requireRegisteredWallets(recipients);
    const receipt = await airdropERC721(tokenAddress, recipients, tokenIds);
    res.json({ ok: true, txHash: receipt.hash, count: recipients.length });
  } catch (err) {
    next(err);
  }
});
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
