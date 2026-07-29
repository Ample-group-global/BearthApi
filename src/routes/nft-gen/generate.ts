import { Router }             from "express";
import { randomUUID }          from "crypto";
import path                    from "path";
import fs                      from "fs";
import { requirePermission }   from "../../adminAuth";
import pool                    from "../../pool";
import * as svc                from "../../services/nft-gen.service";

const router = Router();

// ── In-memory progress map ────────────────────────────────────────────────────

interface GenerateState {
  status:   'running' | 'done' | 'error';
  phase:    string;
  progress: number;
  total:    number;
  jobId?:   string;
  error?:   string;
}
const generateJobs = new Map<string, GenerateState>();

// ── POST /  start server-side generation ──────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft_gen.generate");
    const { collectionId, editionSize } = req.body ?? {};
    if (!collectionId)        { res.status(422).json({ error: "collectionId is required." }); return; }
    if (!editionSize || Number(editionSize) < 1) { res.status(422).json({ error: "editionSize must be >= 1." }); return; }

    // Generate reads layers+traits from DB and builds combinations in memory.
    // PNG files are only needed during Export (compositing) — not here.
    const layersDir = svc.getLocalLayersDir(); // used only for optional weights/conflicts json files

    const generateId = randomUUID();
    generateJobs.set(generateId, { status: "running", phase: "Loading layers…", progress: 0, total: Number(editionSize) });

    const createdBy: string | null = (req as any).user?.userId ?? null;
    runGenerate(generateId, String(collectionId), Number(editionSize), layersDir, createdBy)
      .catch(err => {
        const s = generateJobs.get(generateId);
        if (s) { s.status = "error"; s.error = String(err?.message ?? err); }
        console.error("[generate]", err);
      });

    res.status(202).json({ generateId });
  } catch (e) { next(e); }
});

// ── GET /:generateId  poll progress ──────────────────────────────────────────

router.get("/:generateId", (req, res) => {
  const state = generateJobs.get(req.params.generateId);
  if (!state) { res.status(404).json({ error: "Generate job not found." }); return; }
  res.json(state);
});

// ── Combo algorithm (ported from BearthAdmin/lib/studio/combos.ts) ────────────

type Asset = { stem: string; name: string; rel: string | null; defaultWeight: number };
type Layer = { folder: string; label: string; bypassDna: boolean; rarityPct: number; assets: Asset[] };
type ConflictRule = { type?: string; ifLayer: string; ifTrait: string; thenLayer: string; thenTraits: string[] };

function pickWeighted(assets: Asset[], ws: Record<string, number>): Asset | null {
  const pool = assets.filter(a => (ws[a.stem] ?? a.defaultWeight) > 0);
  if (!pool.length) return null;
  const tot = pool.reduce((s, a) => s + (ws[a.stem] ?? a.defaultWeight), 0);
  let r = Math.random() * tot;
  for (const a of pool) {
    r -= ws[a.stem] ?? a.defaultWeight;
    if (r <= 0) return a;
  }
  return pool[pool.length - 1];
}

