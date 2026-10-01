# Tandem roadmap

Ideas for after the MVP. Nothing here is scheduled. Current focus: polish the existing UI.

## Direction (decided in demo sessions)

- First public release: open-source, single user. Multi-user only if there is demand.
- Success measure: a one-question verdict at **End session** ("better / same / worse than the terminal" + optional note), stored in the log and in `tdm export`.

## Parked features (in this order)

- `diff` block: before/after blobs, comments anchored to either side.
- Packaging: brew first, then an npm wrapper that downloads the binary. Agent-agnostic guide, CLI contract frozen as v1.
- File-change detection for stale snapshots.
- Time travel and session branching.
- Whole-stage overview view.
- `tdm stats` (time to first comment, superseded ratio), only if verdicts are mixed.

## UI polish backlog

- Follow content that grows late (code highlighting, blob load); no pill during a smooth scroll.
- Page-level tests: toast auto-dismiss, declined End session confirm, full reconnect cycle.
- `aria-label` on generic spans (nav badges) → visually hidden text.
- Guard `StageView`/`ThreadView` against unknown ids.
- Silence Vite's chunk-size warning (`build.chunkSizeWarningLimit`).
- `AllSessions`: avoid loading each project twice and holding the manager lock across log replay.

## Decided against

- `Discuss` button on the proposed conclusion: the composer covers it.
- Choosing a variant sends immediately: replaced by select → **Send choice**.
