# Developing Tandem

## Prerequisites

- Go 1.27 (from `go.mod`). Builds only on Unix: macOS and Linux.
- Node 22.12 or later, needed only for work on the web UI (`web/`). This minimum comes from the Vite 8 and Vitest 5 engine requirements.
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
and restart on a version mismatch. Plain builds report `dev-<hash of the binary>`, so a rebuilt CLI always
replaces an older running daemon.

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

> [!NOTE]
> Three Vitest tests (in `src/thread/Composer.test.tsx` and `src/thread/ThreadView.test.tsx`) expect the
> macOS `⌘↵` label. Off macOS, jsdom reports the host OS and the label renders as `Ctrl↵`, so those tests fail
> on Linux.

### Snapshot contract fixture

`internal/daemon/contract_test.go` (`TestSnapshotContractFixture`) pins the daemon's state/SSE JSON in
`web/src/test/fixtures/snapshot.json`, and the web tests load the same file. If the snapshot JSON changes,
regenerate the fixture:

```bash
go test ./internal/daemon -run TestSnapshotContractFixture -update
```

### Dev server and proxy

`npm run dev` reads `daemon.json` (port and token) from `$TANDEM_HOME`, or from `~/.tandem` when that is unset,
once at startup. If the daemon restarts, restart `npm run dev` too. A daemon restart always picks a new token.
It keeps the same port unless that port is no longer free, because the daemon persists its port in
`daemon.port`, separately from `daemon.json`.

The proxy injects the daemon's Bearer token, so it only forwards the exact requests the page itself makes
(`web/src/dev/proxyPolicy.ts`):

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

## Design docs

Design specs are in `docs/superpowers/specs/` and implementation plans in `docs/superpowers/plans/`. They
are dated working documents, and some details have drifted from the code. Treat the code as the source of
truth. Examples of drift: the API paths, the `schema/` directory, and questions and the theme toggle, which
were out of MVP scope in the spec but are now implemented. The roadmap is in `docs/ROADMAP.md`.
