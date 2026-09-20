// RPC dispatcher. Feature modules export a handlers object whose entries are
// `{ fn, auth }`; they're merged into one registry and dispatched by name at
// POST /api/functions/:name.
//
// The alternative — a REST route per operation — buys nothing here: every
// call is a POST of one JSON body from one first-party client, and a single
// registry makes the auth requirement of every operation visible in one
// place, which is what actually matters for a tool with an admin tier.
import express from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { isAdmin } from '../middleware/requireAdmin.js';
import { authHandlers } from './auth/handlers.js';
import { marketHandlers } from './market/index.js';
import { reportHandlers } from './market/reports.js';
import { settingsHandlers } from './settings/index.js';

const router = express.Router();

const REGISTRY = {
  ...authHandlers,
  ...marketHandlers,
  ...reportHandlers,
  ...settingsHandlers,
};

router.post(
  '/:name',
  asyncHandler(async (req, res) => {
    const entry = REGISTRY[req.params.name];
    if (!entry) throw new HttpError(404, `Unknown function: ${req.params.name}`);

    if (entry.auth === 'admin') {
      if (!req.user) throw new HttpError(401, 'Authentication required');
      if (!isAdmin(req.user)) throw new HttpError(403, 'Administrator access required');
    } else if (entry.auth === 'auth') {
      if (!req.user) throw new HttpError(401, 'Authentication required');
    }

    const data = await entry.fn(req.body || {}, req, res);
    if (!res.headersSent) res.json({ data });
  }),
);

export default router;
export { REGISTRY };
