// Keeps the SDE current without anyone having to remember to press a button.
// The sister project only ever refreshes from an admin click, which means its
// item names silently drift behind CCP's releases; this checks on a timer.
//
// A check is cheap — one request for latest.jsonl — and only downloads the
// ~1GB release when the build number has actually moved, so a frequent
// interval costs almost nothing.
import { prisma } from '../db/prisma.js';
import { checkAndIngest } from './sdeIngest.js';

const SETTING_KEY = 'sde.lastCheck';

// Delayed rather than immediate so a boot-time check doesn't compete with the
// first market poll for the database on a cold start.
const BOOT_DELAY_MS = 60 * 1000;

let intervalTimer = null;
let bootTimer = null;

export async function recordCheck(result) {
  await prisma.appSetting
    .upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: result },
      update: { value: result },
    })
    .catch((err) => console.error('[sde] failed to record check result:', err.message));
}

export async function getLastCheck() {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  return row?.value ?? null;
}

// Exported so the admin "Check for update" button runs exactly this path,
// including the bookkeeping — one code path, no drift between the two.
export async function runSdeCheck({ trigger = 'scheduler' } = {}) {
  const startedAt = new Date().toISOString();
  try {
    const result = await checkAndIngest();
    const record = { ...result, trigger, startedAt, finishedAt: new Date().toISOString(), ok: true };
    await recordCheck(record);
    if (result.updated) console.log(`[sde] updated to build ${result.buildNumber}`);
    return record;
  } catch (err) {
    const record = { ok: false, trigger, startedAt, finishedAt: new Date().toISOString(), error: err.message };
    await recordCheck(record);
    console.error('[sde] check failed:', err.message);
    return record;
  }
}

export function startSdeScheduler() {
  const hours = Number(process.env.SDE_CHECK_INTERVAL_HOURS ?? 12);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log('[sde] scheduler disabled (SDE_CHECK_INTERVAL_HOURS is 0 or unset)');
    return;
  }
  if (intervalTimer) return;

  bootTimer = setTimeout(() => {
    runSdeCheck({ trigger: 'boot' }).catch(() => {});
  }, BOOT_DELAY_MS);

  intervalTimer = setInterval(
    () => {
      runSdeCheck({ trigger: 'scheduler' }).catch(() => {});
    },
    hours * 60 * 60 * 1000,
  );

  console.log(`[sde] scheduler started — checking every ${hours}h`);
}

export function stopSdeScheduler() {
  if (bootTimer) clearTimeout(bootTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  bootTimer = null;
  intervalTimer = null;
}
