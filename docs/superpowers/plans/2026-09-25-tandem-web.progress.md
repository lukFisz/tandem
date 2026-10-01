# Tandem web — progress

Plan: [2026-09-25-tandem-web.md](2026-09-25-tandem-web.md) · Deviations: [2026-09-25-tandem-web.deviations.md](2026-09-25-tandem-web.deviations.md)
Integration branch: `feat/tandem-web` (from `main` @ `79d236e`). Single source of truth for progress; on resume, read this first.

| Task | Wave | Status | Branch/worktree | Commit | Review | Notes |
|---|---|---|---|---|---|---|
| T1 Backend: block seq, session list, fixture | 1 | merged | worktree-agent-ae2d600290dcbb917 | 3a22c5d (merge d36e91e) | approved (clean) |  |
| T2 Web scaffold, theme, embedded build | 1 | merged | worktree-agent-a754e0da5a8c2792b | 00b6c2a (merge ff16223) |  | webdist committed by orchestrator after merge |
| T3 API types, client, session stream | 2 | merged | feat/tandem-web (direct) | 4a3570d | approved (2 minor deferred) | single-task wave; no webdist change |
| T4 Draft model and persistence | 3 | merged | worktree-agent-a95ebc491c06f3d17 | 5d825fa (squashed; merge 7b07243) | approved after fix round 1 | fix: useDraft reloads on sid change |
| T5 Syntax highlighting, code lines | 3 | merged | worktree-agent-a92247a91da9c1a08 | 691c87e (merge a12c837) | approved (2 minor) |  |
| T6 Markdown sections | 4 | merged | worktree-agent-af4ae3140fd7024d9 | 43f8f98 (squashed; merge f5f8ec8) | approved after fix round 1 | hex-only token colours |
| T7 Session context, controller, harness | 4 | merged | worktree-agent-af30fef2b60bf2553 | 0ee8919 (squashed; merge 3f9357b) | approved after fix round 1 (opus) | in-flight guard, edit-safe removal, read-only guard, harness wrapper |
| T8 Note/code/file/markdown blocks | 5 | merged | feat/tandem-web (direct) | 1363837 (squashed, incl. webdist) | approved after fix round 1 (opus) | hot line; notes anchored between md sections |
| T9 Variants block | 6 | merged | worktree-agent-a36c10dce5112641b | 4e39e4e (squashed; merge 2456061) | approved after fix round 1 | Chosen chip neutral, pro/con lines coloured (mockup) |
| T10 Thread view | 7 | merged | feat/tandem-web (direct) | 3c2bd2a (incl. webdist) | approved (opus; 7 minor deferred) | ThreadBody keyed by threadId |
| T11 Stage view, nav, shortcuts | 6 | merged | worktree-agent-ac783544cfc0e35fe | daea19c (squashed; merge 54bdc6c) | approved after fix round 1 (opus) | F3 sticky item, F12 hint, per-stage editor; app.css conflict resolved (both sections) |
| T12 App shell | 8 | merged | feat/tandem-web (direct) | da53c72 (squashed, incl. webdist) | approved (opus) + user smoke check; fix round 1 re-reviewed | F4/F10/F11; rem type scale with 1440/1728/2200 breakpoints (user) |
| T12b UI follow-ups from the user's demo (autoscroll B, delivery status, working dot, auto-advance, thread width) | 8b | merged | feat/tandem-web (direct) | 50a74d4 (squashed: rounds 1–3 + review fixes, incl. webdist) | approved after 4 fix rounds (opus reviews) | user requests from 2 demos: follow-bottom (any action), delivery status, typing bubble, working dot, auto-advance, no Discuss, centered wide column |
| T12c Variants: select, then confirm with Send choice (user request, demo take 3) | 9b | merged | feat/tandem-web (direct) | e4a9588 (incl. webdist) | approved (1 minor: comment kept when switching selection — intentional) | added at the user's request |
| T13 Playwright e2e, docs | 9 | merged | feat/tandem-web (direct) | 669babf (squashed; rebased onto T12b) | approved after fix round 1 | e2e asserts exact wait section; expects auto-advance after Accept |

## Current wave

**Done.** All tasks merged on `feat/tandem-web`, the final review's findings are fixed and re-reviewed, and final verification is green. Waiting for the user to decide how to finish the branch (merge / PR / keep).

## Blockers / questions for the user

_None._ (Chromium download for T13 approved by the user.)

## Deviations

See [2026-09-25-tandem-web.deviations.md](2026-09-25-tandem-web.deviations.md).

