// Doctrines: folders of ship fits, each with a minimum to keep on market, and
// how many of each the citadel's book can supply right now — the page an FC
// checks before a fleet and a seeder checks before a Jita run.
//
// Fits are imported from EFT text and resolved against the SDE once, at
// import. Readiness is never stored: it's computed on every read from the
// live book, like the watchlist's statuses.
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { aggregateLines, parseEft } from '../../lib/eft.js';
import { resolveTypesByName } from '../../lib/sdeNames.js';
import { FIT_ROLES, combinedMissing, evaluateDoctrine, missingCost } from '../../lib/doctrineMath.js';
import { refreshReferencePrices } from '../../lib/referencePricePoller.js';
import { aggregateBook, referencePriceMap, resolveItemNames, resolveSource } from '../market/index.js';

// SDE category ids that decide how a pasted line counts.
const CATEGORY_SHIP = 6;
const CATEGORY_IMPLANT = 20; // implants and boosters
const CATEGORY_DRONE = 18;
const CATEGORY_FIGHTER = 87;

const MAX_EFT_LENGTH = 200_000;

function classify(line, type) {
  if (line.counted) return type.categoryId === CATEGORY_DRONE || type.categoryId === CATEGORY_FIGHTER ? 'drone' : 'cargo';
  // pyfa lists implants and boosters as bare lines after cargo; they're
  // optional kit, not part of the hull's fit.
  return type.categoryId === CATEGORY_IMPLANT ? 'cargo' : 'module';
}

/**
 * Parses EFT text and resolves every line against the SDE. Returns one entry
 * per fit found, each with its resolved items and the lines that didn't
 * resolve (`unmatched`) or resolved to something with no market (`skipped`,
 * e.g. a T3 destroyer's mode) — reported, never silently dropped.
 */
async function resolveFits(eft) {
  const text = String(eft || '');
  if (text.length > MAX_EFT_LENGTH) throw new HttpError(400, 'Paste is too large.');
  const parsed = parseEft(text);
  if (parsed.length === 0) {
    throw new HttpError(400, 'No fits found — each fit must start with a [Ship, Fit name] line.');
  }

  const names = parsed.flatMap((f) => [f.shipName, ...f.lines.map((l) => l.name)]);
  const types = await resolveTypesByName(names);

  return parsed.map((fit) => {
    const hull = types.get(fit.shipName.toLowerCase());
    const unmatched = [];
    const skipped = [];
    let error = null;
    if (!hull) error = `Unknown ship "${fit.shipName}"`;
    else if (hull.categoryId !== CATEGORY_SHIP) error = `"${fit.shipName}" is not a ship`;

    const merged = new Map();
    const add = (type, quantity, kind) => {
      const key = `${type.typeId}:${kind}`;
      const existing = merged.get(key);
      if (existing) existing.quantity += quantity;
      else merged.set(key, { typeId: type.typeId, name: type.name, quantity, kind });
    };
    if (!error) add(hull, 1, 'hull');

    for (const line of aggregateLines(fit.lines)) {
      const type = types.get(line.name.toLowerCase());
      if (!type) unmatched.push(line.name);
      else if (type.marketGroupId == null) skipped.push(line.name);
      else add(type, line.quantity, classify(line, type));
    }

    return {
      shipTypeId: hull?.typeId ?? null,
      shipName: hull?.name ?? fit.shipName,
      name: fit.fitName,
      eft: fit.eft,
      items: [...merged.values()],
      unmatched,
      skipped,
      error,
    };
  });
}

function primePrices(items) {
  const typeIds = [...new Set(items.map((i) => i.typeId))];
  if (typeIds.length === 0) return;
  refreshReferencePrices({ typeIds }).catch((err) =>
    console.error(`[doctrines] priming ${typeIds.length} types failed: ${err.message}`),
  );
}

function normalizeRole(role) {
  return FIT_ROLES.includes(role) ? role : 'main';
}

function normalizeMin(value, { nullable = false } = {}) {
  if (value == null || value === '') return nullable ? null : 0;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Minimum must be a whole number of zero or more.');
  return n;
}

