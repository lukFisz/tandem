import { describe, expect, it } from 'vitest'
import { isAllowedDevProxyRequest, stripQuery } from './proxyPolicy'

const DEV_ORIGIN = 'http://localhost:5173'

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return extra
}

describe('isAllowedDevProxyRequest', () => {
  it('allows GET /api/sessions from the dev page with no Origin/Sec-Fetch-Site', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows GET /api/sessions/{sid}/stream', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/stream', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows GET /api/sessions/{sid}/state', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/state', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows GET /api/sessions/{sid}/blobs/{sha}', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/blobs/deadbeef', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows GET /api/sessions/{sid}/render/{what}', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/render/export', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows POST /api/sessions/{sid}/actions', () => {
    expect(isAllowedDevProxyRequest('POST', '/api/sessions/abc123/actions', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows GET and PUT /api/settings', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/settings', headers(), DEV_ORIGIN)).toBe(true)
    expect(isAllowedDevProxyRequest('PUT', '/api/settings', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('allows POST /api/sessions/{sid}/open-file', () => {
    expect(isAllowedDevProxyRequest('POST', '/api/sessions/abc123/open-file', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('rejects GET /api/sessions/{sid}/wait', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/wait', headers(), DEV_ORIGIN)).toBe(false)
  })

  it('rejects POST /api/sessions/{sid}/commands', () => {
    expect(isAllowedDevProxyRequest('POST', '/api/sessions/abc123/commands', headers(), DEV_ORIGIN)).toBe(false)
  })

  it('rejects POST /api/shutdown', () => {
    expect(isAllowedDevProxyRequest('POST', '/api/shutdown', headers(), DEV_ORIGIN)).toBe(false)
  })

  it('rejects POST /api/sessions (create session)', () => {
    expect(isAllowedDevProxyRequest('POST', '/api/sessions', headers(), DEV_ORIGIN)).toBe(false)
  })

  it('rejects a cross-site request even to an allowed path (Sec-Fetch-Site: cross-site)', () => {
    expect(
      isAllowedDevProxyRequest('GET', '/api/sessions', headers({ 'sec-fetch-site': 'cross-site' }), DEV_ORIGIN),
    ).toBe(false)
  })

  it('rejects a same-site (but not same-origin) request', () => {
    expect(
      isAllowedDevProxyRequest('GET', '/api/sessions', headers({ 'sec-fetch-site': 'same-site' }), DEV_ORIGIN),
    ).toBe(false)
  })

  it('allows Sec-Fetch-Site: same-origin', () => {
    expect(
      isAllowedDevProxyRequest('GET', '/api/sessions', headers({ 'sec-fetch-site': 'same-origin' }), DEV_ORIGIN),
    ).toBe(true)
  })

  it('rejects a request whose Origin does not match the dev server origin', () => {
    expect(
      isAllowedDevProxyRequest('GET', '/api/sessions', headers({ origin: 'http://evil.example' }), DEV_ORIGIN),
    ).toBe(false)
  })

  it('allows a request whose Origin matches the dev server origin', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions', headers({ origin: DEV_ORIGIN }), DEV_ORIGIN)).toBe(true)
  })

  it('rejects an unknown path', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/unknown', headers(), DEV_ORIGIN)).toBe(false)
  })

  it('rejects the wrong method on an allowed path', () => {
    expect(isAllowedDevProxyRequest('DELETE', '/api/sessions/abc123/actions', headers(), DEV_ORIGIN)).toBe(false)
  })

  // Residual round, Minor: matches on method case-insensitively — some HTTP client libraries
  // (and a hand-rolled fetch through a proxy) may send a lowercase method.
  it('allows a lowercase method', () => {
    expect(isAllowedDevProxyRequest('get', '/api/sessions', headers(), DEV_ORIGIN)).toBe(true)
  })

  // Residual round, Minor: a query string must not smuggle an otherwise-disallowed path past the
  // allowlist (the router only ever sees the path).
  it('allows an allowed path with a query string, matching on the path alone', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions?x=1', headers(), DEV_ORIGIN)).toBe(true)
  })

  it('rejects a disallowed path even with a query string appended', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc123/wait?x=1', headers(), DEV_ORIGIN)).toBe(false)
  })

  // Residual round, Minor: `..` (and `.`) is not a slash, so `[^/]+` — the pattern used for
  // sid/sha/what — matches it like any other segment. Without an explicit check, a path like
  // "/api/sessions/../actions" ("sid" = "..") passes the POST /actions allowlist check here, and
  // could then be cleaned by the daemon's own router (net/http's ServeMux cleans paths) into a
  // *different*, disallowed route once it actually reaches the daemon.
  it('rejects a path containing a ".." segment, even where it lands on an otherwise-allowed route', () => {
    expect(isAllowedDevProxyRequest('POST', '/api/sessions/../actions', headers(), DEV_ORIGIN)).toBe(false)
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc/render/../../shutdown', headers(), DEV_ORIGIN)).toBe(
      false,
    )
  })

  it('rejects a path containing a "." segment', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/./stream', headers(), DEV_ORIGIN)).toBe(false)
  })

  // Residual round, Minor: %2F contains no literal "/", so `[^/]+` (the pattern used for
  // sid/sha/what) matches straight through it — e.g. render's `what` segment could carry
  // "export%2F..%2F..%2Fshutdown" and pass this allowlist today, only to become a multi-segment
  // path once something downstream (a proxy, the daemon itself) decodes it. Reject any encoded
  // slash outright rather than assuming nothing downstream ever decodes.
  it('rejects a path containing an encoded slash (%2F)', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc/render/export%2F..%2F..%2Fshutdown', headers(), DEV_ORIGIN)).toBe(
      false,
    )
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/abc/render/export%2f..%2f..%2fshutdown', headers(), DEV_ORIGIN)).toBe(
      false,
    )
  })

  it('rejects an allowed route with a trailing slash', () => {
    expect(isAllowedDevProxyRequest('GET', '/api/sessions/', headers(), DEV_ORIGIN)).toBe(false)
    expect(isAllowedDevProxyRequest('POST', '/api/sessions/abc123/actions/', headers(), DEV_ORIGIN)).toBe(false)
  })
})

describe('stripQuery', () => {
  it('removes everything from the first "?" onward', () => {
    expect(stripQuery('/api/sessions?x=1&y=2')).toBe('/api/sessions')
  })

  it('returns the input unchanged when there is no query string', () => {
    expect(stripQuery('/api/sessions')).toBe('/api/sessions')
  })
})
