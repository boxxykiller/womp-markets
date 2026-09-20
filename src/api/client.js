// Single network module. Everything is same-origin and relative, and auth is
// an HttpOnly cookie, so `credentials: 'include'` is the only auth plumbing
// the frontend needs — there are no tokens in JS and no Authorization
// headers anywhere.

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // A non-JSON body (a proxy error page, say) still needs a usable message.
  }

  if (!res.ok) {
    const error = new Error(payload?.error || `Request failed: ${res.status}`);
    error.status = res.status;
    // The callback surfaces this specific code as the "not authorised" page
    // rather than a generic failure.
    error.code = payload?.error;
    throw error;
  }
  return payload?.data;
}

/** Calls an RPC handler. Rejects on failure so react-query's error path works. */
export function invoke(name, payload = {}) {
  return request(`/api/functions/${name}`, { method: 'POST', body: payload });
}

export const api = {
  invoke,
  me: () => request('/api/auth/me'),
  localLogin: (username, password) =>
    request('/api/auth/local-login', { method: 'POST', body: { username, password } }),

  sde: {
    status: () => request('/api/sde/status'),
    search: (q, limit = 25) => request(`/api/sde/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    resolveNames: (names) => request('/api/sde/resolve-names', { method: 'POST', body: { names } }),
  },
};