const ROLE_ORDER = Object.fromEntries(FIT_ROLES.map((r, i) => [r, i]));

// ── Handlers ────────────────────────────────────────────────────────────

async function getDoctrines({ structureId } = {}) {
  const [doctrines, fits, source] = await Promise.all([
    prisma.doctrine.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.doctrineFit.findMany(),
    resolveSource(structureId),
  ]);

  const typeIds = [...new Set(fits.flatMap((f) => (Array.isArray(f.items) ? f.items.map((i) => Number(i.typeId)) : [])))];
  const [book, reference, names] = await Promise.all([
    source ? aggregateBook(source.structureId, typeIds) : new Map(),
    referencePriceMap(typeIds),
    resolveItemNames(typeIds),
  ]);
  const market = (typeId) => ({
    onMarket: book.get(typeId)?.sellVolume ?? 0,
    localPrice: book.get(typeId)?.bestSell ?? null,
    jitaPrice: reference.get(typeId)?.bestSell ?? null,
    name: names.get(typeId)?.name ?? null,
  });

  const fitsByDoctrine = new Map();
  for (const fit of fits) {
    if (!fitsByDoctrine.has(fit.doctrineId)) fitsByDoctrine.set(fit.doctrineId, []);
    fitsByDoctrine.get(fit.doctrineId).push(fit);
  }

  const allReadiness = [];
  const result = doctrines.map((doctrine) => {
    const own = (fitsByDoctrine.get(doctrine.id) ?? []).sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    );
    const readiness = evaluateDoctrine(doctrine, own, market);
    allReadiness.push(...readiness.fits.map((f) => f.readiness));
    return {
      id: doctrine.id,
      name: doctrine.name,
      description: doctrine.description,
      minQuantity: doctrine.minQuantity,
      sortOrder: doctrine.sortOrder,
      status: readiness.status,
      coverage: readiness.coverage,
      fitsTotal: readiness.fitsTotal,
      fitsReady: readiness.fitsReady,
      hullsFittable: readiness.hullsFittable,
      hullsNeeded: readiness.hullsNeeded,
      missing: readiness.missing,
      missingCostJita: readiness.missingCostJita,
      unpricedMissing: readiness.unpricedMissing,
      fits: readiness.fits.map(({ fit, readiness: r }) => ({
        id: fit.id,
        doctrineId: fit.doctrineId,
        name: fit.name,
        shipTypeId: fit.shipTypeId,
        shipName: names.get(fit.shipTypeId)?.name ?? fit.shipName,
        role: fit.role,
        minQuantity: fit.minQuantity,
        includeCargo: fit.includeCargo,
        eft: fit.eft,
        unmatched: Array.isArray(fit.unmatched) ? fit.unmatched : [],
        ...r,
      })),
    };
  });

  const counts = { out: 0, critical: 0, low: 0, ok: 0 };
  for (const d of result) if (d.status in counts) counts[d.status] += 1;

  // Every doctrine drawing on the same stock at once — the seeders' list.
  const allMissing = combinedMissing(allReadiness);

  return {
    doctrines: result,
    counts,
    allMissing,
    allMissingCostJita: missingCost(allMissing),
    source: source ? { id: source.id, structureId: source.structureId, name: source.name, lastPolledAt: source.lastPolledAt } : null,
  };
}

async function previewDoctrineFits({ eft } = {}) {
  return { fits: await resolveFits(eft) };
}

async function saveDoctrine({ id, name, description, minQuantity, sortOrder } = {}, req) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new HttpError(400, 'Doctrine name required');

  const data = {
    name: trimmed.slice(0, 120),
    description: description ? String(description).trim().slice(0, 2000) : null,
    minQuantity: normalizeMin(minQuantity),
    ...(sortOrder != null ? { sortOrder: Math.floor(Number(sortOrder)) || 0 } : {}),
  };

  const doctrine = id
    ? await prisma.doctrine.update({ where: { id }, data })
    : await prisma.doctrine.create({ data: { ...data, created_by: req?.user?.characterName ?? null } });
  return { doctrine };
}

