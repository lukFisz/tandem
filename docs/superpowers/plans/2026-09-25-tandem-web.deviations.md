# Tandem web — deviations from the plan

Deviations from `2026-09-25-tandem-web.md`, recorded by the orchestrator from the pre-flight scan and the implementers' reports.

## Decided before implementation (pre-flight scan)

- **F1 (Task 2): TypeScript 7 rejects CSS side-effect imports** (TS2882, `noUncheckedSideEffectImports` is on by default). `web/tsconfig.json` gets `"types": ["node", "vite/client"]`.
- **F2 (Task 6): `MarkdownIt` default import used as a type** fails under TS 7 + `@types/markdown-it` 14.2 (TS2749). Use `import MarkdownIt, { type MarkdownIt as Md } from 'markdown-it'` and annotate with `Md`. Exported names and signatures are unchanged (same type).
- **F3 (Task 11, affects Tasks 12–13): the view jumps when the default item changes.** With no `#` in the URL, `useCurrentItem` returned `defaultItem(state)` on every snapshot. Accepting a conclusion therefore moved the page to the stage view, which would fail Task 13's `Conclusion` check. `useCurrentItem` now pins the first item it shows: it writes it to the hash with `history.replaceState`, so no history entry is added. The signature is unchanged, and a test covers the behaviour.
- **F4 (Tasks 3, 12, Review Focus 3): daemon restart.** A restarted daemon listens on a new random port with a new token, so the page cannot reconnect by itself. Review Focus 3 now means "stream drop on a live daemon: `Reconnecting…` and recovery without reload". When the connection stays `connecting` for more than about 10 s, the top bar adds `If the daemon restarted, run tdm open.` The `Connection` type is unchanged.
- **F5 + user rule: `webdist` commits.** In parallel waves, implementers do not commit `internal/daemon/webdist/`. After merging the wave, the orchestrator runs the build and commits it as `build(web): regenerate webdist after wave N`. In single-task waves (Tasks 3, 8, 10, 12, 13), the implementer runs `npm run build` and commits `webdist` with the task if it changed.
- **F7 (Task 1): accepted as-is.** `AllSessions` loads every session into memory, and one session that fails to load fails the whole list.
- **F9 (Task 2):** `npm pkg set private=true --json` (the plan's version writes the string `"true"`).
- **F10 (Task 12):** Export catches clipboard errors separately, with their own message, instead of the generic "Is the tdm daemon running?" hint.
- **F11 (Task 12):** the session list shows the status text only for `closed` sessions. Previously `active` appeared twice: once as the status and once as the chip.
- **F12 (Task 11):** when every thread in an open stage is resolved, the hint reads `All threads resolved — waiting for the AI's stage summary.`
- **F13 (Task 12):** the manual smoke check runs with `TANDEM_HOME="$(mktemp -d)"`.
- **F15 (all tasks):** commit messages end with the `Co-Authored-By` trailer of the model that wrote them.

## During implementation
- **Task 4 (review, fix round 1):** the plan's `useDraft` initialized state once with `useState(() => loadDraft(sid))`. If `sid` changed on a mounted hook, the hook kept the old session's draft and then saved it under the new session's key. `useDraft` now keeps `{ sid, draft }` in one state object, reloads during render when `sid` changes, and saves only when `state.sid === sid`. The signature is unchanged. Covered by `reloads and re-scopes when sid changes on a live instance`. `toReview` no longer uses the non-null assertion `rt.comments!`.
- **Task 5 → Task 8 (review):** the mockup highlights the code line that carries an annotation (`.l.hot`, `#ffffff0d`), and the plan has no rule for it. Task 8 adds it for code rows that have an annotation or a comment.
- **Task 6 (review, fix round 1):** `renderTokensHtml` emits `style="color:…"` only for hex colours (`/^#[0-9a-fA-F]{3,8}$/`). Any other value is dropped and the text stays escaped, so a hostile `color` cannot inject attributes. Covered by a test in `markdown.test.ts`. The `MarkdownIt` type is used through the alias `type MarkdownIt as Md` (F2). The Markdown CSS section was appended (F8).
- **Task 7 (review, fix round 1; the plan's code had both bugs):**
  - The controller keeps a ref of in-flight comment ids. Overlapping `run`/`sendReview` calls leave those ids out, so comments are no longer sent twice.
  - After a successful send, only comments whose current text equals the sent text are removed, so an edit made during the send survives (Review Focus 1).
  - `run` and `sendReview` return `false` without posting when the session is closed.
  - `renderWithCtx`/`renderStateful` use `render(ui, { wrapper })`, so `rerender` keeps the Provider.
  - All exported names and signatures are unchanged. Covered by three new tests in `useController.test.tsx`.
- **Task 8:** `CodeLines` gained an optional prop `noted?: (line) => boolean`, which adds `.has-note` to the mockup's hot line (`#ffffff0d`). The selector `.code-row.has-note:not(.is-selected)` keeps the selection visible over a hot line. Review fix round 1 (the plan's code dropped notes):
  - `MarkdownBlock` attaches a note to the last section that starts at or before the note's end line. Each section covers `[start, next start)`; the first section also takes earlier lines. Notes on blank lines between sections are no longer dropped.
  - `useBlockText` resets to loading when `blobSha` changes.
  - The loading and error states of `MarkdownBlock` keep `<section id>`.
- **Task 9 (review, fix round 1):** the `Chosen` chip uses the mockup's neutral primary chip, not the amber accent. Pros and cons colour the whole line (`--ok` / `--danger`), not just the bullet. The chosen card keeps the amber ring, because spec §9 lists "selected variant" as an amber use.
- **Task 11:** F3 and F12 are implemented as ruled. Review fix round 1 changed two more things:
  - `StageView` renders a `StageBody` keyed by `stageId`, so an open "Request changes" editor and its text are dropped when the stage changes. Otherwise a comment could be sent to the wrong stage.
  - `isTyping` also treats `isContentEditable` targets as typing. This is untested because jsdom does not implement `isContentEditable`.
- **Task 10:** `ThreadView` renders a `ThreadBody` keyed by `threadId`, following the same pattern as `StageBody` in Task 11. The conclusion editors and the composer text therefore reset when the thread changes. A test covers it. The exported signature is unchanged.
- **Task 12:** implemented F4 (restart hint after 10 s in `connecting`), F10 (clipboard error) and F11 (status text only for closed sessions). The manual smoke check was done by the user and found the type too small on wide screens. All font sizes and the reading measures (`--prose-width`, nav width, chrome paddings, code gutters) now use rem relative to a 16px root, so the page is identical at ≤1280 px. The root font size steps up to 17/18/19px at 1440/1728/2200 px. `scale.test.ts` guards against px font sizes.
- **Task 12b (not in the plan; added at the user's request after the live demo):** frontend only, and no existing interface changed.
  - `useFollowBottom`: the view follows new content when you are within 120 px of the bottom or have just sent something; otherwise a `New below ↓` pill appears. The position is re-measured when you switch items, and reduced motion is respected.
  - `deliveryStatus` shows `Sent · waiting for the AI to pick it up` under the latest user message. The replying state is a typing bubble (three dots, `role=status`, name `AI is replying`) at the end of the thread (`isReplying`, `threadIsReplying`).
  - The "working" status gets a pulsing `--working` dot, reconnecting gets a hollow dot, and amber still means only "waiting for you".
  - Auto-advance: after the user accepts (or edits and accepts) a conclusion, the page goes to the next unresolved thread, or to the stage if none is left. It only moves if you are still on that thread. There is an optional `ShortcutEnv.getCurrent`, and the scroll-follow part is chosen variant B.
  - `.thread` uses a rem `max-width`.
  - Task 13's e2e must expect the page to advance after Accept.
- **Task 12b, second demo (user requests):**
  - After any successful user action in the current item (`run`/`sendReview`), the page follows the AI's next reply even when the user is scrolled up.
  - A typing bubble replaces the "AI is replying…" line.
  - The conclusion card keeps only `Accept` and `Edit`. `Discuss`, `What should change?` and `Send feedback` were removed by the user's decision; the composer is the way to push back. The backend `conclusion.discuss` is unchanged.
  - `useFollowBottom` memoizes its return value, so the session context stays stable.
  - The main column is centered, with `--col-width: clamp(61.25rem, 70vw, 110rem)`. The ruling keeps 70vw because the user explicitly asked for a wider column. Prose (`--prose-width`) steps up to 48rem, and the stage view stays at reading width.
  - The root font size is 20px from 2560 px and 22px from 3200 px.
- **Task 13:** the e2e expects auto-advance after Accept: it checks the stage view and the ✓ icon, then goes back and checks the green `Conclusion` card. It asserts the exact `tdm wait` comment section (header, fence, source line, quote), and it removes its temp dirs.

## Final review fixes

- **Dev proxy (I1):** `web/src/dev/proxyPolicy.ts` only forwards the page's own calls: GET sessions, stream, blobs and render, and POST actions. It never forwards `/wait`, `/commands`, `/shutdown` or `POST /api/sessions`. Requests must be same-origin with the dev server, `..` and `%2F` are rejected, and anything else gets a 403 before proxying. Vite runs with `cors: false` and `strictPort: true`.
- **Stable daemon port (I2):** the daemon records its port in `TANDEM_HOME/daemon.port` (0600, never deleted) and reuses it on the next start, falling back to `:0`. It first probes the port so it never binds over a live listener. The origin stays the same across restarts, so the draft in `localStorage` survives. The token is still generated fresh each time, and the bind address is still 127.0.0.1.
- **UI consistency:**
  - The typing bubble is shown only when the AI is not in `tdm wait`, the thread is unresolved, and its `lastUserSeq` has been delivered without a reply.
  - `.main` scrolls to the top on item switch.
  - The line selection is cleared on navigation.
  - The `a` shortcut is ignored while the conclusion editor is open.
  - ⌘/Ctrl↵ in an empty composer sends the draft; the label shows Ctrl↵ off macOS. The composer has an in-flight guard.
  - The dark error toast has ≥4.5:1 contrast.
  - README notes cover the dev server and the e2e prerequisites.
- **Task 12c (user request, demo 3):** clicking a variant's `Choose` only selects it (amber ring, `Selected` with `aria-pressed`). A confirm bar holds the optional comment plus `Send choice` / `Cancel`; ⌘/Ctrl↵ sends and Esc cancels. The selection and the reject editor are mutually exclusive. The comment is kept when you switch the selection (ruling). The e2e selects and then clicks `Send choice`.
