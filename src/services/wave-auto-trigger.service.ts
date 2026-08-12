import pool from "../pool";
import {
  contractSetWaveSchedule,
} from "./contract.service";
import { logger } from "../logger";

async function getRevealService() {
  const mod = await import("./reveal.service");
  return mod;
}

let running = false;

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
    }>(
      `SELECT id, wave_number, scheduled_start, scheduled_end, reveal_scheduled_at,
              wave_start_triggered, wave_end_triggered, wave_reveal_triggered, status, is_revealed,
              reveal_strategy
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

      // Auto-start: push schedule on-chain and mark active
      if (
        wave.scheduled_start &&
        new Date(wave.scheduled_start) <= new Date(now) &&
        !wave.wave_start_triggered
      ) {
        try {
          if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL && process.env.FIXED_PRIVATE_KEY) {
            const startUnix = Math.floor(new Date(wave.scheduled_start).getTime() / 1000);
            const endUnix = wave.scheduled_end
              ? Math.floor(new Date(wave.scheduled_end).getTime() / 1000)
              : startUnix + 86400 * 30; // 30-day fallback if no end set
            await contractSetWaveSchedule(num, startUnix, endUnix);
          }
        } catch (e) {
          logger.warn(`[wave-auto-trigger] Wave ${num} on-chain start failed (will still mark triggered to prevent retry loops)`, e);
        }
        // Always mark triggered regardless of TX outcome — prevents infinite retry loops
        // Respect 'paused' — if admin paused the wave, keep that status; only set 'active' otherwise
        try {
          await pool.query(
            `UPDATE nft_waves SET wave_start_triggered = TRUE,
              status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'active' END,
              updated_at = NOW() WHERE wave_number = $1`,
            [num],
          );
          console.log(`[wave-auto-trigger] Wave ${num} started (status=${wave.status === 'paused' ? 'paused' : 'active'})`);
        } catch (dbErr) {
          logger.warn(`[wave-auto-trigger] Wave ${num} DB mark failed`, dbErr);
        }
      }

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
          console.log(`[wave-auto-trigger] Wave ${num} closed`);
        } catch (e) {
          logger.warn(`[wave-auto-trigger] Wave ${num} end failed`, e);
        }
      }

      // Auto-reveal: random shuffle + on-chain reveal
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
  // Initial check after 10s — give the server time to settle after start
  setTimeout(() => checkAndTriggerWaves().catch(e => logger.warn("[wave-auto-trigger] tick error", e)), 10_000);
  setInterval(() => checkAndTriggerWaves().catch(e => logger.warn("[wave-auto-trigger] tick error", e)), 30_000);
}
