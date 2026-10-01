# Tandem

Tandem lets an AI agent work through large output with you, stage by stage and thread by thread, in your
browser. The agent drives the `tdm` CLI. You read, comment on lines, pick variants, and accept conclusions.

## Build

```bash
go build -o ~/bin/tdm ./cmd/tdm
```

## Use with Claude Code

```bash
tdm skill install
```

Then ask Claude to "review this with Tandem". The agent reads `tdm guide` and starts a session.

## Development

```bash
go test ./...
```

The design lives in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.

## Web UI

The page the daemon serves lives in `web/` (React + TypeScript + Vite). Its build output,
`internal/daemon/webdist/`, is committed so `go build` works without Node.

```bash
cd web
npm install
npm test          # unit and component tests (Vitest)
npm run dev       # dev server; proxies /api to the running daemon (start one with `tdm session new`)
npm run build     # typecheck and write ../internal/daemon/webdist — commit the result
npm run e2e       # build, then Playwright against a real tdm binary — needs `npx playwright install chromium` once, and a Go toolchain to build the tdm binary it drives
```

If the daemon's snapshot JSON changes, regenerate the shared fixture:
`go test ./internal/daemon -run TestSnapshotContractFixture -update`.

`npm run dev` reads `daemon.json` (port + token) once at startup: if the daemon restarts — which
always picks a new token, and the same port as before unless that port is no longer free (the
daemon persists its port across restarts in `daemon.port`, separately from `daemon.json`) —
restart `npm run dev` too. Its proxy only forwards the exact requests the page itself makes
(session list, stream, state, blobs, render, actions); everything else, including cross-site
requests, is rejected before it reaches the daemon. The dev server itself always binds port 5173
(`strictPort: true`) — open the page at `http://localhost:5173`, since that's the origin the proxy
trusts as same-origin.
