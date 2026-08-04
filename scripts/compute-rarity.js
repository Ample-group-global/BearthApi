/**
 * Rarity Score + Rank computation for the Bearth NFT collection.
 *
 * Algorithm (industry standard — Rarity Score method):
 *   For each NFT: score = Σ (total_supply / count_of_NFTs_sharing_this_trait_value)
 *   Higher score = rarer. Rank 1 = rarest.
 *
 * Tier thresholds (by rank percentile):
 *   Legendary : top 1%   (rank 1 – 100)
 *   Epic      : next 4%  (rank 101 – 500)
 *   Rare      : next 15% (rank 501 – 2000)
 *   Common    : rest     (rank 2001 – 9999)
 *
 * Run: node scripts/compute-rarity.js
 */

const { Pool } = require("pg");

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:idkniaxoQBYItcwPzEaXgIvnSWaSdKIy@reseau.proxy.rlwy.net:55600/BearthDev";

const TIER_THRESHOLDS = [
  { tier: "legendary", maxRank: 100 },
  { tier: "epic",      maxRank: 500 },
  { tier: "rare",      maxRank: 2000 },
  { tier: "common",    maxRank: Infinity },
];

function getTier(rank) {
  for (const t of TIER_THRESHOLDS) {
    if (rank <= t.maxRank) return t.tier;
  }
  return "common";
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  console.log("Connecting to DB…");

  // 1. Load ALL NFTs with traits (needed for accurate frequency map across full collection)
  const { rows } = await pool.query(
    "SELECT id, serial_number, traits, is_revealed FROM nft_records WHERE traits IS NOT NULL ORDER BY serial_number"
  );
  const total = rows.length;
  console.log(`Loaded ${total} NFTs with traits.`);

  // 2. Build trait frequency map: { "TraitType::TraitValue" -> count }
  const freq = new Map();
  for (const nft of rows) {
    for (const [traitType, traitValue] of Object.entries(nft.traits || {})) {
      const key = `${traitType}::${traitValue}`;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  console.log(`Trait combinations indexed: ${freq.size}`);

  // 3. Compute rarity score for each NFT
  const scored = rows.map((nft) => {
    let score = 0;
    for (const [traitType, traitValue] of Object.entries(nft.traits || {})) {
      const key = `${traitType}::${traitValue}`;
      const count = freq.get(key) ?? 1;
      score += total / count;
    }
    return { id: nft.id, serialNumber: nft.serial_number, score };
  });

  // 4. Sort descending by score → assign rank (1 = rarest)
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((nft, i) => { nft.rank = i + 1; });

  // 5. Log top 10 and bottom 5 as sanity check
  console.log("\nTop 10 rarest:");
  scored.slice(0, 10).forEach(n =>
    console.log(`  Rank ${n.rank}  ${n.serialNumber}  score=${n.score.toFixed(2)}  tier=${getTier(n.rank)}`)
  );
  console.log("\nBottom 5 (most common):");
  scored.slice(-5).forEach(n =>
    console.log(`  Rank ${n.rank}  ${n.serialNumber}  score=${n.score.toFixed(2)}  tier=${getTier(n.rank)}`)
  );

  // 6. Clear rarity data from all unrevealed NFTs first
  const { rowCount: cleared } = await pool.query(
    `UPDATE nft_records SET rarity_score = NULL, rarity_rank = NULL, rarity_tier = NULL, updated_at = NOW()
     WHERE is_revealed = false AND (rarity_score IS NOT NULL OR rarity_rank IS NOT NULL OR rarity_tier IS NOT NULL)`
  );
  console.log(`\nCleared rarity from ${cleared} unrevealed NFTs.`);

  // 7. Batch-update ONLY revealed NFTs with scores + ranks + tiers (in chunks of 500)
  const revealedScored = scored.filter(n => rows.find(r => r.id === n.id)?.is_revealed);
  console.log(`Writing scores + ranks + tiers to ${revealedScored.length} revealed NFT(s)…`);
  const CHUNK = 500;
  let updated = 0;
  for (let i = 0; i < revealedScored.length; i += CHUNK) {
    const chunk = revealedScored.slice(i, i + CHUNK);
    const values = chunk
      .map((n, j) => `($${j * 3 + 1}::uuid, $${j * 3 + 2}::numeric, $${j * 3 + 3}::int)`)
      .join(", ");
    const params = chunk.flatMap(n => [n.id, n.score, n.rank]);
    await pool.query(
      `UPDATE nft_records AS nr
       SET rarity_score = v.score,
           rarity_rank  = v.rank,
           rarity_tier  = CASE
             WHEN v.rank <= 100  THEN 'legendary'
             WHEN v.rank <= 500  THEN 'epic'
             WHEN v.rank <= 2000 THEN 'rare'
             ELSE 'common'
           END,
           updated_at = NOW()
       FROM (VALUES ${values}) AS v(id, score, rank)
       WHERE nr.id = v.id AND nr.is_revealed = true`,
      params
    );
    updated += chunk.length;
    process.stdout.write(`\r  ${updated}/${revealedScored.length} revealed updated…`);
  }

  // 8. Verify tier distribution (revealed only)
  const { rows: dist } = await pool.query(
    `SELECT rarity_tier, COUNT(*) AS count
     FROM nft_records
     WHERE is_revealed = true
     GROUP BY rarity_tier
     ORDER BY COUNT(*) ASC`
  );
  console.log("\n\nTier distribution (revealed NFTs only):");
  dist.forEach(r => console.log(`  ${r.rarity_tier}: ${r.count}`));

  const { rows: nullCheck } = await pool.query(
    `SELECT COUNT(*) AS unrevealed_with_rarity FROM nft_records WHERE is_revealed = false AND rarity_score IS NOT NULL`
  );
  console.log(`\nUnrevealed NFTs with rarity data (should be 0): ${nullCheck[0].unrevealed_with_rarity}`);

  console.log("\nDone.");
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
