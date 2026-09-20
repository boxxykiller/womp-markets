// EVE SSO protocol layer: authorize URL, code exchange, refresh, and the
// corporation/alliance allowlist that decides who may use this instance.
import { esiFetch } from './esiClient.js';

const EVE_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const EVE_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';

// Refresh this far ahead of expiry so a long request can't start with a
// token that expires mid-flight.
export const REFRESH_BUFFER_SECONDS = 300;

// Only what this app actually does. The sister project requests 32 scopes
// because it also does industry, mining and wallets; asking for more than is
// needed makes the consent screen alarming and the token more dangerous to
// leak.
export const EVE_SCOPES = [
  'publicData',
  // Read the citadel's order book. The whole app depends on this one.
  'esi-markets.structure_markets.v1',
  // Resolve a structure's name, system and region.
  'esi-universe.read_structures.v1',
  // Let the Settings wizard search for a structure by name.
  'esi-search.search_structures.v1',
];

function credentialsHeader() {
  const clientId = process.env.EVE_CLIENT_ID;
  const clientSecret = process.env.EVE_CLIENT_SECRET;
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

export function buildAuthorizeUrl(state, scopes = EVE_SCOPES) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.EVE_CLIENT_ID,
    redirect_uri: process.env.EVE_REDIRECT_URI,
    scope: scopes.join(' '),
    state,
  });
  return `${EVE_AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  return fetch(EVE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentialsHeader()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // CCP's token endpoint requires an explicit Host header.
      Host: 'login.eveonline.com',
    },
    body: new URLSearchParams(body),
  });
}

export async function exchangeCodeForTokens(code) {
  const res = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.EVE_REDIRECT_URI,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EVE token exchange failed: ${text}`);
  }
  return res.json();
}

// Returns null rather than throwing: most callers treat a failed refresh as
// "skip this character this cycle", not as a fatal error.
export async function refreshTokens(refreshToken) {
  const res = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!res.ok) return null;
  return res.json();
}

// Decodes the character out of an access token without verifying it. Safe
// here because the token came straight from CCP over TLS in the code
// exchange we just made — this is parsing our own response, not trusting a
// token handed to us by a client.
export function decodeCharacterFromAccessToken(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    return {
      characterId: payload.sub?.split(':')[2] || null,
      characterName: payload.name || null,
    };
  } catch {
    return { characterId: null, characterName: null };
  }
}

// Ensures a character's access token is valid, refreshing and persisting via
// updateFn first if it is close to expiry. Returns the (possibly refreshed)
// record.
export async function ensureFreshToken(character, updateFn) {
  const expiresAt = character.expiresAt ? new Date(character.expiresAt).getTime() : 0;
  if (expiresAt - Date.now() > REFRESH_BUFFER_SECONDS * 1000) return character;
  if (!character.refreshToken) return character;

  const refreshed = await refreshTokens(character.refreshToken);
  if (!refreshed) return character;

  const patch = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || character.refreshToken,
    tokenType: refreshed.token_type,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    lastRefreshAt: new Date(),
  };
  await updateFn(character.id, patch);
  return { ...character, ...patch };
}

// ── Allowlist ───────────────────────────────────────────────────────────

export function parseIdList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseNameList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Decides whether a character may use this instance.
 *
 * With both lists empty every character is allowed — that keeps a fresh
 * clone usable before anything is configured. It is called out in
 * .env.example because it is wide open, and the Settings page shows the
 * effective policy so an unconfigured production deploy is visible rather
 * than silent.
 */
export function isAffiliationAllowed(affiliation, { allowedCorporationIds, allowedAllianceIds } = {}) {
  const corps = allowedCorporationIds ?? parseIdList(process.env.ALLOWED_CORPORATION_IDS);
  const alliances = allowedAllianceIds ?? parseIdList(process.env.ALLOWED_ALLIANCE_IDS);

  if (corps.length === 0 && alliances.length === 0) return true;
  if (affiliation?.corporationId && corps.includes(String(affiliation.corporationId))) return true;
  if (affiliation?.allianceId && alliances.includes(String(affiliation.allianceId))) return true;
  return false;
}

export function isAdminCharacter(characterName, adminNames) {
  const names = adminNames ?? parseNameList(process.env.ADMIN_CHARACTER_NAMES);
  return names.includes(String(characterName || '').toLowerCase());
}

// Resolves a character's corporation and alliance from public ESI. The
// alliance lookup is skipped for a corporation with no alliance, which is the
// common case for one-person corps.
export async function fetchAffiliation(characterId) {
  const char = await esiFetch(`/characters/${characterId}/`);
  const corporationId = char?.corporation_id ? String(char.corporation_id) : null;

  let corporationName = null;
  let allianceId = null;
  let allianceName = null;

  if (corporationId) {
    const corp = await esiFetch(`/corporations/${corporationId}/`).catch(() => null);
    corporationName = corp?.name || null;
    allianceId = corp?.alliance_id ? String(corp.alliance_id) : null;
    if (allianceId) {
      const alliance = await esiFetch(`/alliances/${allianceId}/`).catch(() => null);
      allianceName = alliance?.name || null;
    }
  }

  return { corporationId, corporationName, allianceId, allianceName };
}
