// EVE SSO login and callback, plus the character-management handlers.
import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import {
  EVE_SCOPES,
  buildAuthorizeUrl,
  decodeCharacterFromAccessToken,
  exchangeCodeForTokens,
  fetchAffiliation,
  isAdminCharacter,
  isAffiliationAllowed,
  parseIdList,
} from '../../lib/eveSso.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions, signSession } from '../../lib/session.js';

const STATE_TTL_MS = 10 * 60 * 1000;

// Opportunistic sweep of abandoned logins. Cheap enough to run on each login
// and avoids needing a separate timer for a table that stays tiny.
async function sweepExpiredStates() {
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}

async function eveLogin(body = {}, req) {
  if (!process.env.EVE_CLIENT_ID || !process.env.EVE_REDIRECT_URI) {
    throw new HttpError(500, 'EVE SSO is not configured on this server.');
  }
  await sweepExpiredStates();

  const mode = body.mode === 'link' ? 'link' : 'login';
  // Linking an alt must be driven by a server-verified session, never by a
  // client-supplied owner key — otherwise anyone could attach their character
  // to someone else's group.
  if (mode === 'link' && !req.user) {
    throw new HttpError(401, 'Sign in before linking another character.');
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  await prisma.oAuthState.create({
    data: {
      nonce,
      mode,
      ownerKey: mode === 'link' ? req.user.ownerKey : null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  return { authUrl: buildAuthorizeUrl(nonce) };
}

async function eveCallback(body = {}, req, res) {
  const { code, state } = body;
  if (!code || !state) throw new HttpError(400, 'Missing code or state');

  const pending = await prisma.oAuthState.findUnique({ where: { nonce: state } });
  if (!pending) throw new HttpError(400, 'This sign-in link has already been used or is not valid.');

  // Consume the state before doing anything else — a replayed callback must
  // not be able to mint a second session.
  await prisma.oAuthState.delete({ where: { id: pending.id } }).catch(() => {});
  if (pending.expiresAt < new Date()) throw new HttpError(400, 'This sign-in took too long. Please try again.');

  const tokens = await exchangeCodeForTokens(code);
  const { characterId, characterName } = decodeCharacterFromAccessToken(tokens.access_token);
  if (!characterId) throw new HttpError(502, 'EVE did not return a usable character token.');

  const affiliation = await fetchAffiliation(characterId).catch(() => ({
    corporationId: null,
    corporationName: null,
    allianceId: null,
    allianceName: null,
  }));

  const existing = await prisma.eveCharacter.findUnique({ where: { characterId } });
  if (existing?.banned) throw new HttpError(403, 'This character has been blocked from this application.');

  if (!isAffiliationAllowed(affiliation)) {
    // Recorded anyway (inactive, no session) so an admin can see who tried
    // and allow them without asking them to log in blind a second time.
    await prisma.eveCharacter.upsert({
      where: { characterId },
      create: {
        characterId,
        characterName: characterName || characterId,
        ownerKey: characterId,
        ...affiliation,
        affiliationCheckedAt: new Date(),
        active: false,
      },
      update: { ...affiliation, affiliationCheckedAt: new Date(), active: false },
    });
    throw new HttpError(403, 'NOT_ALLOWED');
  }

  const isAdmin = isAdminCharacter(characterName);
  // Linking keeps the existing group; a fresh character starts its own group
  // keyed on its own id.
  const ownerKey = pending.mode === 'link' && pending.ownerKey ? pending.ownerKey : existing?.ownerKey || characterId;

  const tokenData = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    scopes: EVE_SCOPES.join(' '),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    lastRefreshAt: new Date(),
    lastLoginAt: new Date(),
    active: true,
    ...affiliation,
    affiliationCheckedAt: new Date(),
  };

  const character = await prisma.eveCharacter.upsert({
    where: { characterId },
    create: {
      characterId,
      characterName: characterName || characterId,
      ownerKey,
      connectedAt: new Date(),
      isMain: !existing,
      // An admin name is always admin; anyone else keeps the default role.
      role: isAdmin ? 'admin' : 'user',
      ...tokenData,
    },
    update: {
      characterName: characterName || characterId,
      ownerKey,
      // Promote on every login so adding a name to ADMIN_CHARACTER_NAMES
      // takes effect without touching the database, but never silently demote
      // someone an admin promoted in-app.
      ...(isAdmin ? { role: 'admin' } : {}),
      ...tokenData,
    },
  });

  res.cookie(
    SESSION_COOKIE_NAME,
    signSession({
      characterId: character.characterId,
      characterName: character.characterName,
      role: character.role,
      ownerKey: character.ownerKey,
    }),
    sessionCookieOptions(),
  );

  return {
    character: {
      characterId: character.characterId,
      characterName: character.characterName,
      role: character.role,
      corporationName: character.corporationName,
      allianceName: character.allianceName,
    },
  };
}

async function logout(body, req, res) {
  // Clears the cookie only. Deliberately does not revoke the refresh token:
  // that token is what the market poller uses when this character is the
  // configured reader, and signing out of the web UI should not stop the
  // citadel being polled.
  res.clearCookie(SESSION_COOKIE_NAME, { ...sessionCookieOptions(), maxAge: undefined });
  return { success: true };
}

async function getMe(body, req) {
  if (!req.user) return { user: null };
  return {
    user: {
      characterId: req.user.characterId,
      characterName: req.user.characterName,
      role: req.user.role,
      isAdmin: req.user.role === 'admin',
    },
  };
}

async function listCharacters() {
  const characters = await prisma.eveCharacter.findMany({
    orderBy: [{ active: 'desc' }, { characterName: 'asc' }],
    // Tokens must never leave the server.
    select: {
      id: true,
      characterId: true,
      characterName: true,
      corporationName: true,
      allianceName: true,
      role: true,
      banned: true,
      active: true,
      isMain: true,
      lastLoginAt: true,
      expiresAt: true,
      scopes: true,
    },
  });
  return { characters };
}

async function setCharacterRole({ characterId, role } = {}) {
  if (!characterId) throw new HttpError(400, 'characterId required');
  if (!['user', 'admin'].includes(role)) throw new HttpError(400, 'role must be "user" or "admin"');
  await prisma.eveCharacter.update({ where: { characterId }, data: { role } });
  return { success: true };
}

async function setCharacterBanned({ characterId, banned } = {}) {
  if (!characterId) throw new HttpError(400, 'characterId required');
  // An admin listed in ADMIN_CHARACTER_NAMES would be re-promoted on their
  // next login anyway, so blocking the ban here avoids a confusing no-op.
  if (isAdminCharacter((await prisma.eveCharacter.findUnique({ where: { characterId } }))?.characterName)) {
    throw new HttpError(400, 'This character is an environment-configured admin and cannot be blocked here.');
  }
  await prisma.eveCharacter.update({ where: { characterId }, data: { banned: !!banned } });
  return { success: true };
}

// Surfaced on the Settings page so an unconfigured (wide open) deployment is
// visible rather than silent.
async function getAccessPolicy() {
  const corps = parseIdList(process.env.ALLOWED_CORPORATION_IDS);
  const alliances = parseIdList(process.env.ALLOWED_ALLIANCE_IDS);
  return {
    allowedCorporationIds: corps,
    allowedAllianceIds: alliances,
    open: corps.length === 0 && alliances.length === 0,
    adminNames: parseIdList(process.env.ADMIN_CHARACTER_NAMES),
  };
}

export const authHandlers = {
  eveLogin: { fn: eveLogin, auth: 'public' },
  eveCallback: { fn: eveCallback, auth: 'public' },
  logout: { fn: logout, auth: 'public' },
  getMe: { fn: getMe, auth: 'public' },
  listCharacters: { fn: listCharacters, auth: 'admin' },
  setCharacterRole: { fn: setCharacterRole, auth: 'admin' },
  setCharacterBanned: { fn: setCharacterBanned, auth: 'admin' },
  getAccessPolicy: { fn: getAccessPolicy, auth: 'admin' },
};
