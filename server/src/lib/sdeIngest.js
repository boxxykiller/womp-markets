// Downloads and ingests CCP's EVE Online Static Data Export (SDE) into the
// generic SdeRecord table.
// See https://developers.eveonline.com/docs/services/static-data/#automation
//
// Most of the defensive shape of this file is carried over from the sister
// project, where each workaround was added in response to a real production
// hang. They are documented individually below; none of them are speculative.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import pg from 'pg';
import unzipper from 'unzipper';
import { prisma } from '../db/prisma.js';

const SDE_BASE = 'https://developers.eveonline.com/static-data/tranquility';
const BATCH_SIZE = 500;

// The repeated delete-then-bulk-insert cycle (once per dataset, ~100 times a
// build) goes through the plain `pg` driver rather than Prisma's query
// engine. In production, Prisma's engine was observed to leave the Postgres
// connection genuinely idle (confirmed via pg_stat_activity: state=idle,
// wait_event=ClientRead — i.e. the server had already answered) while the
// Node side never continued: no error, 0% CPU, indefinitely. `pg` is pure JS
// and has none of that native-binding surface.
let pool = null;
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// A build ingests hundreds of thousands of rows over several minutes — long
// enough for a transient hiccup to hit at least one batch. Each attempt is
// raced against a timeout because a connection that silently stalls (rather
// than erroring) would otherwise hang the promise forever.
async function withRetry(fn, { attempts = 4, baseDelayMs = 2000, timeoutMs = 90_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB call timed out')), timeoutMs)),
      ]);
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

async function fetchLatestBuild() {
  const res = await fetch(`${SDE_BASE}/latest.jsonl`);
  if (!res.ok) throw new Error(`SDE latest.jsonl fetch failed: ${res.status}`);
  const line = (await res.text()).trim().split('\n')[0];
  const record = JSON.parse(line);
  return { buildNumber: record.buildNumber, releaseDate: new Date(record.releaseDate) };
}

async function getStoredBuild() {
  return prisma.sdeMeta.findFirst({ orderBy: { buildNumber: 'desc' } });
}

async function downloadZip(buildNumber) {
  const url = `${SDE_BASE}/eve-online-static-data-${buildNumber}-jsonl.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SDE zip download failed: ${res.status} ${url}`);

  const tmpPath = path.join(os.tmpdir(), `eve-sde-${buildNumber}.zip`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    Readable.fromWeb(res.body).pipe(out).on('finish', resolve).on('error', reject);
  });
  return tmpPath;
}

// Extracts every entry to plain files up front rather than reading zip
// entries as streams one at a time. Repeated random-access reads against one
// open zip handle (unzipper's per-entry .stream()) were observed to stall
// partway through a release in production — 0% CPU, no error. A one-shot
// extract takes the zip library out of the per-dataset read path entirely.
async function extractZip(zipPath, buildNumber) {
  const destDir = path.join(os.tmpdir(), `eve-sde-${buildNumber}-extracted`);
  await fs.promises.rm(destDir, { recursive: true, force: true });
  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: destDir })).promise();
  return destDir;
}

// A few datasets (missions.jsonl confirmed) contain localized text with
// literal, unescaped newlines instead of \n escapes, which breaks a naive
// "one JSON object per line" split. Lines are accumulated until they parse,
// with a size cap so genuinely malformed input fails loudly instead of
// buffering to EOF.
const MAX_PENDING_CHARS = 5_000_000;

// Reads one dataset fully into memory rather than streaming it line by line.
// The largest file in a release (mapMoons) is ~220MB uncompressed, which is
// fine to hold, and doing so removes the readline/stream lifecycle from the
// per-dataset loop — an earlier streaming version stopped dead partway
// through a release with the database side confirmed idle.
async function ingestFile(filePath, dataset) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const db = getPool();

  await withRetry(() => db.query('DELETE FROM "SdeRecord" WHERE dataset = $1', [dataset]));

  let batch = [];
  let count = 0;
  let pending = '';

  const flush = async () => {
    if (batch.length === 0) return;
    const toInsert = batch;
    batch = [];

    const values = [];
    const rows = toInsert.map((row, i) => {
      const base = i * 4;
      values.push(crypto.randomUUID(), row.dataset, row.key, row.data);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    const sql = `INSERT INTO "SdeRecord" (id, dataset, key, data) VALUES ${rows.join(', ')}
      ON CONFLICT (dataset, key) DO NOTHING`;
    await withRetry(() => db.query(sql, values.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v))));
    count += toInsert.length;
  };

  for (const line of content.split('\n')) {
    if (!pending && !line.trim()) continue;
    pending = pending ? `${pending}\n${line}` : line;

    let record;
    try {
      record = JSON.parse(pending);
    } catch {
      if (pending.length > MAX_PENDING_CHARS) {
        throw new Error(`[sde] ${dataset}: unparseable JSONL after ${pending.length} chars`);
      }
      continue;
    }
    pending = '';

    const { _key, ...data } = record;
    batch.push({ dataset, key: String(_key), data });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  return count;
}

async function ingestBuild(buildNumber, releaseDate) {
  console.log(`[sde] downloading build ${buildNumber}...`);
  const zipPath = await downloadZip(buildNumber);

  const datasetCounts = {};
  let extractDir;
  try {
    console.log(`[sde] extracting build ${buildNumber}...`);
    extractDir = await extractZip(zipPath, buildNumber);

    console.log(`[sde] ingesting build ${buildNumber}...`);
    const entries = await fs.promises.readdir(extractDir);
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const dataset = name.replace(/\.jsonl$/, '');
      try {
        datasetCounts[dataset] = await ingestFile(path.join(extractDir, name), dataset);
      } catch (err) {
        // One unparseable dataset must not abort the other ~100.
        console.error(`[sde] skipping dataset "${dataset}": ${err.message}`);
        datasetCounts[dataset] = { error: err.message };
      }
    }

    await prisma.sdeMeta.create({ data: { buildNumber, releaseDate, datasetCounts } });

    const rowTotal = Object.values(datasetCounts).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    const failed = Object.entries(datasetCounts)
      .filter(([, v]) => typeof v !== 'number')
      .map(([k]) => k);
    console.log(
      `[sde] build ${buildNumber} ingested: ${Object.keys(datasetCounts).length} datasets, ${rowTotal} rows` +
        (failed.length ? `, failed: ${failed.join(', ')}` : ''),
    );
  } finally {
    fs.unlink(zipPath, () => {});
    if (extractDir) fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }

  return { buildNumber, datasetCounts };
}

let ingestInProgress = false;

// Compares the latest published build to what's stored and ingests if newer.
// Guarded against overlapping runs so the scheduler and the admin "check now"
// button can't collide.
export async function checkAndIngest() {
  if (ingestInProgress) return { skipped: true, reason: 'already running' };
  ingestInProgress = true;
  try {
    const [latest, stored] = await Promise.all([fetchLatestBuild(), getStoredBuild()]);
    if (stored && stored.buildNumber === latest.buildNumber) {
      return { updated: false, buildNumber: latest.buildNumber };
    }
    await ingestBuild(latest.buildNumber, latest.releaseDate);
    return { updated: true, buildNumber: latest.buildNumber };
  } finally {
    ingestInProgress = false;
  }
}

export function isIngestInProgress() {
  return ingestInProgress;
}

export async function getSdeStatus() {
  const meta = await getStoredBuild();
  return { meta, ingestInProgress };
}
