import { HttpError } from './errorHandler.js';

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  next();
}