- Pre-flight rulings F1–F15 (TS 7 CSS imports, markdown-it type import, sticky nav item, daemon-restart hint, webdist commit policy, minors).
- T2: `tsconfig` `types` includes `vite/client` (F1); `private` is boolean (F9).
- T4: `useDraft` keeps `{sid, draft}` state and reloads when `sid` changes (the plan's code saved the old session's draft under the new key).
- T6: token colours in markdown code are emitted only when they are hex (review: attribute injection).
- T7: in-flight comment ids are excluded from overlapping sends; after success only comments whose text is unchanged are removed; closed sessions never send; harness uses `render(ui, { wrapper })`.
- T8: code rows that carry a note get the mockup's "hot line" background (`CodeLines` gained an optional `noted` prop), and selection wins over it. Markdown notes anchor to the last section starting at or before their end line, so notes on blank lines between sections are no longer dropped. `useBlockText` resets to loading when the blob changes.
- T9: the `Chosen` chip uses the mockup's neutral primary style and pros/cons colour the whole line; the selected card keeps its amber ring (spec §9).
- T11: sticky current item via `replaceState` (F3), all-resolved hint (F12), StageView resets its editor per stage (review), `isContentEditable` counts as typing.
- T10: `ThreadView` keys an internal `ThreadBody` by `threadId`, so editors reset when the thread changes.
- T12: F4 restart hint, F10 clipboard error, F11 status text. After the user's smoke check, all type and reading measures use rem, and the root font size steps up at 1440, 1728 and 2200 px.
- T12b (added at the user's request after the demo): follows new content (variant B, `New below ↓` pill), delivery status under the latest user message, a pulsing working dot (`--working`), and auto-advance to the next open thread after the user accepts a conclusion. The `.thread` width is now in rem. After the second demo: the follow is armed after any user action, a typing bubble (three dots) replaces the "AI is replying…" line, `Discuss` is removed from the conclusion card, and the column is centered and widens with the viewport (`--col-width` 70vw; prose up to 48rem; root font size 20px at 2560 px and 22px at 3200 px).
- T13: the e2e expects auto-advance after Accept and asserts the exact `tdm wait` comment section.
- Final review fixes: the dev proxy only forwards the page's own API calls (same-origin, tested allow-list, `strictPort`, `cors:false`); the daemon reuses its last port (`TANDEM_HOME/daemon.port`, probed first), so the draft survives restarts; the typing bubble is gated on `!waiting` and unresolved threads; the scroll resets per item; the selection is cleared on navigation; `a` is ignored while editing; the composer sends the draft on an empty ⌘/Ctrl↵ and has an in-flight guard; dark error toast contrast is fixed; README notes are added.
- T12c: a variant is selected and then confirmed with **Send choice** (user request).
- Roadmap: [docs/ROADMAP.md](../../ROADMAP.md).

## Verification log

| Date | Wave | Command | Result |
|---|---|---|---|
| 2026-09-25 | 1 | `cd web && npm ci && npm run build && npm run typecheck && npm test` | PASS (1 test); build OK |
| 2026-09-25 | 1 | `go test ./...` | PASS (all packages) |
| 2026-09-25 | 2 | `cd web && npm run typecheck && npm test` | PASS (4 files, 10 tests) |
| 2026-09-25 | 3 | `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon` | PASS (8 files, 22 tests); build OK; daemon PASS |
| 2026-09-25 | 4 | `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon` | PASS (10 files, 37 tests); build OK; daemon PASS |
| 2026-09-25 | 5 | `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon` | PASS (13 files, 47 tests); rebuild leaves no diff; daemon PASS |
| 2026-09-25 | 6 | merge T9, T11 (app.css conflict: kept both sections); `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon` | PASS (17 files, 65 tests); build OK; daemon PASS |
| 2026-09-25 | 7 | `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon` | PASS (19 files, 72 tests); rebuild leaves no diff; daemon PASS |
| 2026-09-25 | 8 | `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon`; manual smoke check by the user (light/dark) | PASS (22 files, 91 tests); build OK; daemon PASS; user: OK except type size on wide screens → fixed |
| 2026-09-25 | 8b | `cd web && npm run typecheck && npm test && npm run build`; `go test ./internal/daemon` | PASS (25 files, 121 tests); build OK; daemon PASS |
| 2026-09-25 | 9 (final) | `cd web && npm run typecheck && npm test && npm run e2e`; `go vet ./... && go test -race -count=1 ./...`; `git status` after build | PASS: typecheck, Vitest 144/144, Playwright 1/1, go vet, go test -race all packages; webdist current (clean status) |
| 2026-09-25 | final | `cd web && npm run typecheck && npm test && npm run build && npm run e2e`; `go vet ./... && go test -race -count=1 ./...`; `git status` | PASS: Vitest 196/196 (28 files), Playwright 1/1, build leaves webdist unchanged, go vet clean, go test -race all packages ok |
