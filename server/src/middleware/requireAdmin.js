import { HttpError } from './errorHandler.js';

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!isAdmin(req.user)) return next(new HttpError(403, 'Administrator access required'));
  next();
}
