// Settings: managing the polled market source(s), the first-run wizard, and
// the status readouts for the SDE and Jita pollers.
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { esiFetch } from '../../lib/esiClient.js';
import { ensureFreshToken } from '../../lib/eveSso.js';
import { getSdeStatus } from '../../lib/sdeIngest.js';
import { getLastCheck, runSdeCheck } from '../../lib/sdeScheduler.js';
import { runReferenceRefresh } from '../../lib/referencePricePoller.js';

async function listMarketSources() {
  const sources = await prisma.marketSource.findMany({ orderBy: [{ isPrimary: 'desc' }, { created_date: 'asc' }] });
  return { sources };
}

async function saveMarketSource(body = {}) {
  const {
    id,
    structureId,
    name,
    readerCharacterId,
    readerCharacterName,
    enabled,
    isPrimary,
    pollIntervalMinutes,
    retentionDays,
  } = body;

  if (!id && !structureId) throw new HttpError(400, 'structureId required');

  const data = {
    ...(name !== undefined ? { name: name || null } : {}),
    ...(readerCharacterId !== undefined ? { readerCharacterId: readerCharacterId || null } : {}),
    ...(readerCharacterName !== undefined ? { readerCharacterName: readerCharacterName || null } : {}),
    ...(enabled !== undefined ? { enabled: !!enabled } : {}),
    ...(pollIntervalMinutes !== undefined
      ? // One minute is the tick resolution; anything lower just polls every
        // tick and burns ESI budget for no extra fidelity.
        { pollIntervalMinutes: Math.max(1, Number(pollIntervalMinutes) || 15) }
      : {}),
    ...(retentionDays !== undefined ? { retentionDays: Math.max(1, Number(retentionDays) || 180) } : {}),
  };

  const source = id
    ? await prisma.marketSource.update({ where: { id }, data })
    : await prisma.marketSource.create({
        data: { structureId: String(structureId), sourceType: 'structure', ...data },
      });

  // Exactly one source is primary: it's what every page defaults to when no
  // structure is named.
  if (isPrimary) {
    await prisma.marketSource.updateMany({ where: { id: { not: source.id } }, data: { isPrimary: false } });
    await prisma.marketSource.update({ where: { id: source.id }, data: { isPrimary: true } });
  }

  return { source: await prisma.marketSource.findUnique({ where: { id: source.id } }) };
}

async function deleteMarketSource({ id } = {}) {
  if (!id) throw new HttpError(400, 'id required');
  const source = await prisma.marketSource.findUnique({ where: { id } });
  if (!source) throw new HttpError(404, 'Market source not found');

  // Market data is keyed by structureId, not by this row's id, so removing
  // the source alone would orphan every order, event and stat it collected.
  // Cleared explicitly and in one transaction so a half-deleted source can't
  // be left behind. The archive goes too: keeping order history for a
  // structure nothing references any more serves no one.
  await prisma.$transaction([
    prisma.marketOrder.deleteMany({ where: { structureId: source.structureId } }),
    prisma.marketOrderEvent.deleteMany({ where: { structureId: source.structureId } }),
    prisma.marketOrderArchive.deleteMany({ where: { structureId: source.structureId } }),
    prisma.marketDailyStat.deleteMany({ where: { structureId: source.structureId } }),
    prisma.marketSnapshot.deleteMany({ where: { structureId: source.structureId } }),
    prisma.marketWatchItem.deleteMany({ where: { structureId: source.structureId } }),
    prisma.marketSource.delete({ where: { id } }),
  ]);

  return { success: true };
}

// Structure search for the first-run wizard, so nobody has to hunt for a
// 13-digit id by hand. Uses the searching character's own token — the search
// endpoint only returns structures that character can actually dock at, which
// is exactly the constraint that matters for a reader.
async function searchStructures({ search } = {}, req) {
  const term = String(search || '').trim();
  if (term.length < 3) return { results: [] };
  if (!req?.user?.characterId) throw new HttpError(401, 'Authentication required');

  const character = await prisma.eveCharacter.findUnique({ where: { characterId: req.user.characterId } });
  if (!character?.accessToken) throw new HttpError(400, 'This character has no stored EVE token — sign in again.');

  const fresh = await ensureFreshToken(character, (id, patch) =>
    prisma.eveCharacter.update({ where: { id }, data: patch }),
  );

  const result = await esiFetch(`/characters/${character.characterId}/search/`, {
    token: fresh.accessToken,
    params: { categories: 'structure', search: term, strict: false },
  });

  const ids = (result?.structure || []).slice(0, 20);
  const results = [];
  for (const id of ids) {
    const info = await esiFetch(`/universe/structures/${id}/`, { token: fresh.accessToken }).catch(() => null);
    if (info) results.push({ structureId: String(id), name: info.name, systemId: info.solar_system_id });
  }
  return { results };
}

// Everything the Settings page shows in one call, so it renders in one paint
// rather than four staggered ones.
async function getSystemStatus() {
  const [sdeStatus, lastCheck, sources, referenceCount, latestReference, fuzzworkCount, esiCount] = await Promise.all([
    getSdeStatus(),
    getLastCheck(),
    prisma.marketSource.findMany({ orderBy: [{ isPrimary: 'desc' }] }),
    prisma.referencePrice.count(),
    prisma.referencePrice.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
    prisma.referencePrice.count({ where: { source: 'fuzzwork' } }),
    prisma.referencePrice.count({ where: { source: 'esi' } }),
  ]);

  return {
    sde: { ...sdeStatus, lastCheck },
    sources,
    jita: {
      priceCount: referenceCount,
      lastFetchedAt: latestReference?.fetchedAt ?? null,
      bySource: { fuzzwork: fuzzworkCount, esi: esiCount },
      configuredSource: process.env.JITA_PRICE_SOURCE || 'fuzzwork',
    },
    env: {
      // Reported so an operator can see whether the source came from the
      // environment or was created through the wizard.
      structureIdConfigured: !!String(process.env.MARKET_STRUCTURE_ID || '').trim(),
      readerConfigured: !!String(process.env.MARKET_READER_CHARACTER || '').trim(),
      sdeIntervalHours: Number(process.env.SDE_CHECK_INTERVAL_HOURS ?? 12),
    },
  };
}

async function refreshSde() {
  return runSdeCheck({ trigger: 'manual' });
}

async function refreshJitaPrices() {
  return runReferenceRefresh();
}

export const settingsHandlers = {
  listMarketSources: { fn: listMarketSources, auth: 'auth' },
  getSystemStatus: { fn: getSystemStatus, auth: 'auth' },
  saveMarketSource: { fn: saveMarketSource, auth: 'admin' },
  deleteMarketSource: { fn: deleteMarketSource, auth: 'admin' },
  searchStructures: { fn: searchStructures, auth: 'admin' },
  refreshSde: { fn: refreshSde, auth: 'admin' },
  refreshJitaPrices: { fn: refreshJitaPrices, auth: 'admin' },
};
