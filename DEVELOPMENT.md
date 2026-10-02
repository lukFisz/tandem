# Developing Tandem

## Prerequisites

- Go 1.27 (from `go.mod`). Builds only on Unix: macOS and Linux.
- Node 22.12+, 24 or 26+ (not 23 or 25), needed only for work on the web UI (`web/`). This range comes from the
  engine requirements of Vitest 5 (`^22.12.0 || ^24.0.0 || >=26.0.0`) and Vite 8 (`^20.19.0 || >=22.12.0`).
- git.

## Layout

- `cmd/tdm`: the entry point. A single binary is both the CLI and the daemon.
- `internal/domain`: pure domain logic (commands, events, state fold).
- `internal/store`: `$TANDEM_HOME` files, event logs and blobs.
- `internal/daemon`: HTTP server, API, long-poll `wait`, SSE stream, and the embedded web UI (`webdist/`).
- `internal/client`, `internal/cli`: the CLI side and daemon auto-start.
- `internal/render`, `internal/guide`, `internal/editor`: text rendering, the agent guide and skill, and open-in-editor.
- `web/`: the browser UI (React + TypeScript + Vite).
- `e2e/`: Go end-to-end tests that build and drive the real binary.

## Go

```bash
go build -o ~/bin/tdm ./cmd/tdm
go test ./...
```

`e2e/e2e_test.go` builds the binary twice with different `-X main.version` values to test daemon auto-start
and restart on a version mismatch. Plain builds report `dev-<hash of the binary>`, so a rebuilt CLI replaces
any older running daemon, including the one your real sessions use. When trying a dev build, run
`export TANDEM_HOME=$(mktemp -d)` first.

## Web UI

The page the daemon serves lives in `web/` (React + TypeScript + Vite). Its build output,
`internal/daemon/webdist/`, is committed so `go build` works without Node.

```bash
cd web
npm install
npm test          # unit and component tests (Vitest)
npm run dev       # dev server; proxies /api to the running daemon (start one with `tdm session new`)
npm run build     # typecheck and write ../internal/daemon/webdist — commit the result
npm run e2e       # build, then Playwright against a real tdm binary
```

`npm run e2e` needs `npx playwright install chromium` once, plus a Go toolchain to build the `tdm` binary it
drives. The specs (`web/e2e/*.spec.ts`) run against Desktop Chrome, with `TANDEM_NO_BROWSER=1` and a
temporary `TANDEM_HOME`.

Tests that assert the `⌘↵` shortcut label pin `navigator.platform` to macOS, so the suite passes on any OS.

### Snapshot contract fixture

`internal/daemon/contract_test.go` (`TestSnapshotContractFixture`) pins the daemon's state/SSE JSON in
`web/src/test/fixtures/snapshot.json`, and the web tests load the same file. If the snapshot JSON changes,
regenerate the fixture:

```bash
go test ./internal/daemon -run TestSnapshotContractFixture -update
```

### Dev server and proxy

`npm run dev` reads `daemon.json` (port and page token) from `$TANDEM_HOME`, or from `~/.tandem` when that is unset,
once at startup. If the daemon restarts, restart `npm run dev` too. A daemon restart always picks a new token.
It keeps the same port unless that port is no longer free, because the daemon persists its port in
`daemon.port`, separately from `daemon.json`.

The proxy injects the daemon's page token, so it only forwards the exact requests the page itself makes
(`web/src/dev/proxyPolicy.ts`). The daemon enforces the same list for the page token (`pageRoutes` in
`internal/daemon/server.go`); keep the two in sync:

| Method | Path |
|---|---|
| GET | `/api/sessions` |
| GET | `/api/sessions/{sid}/stream`, `/state`, `/blobs/{sha}`, `/render/{what}` |
| POST | `/api/sessions/{sid}/actions`, `/api/sessions/{sid}/open-file` |
| GET, PUT | `/api/settings` |

Everything else is rejected with 403 before it reaches the daemon. That includes `wait`, `commands`,
`shutdown`, `POST /api/sessions`, paths with `.`/`..` segments or encoded slashes, and cross-site requests.

The dev server always binds port 5173 (`strictPort: true`). Open the page at `http://localhost:5173`,
because that is the origin the proxy trusts as same-origin.

