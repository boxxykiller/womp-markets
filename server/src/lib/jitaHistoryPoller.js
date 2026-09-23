// Keeps Jita daily history for every type traded in The Forge, forever.
//
// ESI publishes regional history (GET /markets/{region}/history/?type_id=N)
// but only for about the last 13 months, and only one type per request. So
// once a day this sweeps every type with orders in The Forge, stores whatever
// days aren't stored yet, and the table grows into a permanent record that
// outlives ESI's window.
//
// The numbers are The Forge region, not the 4-4 station alone — that is all
// CCP publishes. Jita dominates the region's volume, so in practice the two
// are close.
//
// A full sweep is ~15k requests, so it is paced (JITA_HISTORY_REQUESTS_PER_MINUTE)
// and resumable: each type's fetch time is recorded, and a type already
// fetched since ESI's daily update is skipped. A restart mid-sweep picks up
// where it stopped.
import { prisma } from '../db/prisma.js';
import { esiFetch, esiFetchPaged, mapWithConcurrency } from './esiClient.js';
import { THE_FORGE_REGION_ID } from './referencePricePoller.js';

const SETTING_KEY = 'jitaHistory.lastRun';
const DAY_MS = 86400000;

// ESI's market history rolls over once a day after downtime (11:00 UTC). Half
// an hour of slack so a sweep doesn't start against yesterday's cache.
const REFRESH_HOUR_UTC = 11;
const REFRESH_MINUTE_UTC = 30;

const CONCURRENCY = 4;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BOOT_DELAY_MS = 2 * 60 * 1000;
// Consecutive failures that end a sweep early — ESI is down or limiting us,
// and carrying on would only spend the error budget.
const MAX_CONSECUTIVE_FAILURES = 25;
// Progress is written to AppSetting this often, for the Settings page.
const PROGRESS_EVERY = 250;

let running = false;
let intervalTimer = null;
let bootTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function requestsPerMinute() {
  const n = Number(process.env.JITA_HISTORY_REQUESTS_PER_MINUTE ?? 200);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The most recent moment ESI's history has been refreshed, as of `now`. */
export function latestEsiRefresh(now = new Date()) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), REFRESH_HOUR_UTC, REFRESH_MINUTE_UTC),
  );
  return now >= today ? today : new Date(today.getTime() - DAY_MS);
}

/**
 * ESI history entries -> ReferenceDailyStat rows, keeping only days after
 * `afterDate` (the last day already stored). Past days never change once
 * published, so there is nothing to gain by rewriting them.
 */
export function parseHistory(typeId, entries, afterDate = null, fetchedAt = new Date()) {
  const rows = [];
  for (const e of entries || []) {
    if (!e?.date) continue;
    const date = new Date(`${e.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;
    if (afterDate && date <= afterDate) continue;
    rows.push({
      typeId: Number(typeId),
      date,
      average: e.average ?? null,
      highest: e.highest ?? null,
      lowest: e.lowest ?? null,
      volume: Number(e.volume) || 0,
      orderCount: Number(e.order_count) || 0,
      fetchedAt,
    });
  }
  return rows;
}

async function readLastRun() {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  return row?.value ?? null;
}

async function writeLastRun(value) {
  await prisma.appSetting
    .upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } })
    .catch((err) => console.error('[jita-history] failed to record status:', err.message));
}

export async function getJitaHistoryStatus() {
  const [lastRun, stats] = await Promise.all([
    readLastRun(),
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS rows, COUNT(DISTINCT "typeId")::int AS types,
             MIN("date") AS first_date, MAX("date") AS last_date
      FROM "ReferenceDailyStat"
    `,
  ]);
  const s = stats[0] ?? {};
  return {
    running,
    lastRun,
    rows: s.rows ?? 0,
    types: s.types ?? 0,
    firstDate: s.first_date ?? null,
    lastDate: s.last_date ?? null,
    requestsPerMinute: requestsPerMinute(),
  };
}

// Tracked and citadel-listed types go first, so the items this app actually
// shows are covered early in a first sweep that takes over an hour.
async function collectTypeIds() {
  const [regionTypes, watched, listed] = await Promise.all([
    esiFetchPaged(`/markets/${THE_FORGE_REGION_ID}/types/`),
    prisma.marketWatchItem.findMany({ select: { typeId: true } }),
    prisma.marketOrder.findMany({ select: { typeId: true }, distinct: ['typeId'] }),
  ]);
  return [
    ...new Set([...watched.map((w) => w.typeId), ...listed.map((l) => l.typeId), ...regionTypes.map(Number)]),
  ].filter((id) => Number.isInteger(id) && id > 0);
}

