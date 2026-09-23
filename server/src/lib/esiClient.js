// Shared ESI fetch helpers.
const ESI_BASE = process.env.ESI_BASE || 'https://esi.evetech.net/latest';

// Identifies this app to CCP. ESI asks every consumer to send something
// contactable so they can reach the operator before rate-limiting them.
const USER_AGENT = process.env.ESI_USER_AGENT || 'womp-markets (+https://github.com/boxxykiller/womp-markets)';

function buildUrl(path, params) {
  const url = new URL(`${ESI_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }
  return url;
}

function buildHeaders(token, hasBody) {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

// Every outbound call gets a deadline. Without one, a single connection that
// never answers hangs its caller forever — and for the reference refresh that
// means its in-progress flag never clears and no price refreshes again.
export const ESI_TIMEOUT_MS = 30_000;

export async function esiFetch(path, { token, method = 'GET', body, params } = {}) {
  const res = await fetch(buildUrl(path, params), {
    method,
    headers: buildHeaders(token, !!body),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(ESI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`ESI ${res.status} ${path}: ${text}`);
    // Kept on the error so bulk callers can back off on 420/429 instead of
    // burning through the error budget.
    err.status = res.status;
    err.headers = res.headers;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// For endpoints that paginate via ?page=N plus an X-Pages response header
// (structure and region order books). Pages are fetched sequentially because
// ESI rate-limits per endpoint and a single structure's book is rarely more
// than a handful of pages.
export async function esiFetchPaged(path, { token, params } = {}) {
  const results = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = buildUrl(path, params);
    url.searchParams.set('page', page);

    const res = await fetch(url, { headers: buildHeaders(token, false), signal: AbortSignal.timeout(ESI_TIMEOUT_MS) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ESI ${res.status} ${path}: ${text}`);
    }
    totalPages = Number(res.headers.get('x-pages')) || 1;
    const batch = await res.json();
    results.push(...(Array.isArray(batch) ? batch : []));
    page += 1;
  } while (page <= totalPages);

  return results;
}

// Runs fn over items with at most `limit` in flight. Used wherever a list of
// type ids has to be fetched one request each — enough parallelism to be
// quick, little enough to stay well inside ESI's error budget.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await fn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
