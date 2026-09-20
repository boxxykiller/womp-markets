// Populates req.user from the session cookie. Never blocks a request —
// requireAuth / requireAdmin decide that. Because sessions are stateless
// JWTs, the ban and role flags are re-read from the database here so a ban or
// a demotion takes effect immediately instead of at token expiry.
import { prisma } from '../db/prisma.js';
import { SESSION_COOKIE_NAME, verifySession } from '../lib/session.js';

export async function authMiddleware(req, res, next) {
  req.user = null;

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return next();

  const session = verifySession(token);
  if (!session?.characterId) return next();

  // The local dev admin has no database row by design.
  if (session.characterId === 'local-admin') {
    req.user = session;
    return next();
  }

  const character = await prisma.eveCharacter.findUnique({
    where: { characterId: session.characterId },
    select: { banned: true, active: true, role: true, characterName: true, ownerKey: true },
  });
  if (!character || character.banned || !character.active) return next();

  req.user = { ...session, role: character.role, characterName: character.characterName, ownerKey: character.ownerKey };
  next();
}
