import pool from "../pool";
import {
  contractSetWaveSchedule,
  contractTreasuryClose,
} from "./contract.service";
import { logger } from "../logger";

async function getRevealService() {
  const mod = await import("./reveal.service");
  return mod;
}

let running = false;

function withTxTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`TX timed out after ${ms}ms`)), ms)
    ),
  ]);
}

const hasContractEnv =
  () => !!(process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL && process.env.FIXED_PRIVATE_KEY);

// Mirrors the DB sync the manual treasury-close route performs after contractTreasuryClose.
async function syncTreasuryCloseDB(waveNum: number): Promise<void> {
  await pool.query(
    `UPDATE nft_records nr
        SET delivery_status_id = (SELECT id FROM lookup_values WHERE category = 'delivery_status' AND code = 'treasury_wallet'),
            delivered_at       = NOW(),
            updated_at         = NOW()
      WHERE nr.wave_id = (SELECT id FROM nft_waves WHERE wave_number = $1)
        AND nr.token_id IS NULL
        AND nr.delivery_status_id IN (
          SELECT id FROM lookup_values WHERE category = 'delivery_status' AND code IN ('pre_mint','reserved','treasury_pending','pool_assigned')
        )`,
    [waveNum],
  );
  await pool.query(
    `UPDATE nft_waves
        SET close_action          = 'treasury',
            treasury_minted_count = (
              SELECT COUNT(*) FROM nft_records nr2
                JOIN lookup_values lv ON lv.id = nr2.delivery_status_id
                WHERE nr2.wave_id = (SELECT id FROM nft_waves WHERE wave_number = $1)
                  AND lv.code IN ('treasury_wallet','transferred')
            ),
            updated_at = NOW()
      WHERE wave_number = $1`,
    [waveNum],
  );
}

