// Name → type resolution against the SDE, shared by the Tracked page's bulk
// paste and the Doctrines fit import.
import { prisma } from '../db/prisma.js';

export function flattenType(row) {
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

/**
 * Resolves names to types, case-insensitively and exactly — deliberately not
 * fuzzy, because silently matching the wrong item is worse than reporting a
 * line as unmatched. Returns a Map keyed by lower-cased name; each type also
 * carries its `categoryId` (ship, module, drone, charge…) from its group.
 */
export async function resolveTypesByName(names) {
  const lowered = [...new Set(names.map((n) => String(n).trim().toLowerCase()).filter(Boolean))];
  if (lowered.length === 0) return new Map();

  const rows = await prisma.$queryRaw`
    SELECT t."key", t."data", g."data"->>'categoryID' AS category_id
    FROM "SdeRecord" t
    LEFT JOIN "SdeRecord" g ON g."dataset" = 'groups' AND g."key" = t."data"->>'groupID'
    WHERE t."dataset" = 'types'
      AND lower(t."data"->'name'->>'en') = ANY(${lowered}::text[])
  `;

  // Names aren't unique in the SDE: unpublished test hulls and non-market
  // duplicates share them with the real item. Prefer the published market
  // type, or the caller ends up with a copy that has no market and never prices.
  const rank = (t) => (t.published ? 2 : 0) + (t.marketGroupId != null ? 1 : 0);
  const byLowerName = new Map();
  for (const r of rows) {
    const t = { ...flattenType(r), categoryId: r.category_id != null ? Number(r.category_id) : null };
    const key = String(t.name ?? '').toLowerCase();
    const current = byLowerName.get(key);
    if (!current || rank(t) > rank(current)) byLowerName.set(key, t);
  }
  return byLowerName;
}
