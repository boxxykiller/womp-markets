// Stateless JWT sessions in an HttpOnly cookie. There is no server-side
// session store, so the auth middleware re-checks the ban flag against the
// database on every request — a signed token alone can't be revoked.
import jwt from 'jsonwebtoken';

const SESSION_TTL_SECONDS = 24 * 60 * 60;

export const SESSION_COOKIE_NAME = 'womp_auth';

function secret() {
  const value = process.env.SESSION_SECRET;
  // Thrown at call time rather than import time so the test suite and
  // `prisma generate` don't need a secret just to load the module.
  if (!value) throw new Error('SESSION_SECRET is not set');
  return value;
}

export function signSession(payload) {
  return jwt.sign(payload, secret(), { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySession(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}