// Spaces request *starts* evenly, shared across every worker, so concurrency
// hides latency without raising the rate.
function makePacer(perMinute) {
  const gap = 60000 / perMinute;
  let next = Date.now();
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

function backoffMs(err) {
  const h = err?.headers;
  const retryAfter = Number(h?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(h?.get?.('x-esi-error-limit-reset'));
  if (Number.isFinite(reset) && reset > 0) return (reset + 1) * 1000;
  return 60_000;
}

/**
 * One sweep. Never throws; returns (and records) a summary. `force` ignores
 * the per-type freshness check and re-requests everything.
 */
export async function runJitaHistorySweep({ trigger = 'scheduler', force = false } = {}) {
  if (running) return { skipped: true, reason: 'already running' };
  const perMinute = requestsPerMinute();
  if (!perMinute) return { skipped: true, reason: 'disabled (JITA_HISTORY_REQUESTS_PER_MINUTE is 0)' };
  running = true;

  const startedAt = new Date();
  const refreshedAt = latestEsiRefresh(startedAt);
  const summary = {
    trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    ok: false,
    total: 0,
    due: 0,
    done: 0,
    inserted: 0,
    empty: 0,
    failed: 0,
    error: null,
  };

  try {
    const typeIds = await collectTypeIds();
    const fetches = await prisma.referenceHistoryFetch.findMany();
    const fetchMap = new Map(fetches.map((f) => [f.typeId, f]));
    const due = force ? typeIds : typeIds.filter((id) => !(fetchMap.get(id)?.fetchedAt >= refreshedAt));

    summary.total = typeIds.length;
    summary.due = due.length;
    await writeLastRun({ ...summary, running: true });
    console.log(`[jita-history] sweep started: ${due.length} of ${typeIds.length} types due at ${perMinute}/min`);

    const pace = makePacer(perMinute);
    let consecutiveFailures = 0;
    let aborted = false;

    await mapWithConcurrency(due, CONCURRENCY, async (typeId) => {
      if (aborted) return;
      let entries = null;
      let isEmpty = false;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await pace();
        try {
          entries = await esiFetch(`/markets/${THE_FORGE_REGION_ID}/history/`, { params: { type_id: typeId } });
          break;
        } catch (err) {
          if (err.status === 404 || err.status === 400) {
            // Not a market type, or no history in the region: an answer.
            isEmpty = true;
            break;
          }
          if (err.status === 420 || err.status === 429) {
            const wait = backoffMs(err);
            console.warn(`[jita-history] ESI limited (${err.status}); pausing ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
          }
          if (attempt === 2) {
            summary.failed += 1;
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              aborted = true;
              summary.error = `Stopped after ${consecutiveFailures} consecutive failures: ${err.message}`;
            }
            return;
          }
          await sleep(2000 * (attempt + 1));
        }
      }
      if (entries == null && !isEmpty) {
        summary.failed += 1;
        return;
      }
      consecutiveFailures = 0;

      const prev = fetchMap.get(typeId);
      const fetchedAt = new Date();
      const rows = isEmpty ? [] : parseHistory(typeId, entries, prev?.lastDate ?? null, fetchedAt);
      if (rows.length === 0 && !isEmpty && (entries?.length ?? 0) === 0) isEmpty = true;

      const lastDate = rows.reduce((max, r) => (max && max > r.date ? max : r.date), prev?.lastDate ?? null);
      try {
        await prisma.$transaction([
          ...(rows.length ? [prisma.referenceDailyStat.createMany({ data: rows, skipDuplicates: true })] : []),
          prisma.referenceHistoryFetch.upsert({
            where: { typeId },
            create: { typeId, fetchedAt, lastDate, empty: isEmpty },
            update: { fetchedAt, lastDate, empty: isEmpty },
          }),
        ]);
      } catch (err) {
        summary.failed += 1;
        console.error(`[jita-history] store failed for type ${typeId}: ${err.message}`);
        return;
      }

      summary.inserted += rows.length;
      if (isEmpty) summary.empty += 1;
      summary.done += 1;
      if (summary.done % PROGRESS_EVERY === 0) await writeLastRun({ ...summary, running: true });
    });

    summary.ok = !aborted;
  } catch (err) {
    summary.error = err.message;
  } finally {
    summary.finishedAt = new Date().toISOString();
    running = false;
    await writeLastRun({ ...summary, running: false });
    console.log(
      `[jita-history] sweep ${summary.ok ? 'finished' : 'stopped'}: ${summary.done}/${summary.due} types, ` +
        `${summary.inserted} days stored, ${summary.failed} failed${summary.error ? ` — ${summary.error}` : ''}`,
    );
  }
  return summary;
}

// Hourly check, but a sweep only starts once ESI has refreshed since the last
// one finished cleanly — so it runs once a day, and retries within the day if
// a sweep was cut short.
async function tick() {
  const last = await readLastRun();
  const refreshedAt = latestEsiRefresh();
  if (last?.ok && last.finishedAt && new Date(last.finishedAt) >= refreshedAt) return;
  await runJitaHistorySweep({ trigger: 'scheduler' });
}

export function startJitaHistoryPoller() {
  if (!requestsPerMinute()) {
    console.log('[jita-history] disabled (JITA_HISTORY_REQUESTS_PER_MINUTE is 0)');
    return;
  }
  if (intervalTimer) return;
  bootTimer = setTimeout(() => tick().catch(() => {}), BOOT_DELAY_MS);
  intervalTimer = setInterval(() => tick().catch(() => {}), CHECK_INTERVAL_MS);
  console.log(`[jita-history] poller started — ${requestsPerMinute()} requests/min`);
}

export function stopJitaHistoryPoller() {
  if (bootTimer) clearTimeout(bootTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  bootTimer = null;
  intervalTimer = null;
}
