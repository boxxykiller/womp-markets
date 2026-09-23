// The corporation/alliance allowlist, as edited from the Settings page.
//
// The environment lists (ALLOWED_CORPORATION_IDS / ALLOWED_ALLIANCE_IDS) stay
// in force and are unioned with what's stored here. That way an existing
// deploy keeps working unchanged, and nobody can lock the environment-level
// entries out from the UI.
import { prisma } from '../db/prisma.js';
import { parseIdList } from './eveSso.js';

const SETTING_KEY = 'auth.accessPolicy';

function normalizeEntries(list) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const id = String(entry?.id ?? '').trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: entry?.name ? String(entry.name) : null });
  }
  return out;
}

/** The UI-managed entries only: `{ corporations: [{id, name}], alliances: [...] }`. */
export async function getStoredPolicy() {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  return {
    corporations: normalizeEntries(row?.value?.corporations),
    alliances: normalizeEntries(row?.value?.alliances),
  };
}

export async function saveStoredPolicy({ corporations, alliances }) {
  const value = { corporations: normalizeEntries(corporations), alliances: normalizeEntries(alliances) };
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value },
    update: { value },
  });
  return value;
}

/** Stored and environment ids combined — what the login check actually enforces. */
export async function getEffectiveAllowlist(stored) {
  const policy = stored ?? (await getStoredPolicy());
  const envCorps = parseIdList(process.env.ALLOWED_CORPORATION_IDS);
  const envAlliances = parseIdList(process.env.ALLOWED_ALLIANCE_IDS);
  return {
    allowedCorporationIds: [...new Set([...envCorps, ...policy.corporations.map((c) => c.id)])],
    allowedAllianceIds: [...new Set([...envAlliances, ...policy.alliances.map((a) => a.id)])],
    envCorporationIds: envCorps,
    envAllianceIds: envAlliances,
  };
}