async function checkAndTriggerWaves(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date().toISOString();

    const { rows: waves } = await pool.query<{
      id: string;
      wave_number: number;
      scheduled_start: string | null;
      scheduled_end: string | null;
      reveal_scheduled_at: string | null;
      wave_start_triggered: boolean;
      wave_end_triggered: boolean;
      wave_reveal_triggered: boolean;
      status: string;
      is_revealed: boolean;
      reveal_strategy: string;
      unsold_strategy: string;
    }>(
      `SELECT id, wave_number, scheduled_start, scheduled_end, reveal_scheduled_at,
              wave_start_triggered, wave_end_triggered, wave_reveal_triggered, status, is_revealed,
              reveal_strategy, unsold_strategy
         FROM nft_waves
        WHERE (
          (scheduled_start IS NOT NULL AND scheduled_start <= $1 AND wave_start_triggered = FALSE)
          OR (scheduled_end IS NOT NULL AND scheduled_end <= $1 AND wave_end_triggered = FALSE AND wave_start_triggered = TRUE)
          OR (reveal_scheduled_at IS NOT NULL AND reveal_scheduled_at <= $1 AND wave_reveal_triggered = FALSE AND wave_end_triggered = TRUE AND is_revealed = FALSE AND reveal_strategy = 'auto')
        )
        ORDER BY wave_number`,
      [now],
    );

    for (const wave of waves) {
      const num = wave.wave_number;

      // ── Wave start ────────────────────────────────────────────────────────────
      if (
        wave.scheduled_start &&
        new Date(wave.scheduled_start) <= new Date(now) &&
        !wave.wave_start_triggered
      ) {
        try {
          if (hasContractEnv()) {
            const startUnix = Math.floor(new Date(wave.scheduled_start).getTime() / 1000);
            const endUnix = wave.scheduled_end
              ? Math.floor(new Date(wave.scheduled_end).getTime() / 1000)
              : startUnix + 86400 * 30;
            await withTxTimeout(contractSetWaveSchedule(num, startUnix, endUnix));
          }
        } catch (e) {
          logger.warn(`[wave-auto-trigger] Wave ${num} on-chain start failed (will still mark triggered to prevent retry loops)`, e);
        }
        try {
          await pool.query(
            `UPDATE nft_waves SET wave_start_triggered = TRUE,
              status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'active' END,
              updated_at = NOW() WHERE wave_number = $1`,
            [num],
          );
          console.log(`[wave-auto-trigger] Wave ${num} started`);
        } catch (dbErr) {
          logger.warn(`[wave-auto-trigger] Wave ${num} DB mark-start failed`, dbErr);
        }
      }

      // ── Wave end ──────────────────────────────────────────────────────────────
      if (
        wave.scheduled_end &&
        new Date(wave.scheduled_end) <= new Date(now) &&
        wave.wave_start_triggered &&
        !wave.wave_end_triggered
      ) {
        try {
          await pool.query(
            `UPDATE nft_waves SET wave_end_triggered = TRUE, wave_closed = TRUE, status = 'closed', updated_at = NOW() WHERE wave_number = $1`,
            [num],
          );
          console.log(`[wave-auto-trigger] Wave ${num} closed in DB`);
        } catch (e) {
          logger.warn(`[wave-auto-trigger] Wave ${num} DB mark-end failed`, e);
        }

        // Auto-treasury: set on-chain schedule with near-future endTime, then close to treasury.
        // setWaveSchedule requires endTime > block.timestamp (cannot be past), so we use now+90s.
        // contractTreasuryClose is then called after 95s when the on-chain window has passed.
        // For 0-minted waves the contract skips the reveal requirement (noSales = true).
        if (wave.unsold_strategy === 'auto_treasury' && hasContractEnv()) {
          const startUnix = wave.scheduled_start
            ? Math.floor(new Date(wave.scheduled_start).getTime() / 1000)
            : Math.floor(Date.now() / 1000) - 86400;
          const endUnix = Math.floor(Date.now() / 1000) + 90;
          try {
            await withTxTimeout(contractSetWaveSchedule(num, startUnix, endUnix));
            logger.info(`[wave-auto-trigger] Wave ${num} on-chain schedule set (endTime+90s) for auto-treasury`);
            setTimeout(async () => {
              try {
                await withTxTimeout(contractTreasuryClose(num, null), 30_000);
                logger.info(`[wave-auto-trigger] Wave ${num} auto-treasury close executed`);
                await syncTreasuryCloseDB(num);
              } catch (e) {
                logger.warn(`[wave-auto-trigger] Wave ${num} auto-treasury close failed (retry manually via UI)`, e);
              }
            }, 95_000);
          } catch (e) {
            logger.warn(`[wave-auto-trigger] Wave ${num} auto-treasury schedule failed`, e);
          }
        }
      }

      // ── Auto-reveal ───────────────────────────────────────────────────────────
      // Skipped entirely when reveal_strategy = 'manual' — admin triggers via UI
      if (
        wave.reveal_scheduled_at &&
        new Date(wave.reveal_scheduled_at) <= new Date(now) &&
        wave.wave_end_triggered &&
        !wave.wave_reveal_triggered &&
        !wave.is_revealed &&
        wave.reveal_strategy !== 'manual'
      ) {
        try {
          const revealSvc = await getRevealService();
          await revealSvc.executeWaveReveal(num);
          await pool.query(
            `UPDATE nft_waves SET wave_reveal_triggered = TRUE, updated_at = NOW() WHERE wave_number = $1`,
            [num],
          );
          console.log(`[wave-auto-trigger] Wave ${num} reveal executed`);

          // After auto-reveal, trigger auto-treasury close for waves with customer mints.
          // (0-minted waves are handled in wave-end above without needing reveal first.)
          if (wave.unsold_strategy === 'auto_treasury' && hasContractEnv()) {
            try {
              await withTxTimeout(contractTreasuryClose(num, null), 30_000);
              logger.info(`[wave-auto-trigger] Wave ${num} auto-treasury close executed after reveal`);
              await syncTreasuryCloseDB(num);
            } catch (e) {
              logger.warn(`[wave-auto-trigger] Wave ${num} auto-treasury close after reveal failed (retry manually via UI)`, e);
            }
          }
        } catch (e) {
          logger.warn(`[wave-auto-trigger] Wave ${num} reveal failed`, e);
        }
      }
    }
  } finally {
    running = false;
  }
}

export function startWaveAutoTrigger(): void {
  if (!process.env.CONTRACT_ADDRESS) {
    console.log("[wave-auto-trigger] CONTRACT_ADDRESS not set — auto-trigger disabled");
    return;
  }
  console.log("[wave-auto-trigger] Auto-trigger scheduler started (30s interval)");
  setTimeout(() => checkAndTriggerWaves().catch(e => logger.warn("[wave-auto-trigger] tick error", e)), 10_000);
  setInterval(() => checkAndTriggerWaves().catch(e => logger.warn("[wave-auto-trigger] tick error", e)), 30_000);
}
