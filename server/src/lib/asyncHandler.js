// Wraps an async express handler so a rejected promise reaches the error
// middleware instead of becoming an unhandled rejection.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
