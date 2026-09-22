// SDE read + admin refresh endpoints.
//
// Reads go through raw SQL against the JSONB payload rather than Prisma's
// query builder: the name searches rely on the partial trigram index, which
// Prisma can't express, and projecting a couple of fields out of `data` is
// far cheaper than hydrating whole records.
import express from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { getSdeStatus, isIngestInProgress } from '../../lib/sdeIngest.js';
import { getLastCheck, runSdeCheck } from '../../lib/sdeScheduler.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

const router = express.Router();

function flatten(row) {
  return {
    key: row.key,
    typeId: Number(row.key),
    name: row.data?.name?.en ?? null,
    groupId: row.data?.groupID ?? null,
    marketGroupId: row.data?.marketGroupID ?? null,
    volume: row.data?.volume ?? null,
    published: row.data?.published ?? null,
  };
}

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [status, lastCheck] = await Promise.all([getSdeStatus(), getLastCheck()]);
    res.json({ data: { ...status, lastCheck } });
  }),
);

router.post(
  '/refresh',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (isIngestInProgress()) throw new HttpError(409, 'An SDE ingest is already running.');
    // Kicked off without awaiting: a full ingest takes minutes and would time
    // out the request. The Settings page polls /status for progress.
    runSdeCheck({ trigger: 'manual' }).catch(() => {});
    res.json({ data: { started: true } });
  }),
);

// Type-ahead for the watchlist editor. Restricted to published market items
// so the results aren't full of unpublished test hulls and skins.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    if (q.length < 2) return res.json({ data: { results: [] } });

    const rows = await prisma.$queryRaw`
      SELECT "key", "data" FROM "SdeRecord"
      WHERE "dataset" = 'types'
        AND ("data"->'name'->>'en') ILIKE ${`%${q}%`}
        AND ("data"->>'published')::boolean IS TRUE
        AND ("data"->'marketGroupID') IS NOT NULL
      ORDER BY length("data"->'name'->>'en'), ("data"->'name'->>'en')
      LIMIT ${limit}
    `;
    res.json({ data: { results: rows.map(flatten) } });
  }),
);

// Resolves a list of names to type ids in one round trip — the bulk-paste
// path on the Tracked page. Matching is case-insensitive and exact;
// deliberately not fuzzy, because silently tracking the wrong item is worse
// than reporting a line as unmatched.
router.post(
  '/resolve-names',
  asyncHandler(async (req, res) => {
    const names = Array.isArray(req.body?.names) ? req.body.names : [];
    if (names.length === 0) return res.json({ data: { matched: [], unmatched: [] } });
    if (names.length > 1000) throw new HttpError(400, 'Too many names in one request (max 1000).');

    const lowered = names.map((n) => String(n).trim().toLowerCase()).filter(Boolean);
    const rows = await prisma.$queryRaw`
      SELECT "key", "data" FROM "SdeRecord"
      WHERE "dataset" = 'types'
        AND lower("data"->'name'->>'en') = ANY(${lowered}::text[])
    `;

    // Names aren't unique in the SDE: unpublished test hulls and non-market
    // duplicates share them with the real item. Prefer the published market
    // type, or the paste tracks a copy that has no market and never prices.
    const rank = (t) => (t.published ? 2 : 0) + (t.marketGroupId != null ? 1 : 0);
    const byLowerName = new Map();
    for (const r of rows) {
      const t = flatten(r);
      const key = String(t.name ?? '').toLowerCase();
      const current = byLowerName.get(key);
      if (!current || rank(t) > rank(current)) byLowerName.set(key, t);
    }
    const matched = [];
    const unmatched = [];
    for (const name of names) {
      const hit = byLowerName.get(String(name).trim().toLowerCase());
      if (hit) matched.push(hit);
      else unmatched.push(name);
    }
    res.json({ data: { matched, unmatched } });
  }),
);

router.get(
  '/lookup/:typeId',
  asyncHandler(async (req, res) => {
    const row = await prisma.sdeRecord.findUnique({
      where: { dataset_key: { dataset: 'types', key: String(req.params.typeId) } },
    });
    if (!row) throw new HttpError(404, 'Unknown type id');
    res.json({ data: flatten(row) });
  }),
);

export default router;
