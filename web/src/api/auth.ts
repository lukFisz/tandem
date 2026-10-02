// The page token authenticates the page's API calls. The daemon puts it in the session link
// (?token=…); captureToken moves it into localStorage, which is per origin (so per port, unlike a
// cookie, which every server on 127.0.0.1 would receive), and strips it from the address bar.
// The token is limited to the routes the page calls, and changes on every daemon start.
const STORAGE_KEY = 'tdm.token'

let token = ''

export function captureToken(): void {
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('token')
  if (fromUrl) {
    token = fromUrl
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl)
    } catch {
      // storage blocked: the token still works for this page load
    }
    url.searchParams.delete('token')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    return
  }
  try {
    token = localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    token = ''
  }
}

export function authToken(): string {
  return token
}

// authHeaders is the Authorization header for an API call, or none without a token (the dev
// server's proxy adds one itself).
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// withToken adds the token to a URL as ?token=, for EventSource, which cannot send headers. The
// daemon accepts it there only on the stream route.
export function withToken(path: string): string {
  return token ? `${path}?token=${encodeURIComponent(token)}` : path
}
