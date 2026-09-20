// Routes throw `new HttpError(400, 'why')` rather than hand-rolling a
// res.status().json() at every failure point.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line no-unused-vars -- express identifies the error
// handler by arity; `next` must stay in the signature.
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err);
  res.status(status).json({ error: err.message || 'Internal server error' });
}
