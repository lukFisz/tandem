// I1: `npm run dev` proxies /api to the running daemon and injects its Bearer
// token, which otherwise grants full CLI rights to anything that can reach
// the Vite dev server. This policy is the single gate in front of that
// proxy: it allows only the exact requests the page itself makes, and only
// when they are same-origin with the dev server.

const ALLOWED_ROUTES: { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/api\/sessions$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/stream$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/state$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/blobs\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/render\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/sessions\/[^/]+\/actions$/ },
  { method: 'GET', pattern: /^\/api\/settings$/ },
  { method: 'PUT', pattern: /^\/api\/settings$/ },
  { method: 'POST', pattern: /^\/api\/sessions\/[^/]+\/open-file$/ },
]

/** Strips everything from the first "?" onward — the router only ever sees the path. */
export function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

// hasSuspiciousSegment is true for a "." or ".." path segment, or an encoded slash anywhere in
// the path. Neither contains a literal "/", so the `[^/]+` used for sid/sha/what in
// ALLOWED_ROUTES matches straight through them — e.g. "/api/sessions/../actions" (sid = "..")
// or a render `what` of "export%2F..%2F..%2Fshutdown" would otherwise pass. Rejecting them here
// is defense in depth against the daemon's own router (net/http's ServeMux cleans "." / ".."
// segments) or anything else downstream turning one segment into a different, disallowed route.
function hasSuspiciousSegment(path: string): boolean {
  if (/%2f/i.test(path)) return true
  return path.split('/').some((segment) => segment === '.' || segment === '..')
}

/**
 * Whether a proxied dev-server request should be forwarded to the daemon
 * with its Bearer token. `headers` keys are matched case-insensitively.
 * `rawPath` may include a query string, which is stripped before matching.
 */
export function isAllowedDevProxyRequest(
  method: string,
  rawPath: string,
  headers: Record<string, string | undefined>,
  devOrigin: string,
): boolean {
  if (!isSameOriginWithDevServer(headers, devOrigin)) return false

  const path = stripQuery(rawPath)
  if (hasSuspiciousSegment(path)) return false

  const upperMethod = method.toUpperCase()
  return ALLOWED_ROUTES.some((route) => route.method === upperMethod && route.pattern.test(path))
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}

function isSameOriginWithDevServer(headers: Record<string, string | undefined>, devOrigin: string): boolean {
  const secFetchSite = header(headers, 'sec-fetch-site')
  if (secFetchSite !== undefined && secFetchSite !== 'same-origin') return false

  const origin = header(headers, 'origin')
  if (origin !== undefined && origin !== devOrigin) return false

  return true
}
