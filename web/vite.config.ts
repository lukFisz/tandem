import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAllowedDevProxyRequest } from './src/dev/proxyPolicy'

// In `npm run dev`, /api is proxied to the running daemon with its Bearer token,
// so the dev page does not need the daemon's cookie.
// This reads daemon.json once at dev-server startup: if the daemon restarts
// (and so picks a different port/token), restart `npm run dev` too.
function daemonTarget(): { url: string; token: string } | undefined {
  try {
    const home = process.env.TANDEM_HOME ?? join(homedir(), '.tandem')
    const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { port: number; pageToken: string }
    // The page token, not the CLI token: the daemon then also limits the proxy to the page's routes.
    return { url: `http://127.0.0.1:${info.port}`, token: info.pageToken }
  } catch {
    return undefined
  }
}

const DEV_SERVER_PORT = 5173

export default defineConfig(({ command }) => {
  const daemon = command === 'serve' ? daemonTarget() : undefined
  const devOrigin = `http://localhost:${DEV_SERVER_PORT}`
  return {
    plugins: [react()],
    build: { outDir: '../internal/daemon/webdist', emptyOutDir: true },
    server: {
      port: DEV_SERVER_PORT,
      // Residual round, Minor: without this, Vite would silently fall back to the next free
      // port when 5173 is taken, and devOrigin (fixed at 5173 above) would then no longer be
      // the dev server's real origin — silently breaking the same-origin check the whole proxy
      // policy depends on. Open the dev page at http://localhost:5173 (see README).
      strictPort: true,
      // I1: the default `cors: true` would let any other localhost page read
      // proxied responses (which carry the daemon's full-access Bearer
      // token) via a cross-origin fetch. Only same-origin requests from the
      // dev page itself are ever allowed past the proxy below.
      cors: false,
      proxy: !daemon
        ? undefined
        : {
            '/api': {
              target: daemon.url,
              changeOrigin: true,
              // I1: only forward the exact requests the dev page itself
              // makes (see proxyPolicy.ts); everything else — /wait,
              // /commands, /shutdown, POST /api/sessions, cross-site
              // requests — is rejected with 403 before it reaches the
              // daemon, so a malicious page cannot use this proxy to act
              // with full CLI rights.
              bypass: (req: IncomingMessage, res?: ServerResponse) => {
                const headers: Record<string, string | undefined> = {
                  origin: req.headers.origin,
                  'sec-fetch-site': req.headers['sec-fetch-site'] as string | undefined,
                }
                // isAllowedDevProxyRequest strips the query string itself (see stripQuery) —
                // pass req.url as-is.
                if (isAllowedDevProxyRequest(req.method ?? 'GET', req.url ?? '', headers, devOrigin)) {
                  return undefined // let the proxy forward it
                }
                if (res) {
                  res.statusCode = 403
                  res.end('dev proxy: request not allowed')
                }
                return false // handled; do not fall through to the SPA
              },
              configure: (proxy) => {
                proxy.on('proxyReq', (req) => {
                  req.removeHeader('origin')
                  req.removeHeader('cookie')
                  req.setHeader('Authorization', `Bearer ${daemon.token}`)
                })
              },
            },
          },
    },
  }
})