function resolveConflicts(picks: Record<string, Asset | null>, rules: ConflictRule[], weights: Record<string, Record<string, number>>, layers: Layer[]) {
  if (!rules.length) return;
  const layerMap = Object.fromEntries(layers.map(l => [l.folder, l]));
  const expanded: ConflictRule[] = [];
  for (const rule of rules) {
    if ((rule.type ?? "exclude") === "exclude") {
      for (const t of rule.thenTraits) {
        const reverseExists = rules.some(r =>
          (r.type ?? "exclude") === "exclude" &&
          r.ifLayer === rule.thenLayer && r.ifTrait === t &&
          r.thenLayer === rule.ifLayer && r.thenTraits.includes(rule.ifTrait)
        );
        if (!reverseExists) expanded.push({ type: "exclude", ifLayer: rule.thenLayer, ifTrait: t, thenLayer: rule.ifLayer, thenTraits: [rule.ifTrait] });
      }
    }
  }
  const allRules = [...rules, ...expanded];

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const rule of allRules) {
      if (picks[rule.ifLayer]?.stem !== rule.ifTrait) continue;
      const thenLayer = layerMap[rule.thenLayer];
      if (!thenLayer) continue;
      const ws = weights[rule.thenLayer] ?? {};
      if ((rule.type ?? "exclude") === "exclude") {
        if (!rule.thenTraits.includes(picks[rule.thenLayer]?.stem ?? "")) continue;
        const valid = thenLayer.assets.filter(a => !rule.thenTraits.includes(a.stem) && (ws[a.stem] ?? a.defaultWeight) > 0);
        const fallback = valid.length ? valid : thenLayer.assets.filter(a => (ws[a.stem] ?? a.defaultWeight) > 0);
        if (fallback.length) { picks[rule.thenLayer] = pickWeighted(fallback, ws); changed = true; }
      } else {
        if (rule.thenTraits.includes(picks[rule.thenLayer]?.stem ?? "")) continue;
        const valid = thenLayer.assets.filter(a => rule.thenTraits.includes(a.stem) && (ws[a.stem] ?? a.defaultWeight) > 0);
        if (valid.length) { picks[rule.thenLayer] = pickWeighted(valid, ws); changed = true; }
      }
    }
    if (!changed) break;
  }
}

function generateAllCombos(supply: number, layers: Layer[], weights: Record<string, Record<string, number>>, conflicts: ConflictRule[]): Record<string, Asset | null>[] {
  const seen = new Set<string>();
  return Array.from({ length: supply }, () => {
    let picks: Record<string, Asset | null> = {};
    for (let attempt = 0; attempt < 200; attempt++) {
      picks = {};
      for (const layer of layers) {
        if (layer.rarityPct < 100 && Math.random() * 100 >= layer.rarityPct) {
          picks[layer.folder] = null;
          continue;
        }
        const ws = weights[layer.folder] ?? {};
        picks[layer.folder] = pickWeighted(layer.assets, ws);
      }
      resolveConflicts(picks, conflicts, weights, layers);
      const key = layers.filter(l => !l.bypassDna).map(l => picks[l.folder]?.stem ?? "").join("|");
      if (!seen.has(key)) { seen.add(key); break; }
    }
    return picks;
  });
}

type RarityTier = "Legendary" | "Epic" | "Rare" | "Common";
type ScoredItem = { index: number; score: number; rank: number; tier: RarityTier; attrs: { trait_type: string; value: string }[]; dnaHash: string };

