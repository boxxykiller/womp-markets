// Cookie-level auth endpoints that aren't RPC calls.
import express from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions, signSession } from '../../lib/session.js';

const router = express.Router();

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ data: { user: null } });
  res.json({
    data: {
      user: {
        characterId: req.user.characterId,
        characterName: req.user.characterName,
        role: req.user.role,
        isAdmin: req.user.role === 'admin',
      },
    },
  });
});

// Development bypass, for working on the UI before an SSO application has
// been registered. The route is only mounted when the flag is exactly "true",
// so in production it 404s rather than 403s — an attacker can't tell the
// feature exists.
if (process.env.ENABLE_LOCAL_ADMIN_LOGIN === 'true') {
  router.post(
    '/local-login',
    asyncHandler(async (req, res) => {
      const { username, password } = req.body || {};
      const expectedUser = process.env.LOCAL_ADMIN_USERNAME;
      const expectedPass = process.env.LOCAL_ADMIN_PASSWORD;

      if (!expectedUser || !expectedPass) {
        throw new HttpError(500, 'Local admin login is enabled but has no username/password configured.');
      }
      if (username !== expectedUser || password !== expectedPass) {
        throw new HttpError(401, 'Invalid credentials');
      }

      res.cookie(
        SESSION_COOKIE_NAME,
        signSession({
          characterId: 'local-admin',
          characterName: 'Local Admin',
          role: 'admin',
          ownerKey: 'local-admin',
        }),
        sessionCookieOptions(),
      );
      res.json({ data: { success: true } });
    }),
  );
  console.log('[auth] Local admin login is ENABLED — do not run this way in production.');
}

export default router;
