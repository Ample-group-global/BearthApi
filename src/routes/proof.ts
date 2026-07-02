import { Router } from "express";
import pool from "../db";
import { buildMerkleTree, getProof } from "../merkle";

const router = Router();
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

router.get("/", async (req, res, next) => {
  const { address } = req.query;
  if (!address || !ETH_ADDRESS_RE.test(address as string)) {
    res.status(400).json({ detail: "Invalid or missing address parameter" });
    return;
  }
  try {
    const { rows } = await pool.query("SELECT * FROM whitelist_addresses_all()");
    const addresses = rows.map((r: { address: string }) => r.address);
    const tree = buildMerkleTree(addresses);
    const isWhitelisted = addresses.some(a => a.toLowerCase() === (address as string).toLowerCase());
    const proof = isWhitelisted ? getProof(tree, address as string) : [];
    res.json({ proof, root: tree.root, is_whitelisted: isWhitelisted });
  } catch (e) { next(e); }
});

export default router;