function computeRarity(combos: Record<string, Asset | null>[], layers: Layer[]): ScoredItem[] {
  const supply = combos.length;
  const traitCounts: Record<string, number> = {};
  for (const combo of combos) {
    for (const layer of layers) {
      const pick = combo[layer.folder];
      if (!pick) continue;
      const key = `${layer.label}\x00${pick.name}`;
      traitCounts[key] = (traitCounts[key] ?? 0) + 1;
    }
  }
  const scored = combos.map((combo, i) => {
    let score = 0;
    const attrs: { trait_type: string; value: string }[] = [];
    for (const layer of layers) {
      const pick = combo[layer.folder];
      if (!pick) continue;
      const key = `${layer.label}\x00${pick.name}`;
      score += supply / (traitCounts[key] ?? 1);
      attrs.push({ trait_type: layer.label, value: pick.name });
    }
    const dnaHash = layers.filter(l => !l.bypassDna).map(l => combo[l.folder]?.stem ?? "").join("|");
    return { index: i + 1, score: Math.round(score * 100) / 100, attrs, rank: 0, tier: "Common" as RarityTier, dnaHash };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  scored.forEach((item, i) => { item.rank = i + 1; });
  for (const item of scored) {
    if      (item.rank <= Math.ceil(supply * 0.01)) item.tier = "Legendary";
    else if (item.rank <= Math.ceil(supply * 0.05)) item.tier = "Epic";
    else if (item.rank <= Math.ceil(supply * 0.15)) item.tier = "Rare";
  }
  return scored;
}

// ── Background worker ─────────────────────────────────────────────────────────

const BATCH_SIZE  = 500;
const BATCH_CONCUR = 5;

async function runGenerate(generateId: string, collectionId: string, editionSize: number, layersDir: string, createdBy: string | null) {
  const state = generateJobs.get(generateId)!;

  // 1. Load layers from DB
  const { rows: layerRows } = await pool.query(
    "SELECT * FROM nft_gen_layers_list($1::uuid)", [collectionId]
  );
  const activeLayers = layerRows
    .filter((l: any) => l.is_active)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  if (!activeLayers.length) throw new Error("No active layers found for this collection.");

  // 2. Load traits
  const layerIds = activeLayers.map((l: any) => l.id);
  const { rows: traitRows } = await pool.query(
    "SELECT * FROM nft_traits WHERE layer_id = ANY($1::uuid[]) AND is_active = true",
    [layerIds]
  );

  // 3. Read weights + conflicts from filesystem
  const weightsPath   = path.join(layersDir, ".weights.json");
  const conflictsPath = path.join(layersDir, ".conflicts.json");
  const weights: Record<string, Record<string, number>> =
    fs.existsSync(weightsPath)   ? JSON.parse(fs.readFileSync(weightsPath,   "utf8")) : {};
  const conflicts: ConflictRule[] =
    fs.existsSync(conflictsPath) ? JSON.parse(fs.readFileSync(conflictsPath, "utf8")) : [];

  // 4. Build layer structure
  const layers: Layer[] = activeLayers.map((l: any) => {
    const layerTraits = traitRows.filter((t: any) => t.layer_id === l.id);
    return {
      folder:    l.name,
      label:     l.display_name,
      bypassDna: l.bypass_dna ?? false,
      rarityPct: l.layer_rarity_pct ?? 100,
      assets: layerTraits.map((t: any) => ({
        stem:          path.basename(t.file_path, path.extname(t.file_path)),
        name:          t.name,
        rel:           t.file_path,
        defaultWeight: Number(t.rarity_weight ?? 1),
      })),
    };
  });

  state.phase = "Generating combinations…";

  // 5. Run combo + rarity algorithm
  const combos = generateAllCombos(editionSize, layers, weights, conflicts);
  state.phase = "Computing rarity…";
  const scored = computeRarity(combos, layers);

  state.phase = "Creating job in database…";

  // 6. Create + start job
  const jobData = await svc.createJob({ collectionId, editionSize, createdBy: createdBy ?? undefined });
  const jobId     = jobData?.id ?? jobData;
  if (!jobId) throw new Error("Failed to create generation job in DB.");
  await svc.startJob(String(jobId));
  state.jobId = String(jobId);

  // 7. Batch-save items with concurrency
  state.phase = "Saving to database…";
  const allChunks: ScoredItem[][] = [];
  for (let i = 0; i < scored.length; i += BATCH_SIZE) allChunks.push(scored.slice(i, i + BATCH_SIZE));

  let done = 0;
  for (let g = 0; g < allChunks.length; g += BATCH_CONCUR) {
    const group = allChunks.slice(g, g + BATCH_CONCUR);
    await Promise.all(group.map(chunk =>
      svc.insertItemsBatch({
        jobId: String(jobId),
        items: chunk.map(item => ({
          editionNumber: item.index,
          dnaHash: item.dnaHash,
          score: item.score,
          rank:  item.rank,
          tier:  item.tier,
          traits: item.attrs.map(a => ({ traitType: a.trait_type, traitValue: a.value })),
        })),
      })
    ));
    done += group.reduce((s, c) => s + c.length, 0);
    state.progress = done;
    state.phase    = `Saving to database… ${done} / ${editionSize}`;
  }

  // 8. Complete job
  await svc.completeJob(String(jobId));
  state.status = "done";
  state.phase  = `Complete — ${editionSize} NFTs generated`;
}

export default router;