async function deleteDoctrine({ id } = {}) {
  if (!id) throw new HttpError(400, 'id required');
  // No foreign keys (see the schema header), so the fits go explicitly.
  const [{ count }] = await prisma.$transaction([
    prisma.doctrineFit.deleteMany({ where: { doctrineId: id } }),
    prisma.doctrine.delete({ where: { id } }),
  ]);
  return { deleted: true, fitsDeleted: count };
}

async function importDoctrineFits({ doctrineId, eft, role, minQuantity } = {}, req) {
  if (!doctrineId) throw new HttpError(400, 'doctrineId required');
  const doctrine = await prisma.doctrine.findUnique({ where: { id: doctrineId } });
  if (!doctrine) throw new HttpError(404, 'Doctrine not found');

  const resolved = await resolveFits(eft);
  const usable = resolved.filter((f) => !f.error);
  if (usable.length === 0) throw new HttpError(400, resolved.map((f) => f.error).join('; '));

  const min = normalizeMin(minQuantity, { nullable: true });
  const created = await prisma.$transaction(
    usable.map((f) =>
      prisma.doctrineFit.create({
        data: {
          doctrineId,
          name: f.name.slice(0, 120),
          shipTypeId: f.shipTypeId,
          shipName: f.shipName,
          role: normalizeRole(role),
          minQuantity: min,
          eft: f.eft,
          items: f.items,
          unmatched: f.unmatched.length ? f.unmatched : undefined,
          created_by: req?.user?.characterName ?? null,
        },
      }),
    ),
  );

  primePrices(usable.flatMap((f) => f.items));
  return {
    created: created.length,
    failed: resolved.filter((f) => f.error).map((f) => ({ name: f.name, error: f.error })),
  };
}

async function updateDoctrineFit({ id, name, role, minQuantity, includeCargo, eft, doctrineId } = {}) {
  if (!id) throw new HttpError(400, 'id required');
  const data = {};
  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new HttpError(400, 'Fit name required');
    data.name = trimmed.slice(0, 120);
  }
  if (role !== undefined) data.role = normalizeRole(role);
  if (minQuantity !== undefined) data.minQuantity = normalizeMin(minQuantity, { nullable: true });
  if (includeCargo !== undefined) data.includeCargo = !!includeCargo;
  if (doctrineId !== undefined) {
    if (!(await prisma.doctrine.findUnique({ where: { id: doctrineId } }))) throw new HttpError(404, 'Doctrine not found');
    data.doctrineId = doctrineId;
  }

  // Re-pasting a fit replaces its contents but keeps its minimum and role,
  // so a doctrine update doesn't mean re-entering every number.
  if (eft !== undefined) {
    const resolved = await resolveFits(eft);
    if (resolved.length !== 1) throw new HttpError(400, 'Paste exactly one fit to replace this one.');
    const [f] = resolved;
    if (f.error) throw new HttpError(400, f.error);
    Object.assign(data, {
      shipTypeId: f.shipTypeId,
      shipName: f.shipName,
      eft: f.eft,
      items: f.items,
      unmatched: f.unmatched.length ? f.unmatched : null,
    });
    if (name === undefined) data.name = f.name.slice(0, 120);
    primePrices(f.items);
  }

  const fit = await prisma.doctrineFit.update({ where: { id }, data });
  return { fit };
}

async function deleteDoctrineFit({ id } = {}) {
  if (!id) throw new HttpError(400, 'id required');
  await prisma.doctrineFit.delete({ where: { id } });
  return { deleted: true };
}

export const doctrineHandlers = {
  getDoctrines: { fn: getDoctrines, auth: 'auth' },

  // Editing doctrines is admin-only, like the tracked list.
  previewDoctrineFits: { fn: previewDoctrineFits, auth: 'admin' },
  saveDoctrine: { fn: saveDoctrine, auth: 'admin' },
  deleteDoctrine: { fn: deleteDoctrine, auth: 'admin' },
  importDoctrineFits: { fn: importDoctrineFits, auth: 'admin' },
  updateDoctrineFit: { fn: updateDoctrineFit, auth: 'admin' },
  deleteDoctrineFit: { fn: deleteDoctrineFit, auth: 'admin' },
};
