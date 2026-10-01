# Stage Summary Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the stage summary flow decided in the "polishing Tandem's existing features" dogfood session: in-flight guards and a clearer variants bar (A), a clear next step after Accept summary for both the user and the agent (B), Edit → Save → Accept for conclusions and stage summaries (C), collapsible versioned proposal cards (D), and a conversation on the stage page that replaces Request changes (E).

**Architecture:** Go first for each part: the domain gains two user events (`conclusion.revised`, `summary.revised`) and a `stageId` on `message.posted` (plus the user command `stage.message`). Threads and stages keep an `editedByUser` flag, a numbered proposal history and, for stages, their own messages and awaiting-AI seqs. All new JSON fields are `omitempty`, so old logs replay unchanged. `tdm wait` gains a `Next:` line after an accepted summary and new sections for saved edits and stage messages, and the agent guide follows each change. The web UI then adds guarded accepts, the post-accept advance and waiting state (`SessionPage` + `StageView`), the Save editor, a shared `ProposalCard` with an in-memory collapse hook, and a stage page with its own timeline and composer (a `ComposerBox` core shared with the thread composer).

**Tech Stack:** Go 1.x (stdlib, `encoding/json`, cobra), React 19 + TypeScript + Vite, markdown-it 15, Vitest + Testing Library, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-26-stage-summary-flow.md` (decisions export: `docs/superpowers/specs/2026-09-26-dogfood-decisions.md`)

## Global Constraints

- Module path: `github.com/lukaszfiszer/tandem`. Go tests: `go test ./...` from the repo root. Web tests: `cd web && npm test`. Web typecheck: `cd web && npm run typecheck`. E2e: `cd web && npm run e2e` (Task 12 only).
- No new dependencies (Go or npm).
- Old `events.jsonl` logs must replay unchanged. Every new JSON field is `omitempty`. `conclusion.edited`, `stage.accept {text}` (→ `stage.summary.accepted {original}`) and `stage.request_changes` stay decodable and replayable; the UI stops emitting them. An AI thread message still marshals byte for byte to `{"threadId","text"}`.
- Snapshot contract fixture: `go test ./internal/daemon -run TestSnapshotContractFixture`. Task 8 is the only task that changes the state JSON the fixture pins (regenerate with `-update` and commit `web/src/test/fixtures/snapshot.json`). Task 6's `editedByUser` is `omitempty` and absent from the fixture scenario.
- New events (actor user): `conclusion.revised {threadId, text}` and `summary.revised {stageId, text}` (consts `EvConclusionRevised`, `EvSummaryRevised`; payloads `domain.ConclusionRevised`, `domain.SummaryRevised`); `text` is stored trimmed. `message.posted` carries exactly one of `threadId` / `stageId`; on a stage it is either side's, told apart by the event actor. No other event types are added.
- Commands: user `conclusion.revise {threadId, text}` (`domain.ReviseConclusion`), `stage.revise {stageId, text}` (`domain.ReviseStageSummary`), `stage.message {stageId, text}` (`domain.PostStageMessage`); AI `say {threadId?, stageId?, text}` (`domain.Say.StageID`; both ids is `invalid_input`; neither keeps today's latest-open-thread default). A revise is rejected with `no_conclusion_proposed` / `no_summary_proposed` when nothing is proposed (`thread_resolved` on a resolved thread), `invalid_input` on blank text, and the new `text_unchanged` (`domain.CodeTextUnchanged`) when the trimmed text equals the trimmed proposal. Any stage status takes stage messages; only a closed session refuses them.
- State: `Thread.editedByUser` / `Stage.editedByUser` (set by a revise, cleared by every AI re-proposal, accept, resolve, `conclusion.discussion_requested` and `stage.summary.changes_requested`); a revise does not bump `lastUserSeq`. `Thread`/`Stage` gain `proposalVersion` and `proposals: Proposal{text, seq}[]` (`proposals[i]` is version i+1). `Stage` gains `messages`, `lastUserSeq`, `lastAiSeq`; `Stage.AwaitingAI()` is `lastUserSeq > lastAiSeq`, and the stage's `lastAiSeq` is bumped by an AI stage message, `stage.summary.proposed` and `thread.created` in that stage (not by `stage.created`). All TS mirrors are optional fields.
- Web actions: `{ type: 'conclusion.revise'; data: { threadId; text } }`, `{ type: 'stage.revise'; data: { stageId; text } }`, `{ type: 'stage.message'; data: { stageId; text } }` (sent with `ctx.run`). `stage.accept` becomes `{ stageId }` only, and `conclusion.edit` leaves the `Action` union (Task 7).
- `tdm wait`, verbatim:
  - after `## Stage summary — accepted\n\nAccepted as proposed.\n` or `## Stage summary — edited and accepted\n\nFinal summary:\n> …\n` comes a blank line and then ``Next: add the next stage (`tdm stage add`), or tell the user you have nothing more (`tdm say --stage st_N "…"`), then `tdm wait`.`` (no later stage; `st_N` is the accepted stage) or `Next: continue in st_M (already created).` (`st_M` is the next stage), computed from the state at render time. Task 8 keeps both strings unchanged;
  - `## t_N "<title>" — conclusion edited\n\nYour proposal was replaced with:\n> <text>\n` and `## Stage summary — edited\n\nYour proposal was replaced with:\n> <text>\n`;
  - `## Stage st_N — message\n\n> <text>` (no summary proposed) and `## Stage summary — message\n\n> <text>` (summary proposed), under the usual `# Stage st_N "<title>" — X/Y threads resolved` header;
  - `conclusion accepted` keeps `Accepted as proposed.` plus the quoted final text.
- `tdm session show`: a stage line reads `## Stage st_N "<title>" — <status>, awaiting AI` while `Stage.AwaitingAI()`. CLI: `tdm say [text] --stage st_N` prints `st_N`; `--thread` with `--stage` is a usage error (exit 2) `pass --thread or --stage, not both`.
- UI copy, verbatim:
  - Conclusion and stage buttons keep `Accept a` (the `a` in a `<kbd>`), `Edit`, `Accept summary`. While an accept is in flight, the card's action buttons are disabled.
  - Variants: the reject link and the reject editor's submit both read `None of these` (editor label `Why none of these?`). `Reject all` and `None of these…` no longer appear. `Cancel` is disabled and Escape ignored while a choice is sending.
  - Accepted last stage, AI working: a typing bubble `Summary accepted — waiting for the AI's next step…` (also its accessible name); quiet: `Summary accepted — waiting for the AI's next step… AI quiet for <N>m, it may have stopped`. Agent back in `tdm wait` with the accept delivered: `The AI has nothing more planned. Message it, or end the session.` Button `End session`, through the top bar's `onEnd` (same confirm text and `✓ Session ended` toast), hidden once `state.endRequested`. A stage with a later stage shows `Next: <IdChip> →` (`href="#st_M"`).
  - Edit editor submit `Save` (labels `Edit conclusion` / `Edit summary` and `Cancel` unchanged); a saved proposal shows a muted `<span class="edited-by-you">edited by you</span>` in its header. Save with unchanged text closes the editor without sending; a second Save in flight is dropped; Save never auto-advances.
  - Proposal card header: kicker, `· vN` (only N>1), `edited by you`, `Updated`, the actions, and the toggle `Collapse` / `Expand` (`aria-expanded`). Collapsed body: the first sentence (`.proposal-preview`, one line, ellipsis). Earlier versions: closed `<details class="superseded proposal-earlier">` titled `Proposed conclusion · vN` / `Proposed stage summary · vN`. Region names stay `Proposed conclusion` and `Proposed stage summary`; the stage card keeps `data-land="proposed-summary"`.
  - Folded thread list: `Threads (R/N resolved) ▸`, `▾` when unfolded (a button with `aria-expanded`). The stage composer is the thread composer (`Reply` / `Reply…`, `Send`, `Sent · waiting for the AI to pick it up`, bubble `AI is replying`). `Request changes` no longer appears in the UI.
- Auto-advance after Accept summary happens only while the user is still on that stage (the `currentRef` rule of `onResolved`); navigating away cancels it and nothing survives a reload. The "nothing more planned" state needs the accept delivered: an accept made on the page counts only once `state.delivered` exceeds the `state.lastSeq` read at the click.
- Collapse state is in memory, per card, not persisted. The card auto-collapses only after a successful composer send in that thread or stage while a proposal is live, and never auto-expands. `Updated` shows when `proposalVersion` exceeds the version the card was collapsed at; expanding clears it. SessionPage lands on `[data-land="proposed-summary"]` only when the proposed summary text itself changed.
- Motion: bubbles reuse `TypingBubble` / `.typing-dot` (already still under `prefers-reduced-motion`). The `Updated` pill pulses once (`animation: tdm-updated-pulse … 1`) and has `animation: none` under `prefers-reduced-motion`.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 12**. If a build touched it earlier, discard with `git checkout internal/daemon/webdist`.
- Commit messages use conventional style (`feat(web): …`, `feat(domain): …`, `fix(web): …`, `build(web): …`) and carry **no** `Co-Authored-By` or other co-author trailer (confirmed by the user).
- The `a` shortcut accepts through `ConclusionCard`'s guarded `accept()` via `ACCEPT_CONCLUSION_EVENT` (Task 2, step 4b). Tasks 7 and 9 keep that listener when they restructure the card.

## Review Focus

1. **Double accept.** A double click on `Accept` / `Accept summary`, or `Accept` then `Edit`, sends exactly one request; a failed accept re-enables the buttons and does not advance. Pinned in Task 2 (ThreadView "sends a single Accept while one is in flight", "re-enables Accept after a failed accept…", StageView "sends a single Accept summary while one is in flight").
2. **Accepting the last stage while the agent sits in `tdm wait`.** The snapshot can say `waiting: true` before the accept is delivered; the page must not flash "The AI has nothing more planned" in that window, and must not auto-advance once the user has left the stage. Pinned in Task 5 (StageView "keeps the bubble moving after an accept until the agent has picked it up", SessionPage "does not advance to a new stage once the user has left the accepted stage").
3. **Save is not Accept.** No auto-advance, no "awaiting AI" / typing bubble after a Save (`lastUserSeq` untouched); unchanged text, a double Save and an AI re-proposal while the editor is open never send a `text_unchanged` or overwrite an unread proposal; Accept then sends a plain accept of the user's text. Pinned in Task 6 (`TestReviseConclusion`, `TestReviseStageSummary`, `TestWaitRevisedProposals`) and Task 7 (the ThreadView/StageView Save tests).
4. **Old logs.** `conclusion.edited`, an edited `stage.summary.accepted` and an AI `message.posted {"threadId","text"}` replay exactly as before (no `editedByUser`, no stage messages), and a thread message still marshals to the old shape; a stage message never lands in a thread. Pinned in Task 6 (`TestOldEditedEventsReplay`, `TestRevisedJSON`) and Task 8 (`TestMessagePostedShapes`, `TestStageMessages`).
5. **"Awaiting AI" on a stage.** A user stage message stays awaiting (in `tdm session show`, the stage typing bubble and "Sent · waiting…") until the AI acts in that stage (a stage message, a summary proposal or a new thread there); AI activity elsewhere does not clear it. Pinned in Task 8 (`TestShowStageMessageAwaitingAI`, `TestStageMessages`) and Task 10 (`delivery.test.ts` "stage conversation", the StageView bubble tests).

Run the tasks in order. Shared files:
- `internal/domain/{commands,events,state,reducer,decide,errors}.go`, `decide_test.go`, `lifecycle_test.go`: Tasks 6, 8;
- `internal/render/wait.go`, `wait_test.go`: Tasks 4, 6, 8; `internal/render/views.go`, `views_test.go`: Task 8;
- `internal/guide/guide.md`, `guide_test.go`: Tasks 4 (step 7), 6 (steps 5 and 6), 8 (step 6, `Reading tdm wait output`, the command table);
- `docs/superpowers/specs/2026-09-25-tandem-design.md`: Tasks 6, 8;
- `internal/daemon/contract_test.go`, `web/src/test/fixtures/snapshot.json`: Task 8;
- `web/src/api/types.ts`: Tasks 7, 9, 10; `web/src/api/types.test.ts`: Tasks 9, 10;
- `web/src/thread/ConclusionCard.tsx`: Tasks 2, 7, 9; `web/src/thread/ThreadView.tsx`: Task 9; `web/src/thread/ThreadView.test.tsx`: Tasks 2, 7, 9;
- `web/src/stage/StageView.tsx`, `StageView.test.tsx`: Tasks 2, 5, 7, 10, 11;
- `web/src/shell/SessionPage.tsx`: Tasks 3 (comment), 5, 10; `SessionPage.test.tsx`: Task 5; `SessionPage.followBottom.test.tsx`: Task 10;
- `web/src/thread/delivery.ts`, `delivery.test.ts`: Tasks 5, 10; `web/src/session/nav.ts`, `nav.test.ts`: Task 5;
- `web/src/thread/Composer.tsx`, `Composer.test.tsx`: Task 10; `web/src/thread/timeline.ts`, `timeline.test.ts`: Task 9;
- `web/src/styles/app.css`: Tasks 5, 7, 9, 10, 11; `web/src/styles/stage.test.ts`: Tasks 10, 11;
- `web/e2e/loop.spec.ts`: Task 7 (the suite runs in Task 12);
- `docs/ROADMAP.md`: Task 12.


---

### Task 1: Commit this plan and the spec

**Files:**
- Add: `docs/superpowers/plans/2026-09-26-stage-summary-flow.md` (this file)
- Add: `docs/superpowers/specs/2026-09-26-stage-summary-flow.md`
- Add: `docs/superpowers/specs/2026-09-26-dogfood-decisions.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Commit the plan, the spec and the decision export**

```bash
git add docs/superpowers/plans/2026-09-26-stage-summary-flow.md docs/superpowers/specs/2026-09-26-stage-summary-flow.md docs/superpowers/specs/2026-09-26-dogfood-decisions.md
git commit -m "docs(plan): stage summary flow implementation plan

Spec and decision export from the Tandem dogfood session on polishing
existing features."
```

---

### Task 2: In-flight guards on Accept and Accept summary (Part A)

Today the conclusion's `Accept` (`web/src/thread/ConclusionCard.tsx:46-56`) and the stage's `Accept summary` (`web/src/stage/StageView.tsx:96-98`) call `run` straight from `onClick`. A double click sends two events, and the second one fails with `thread_resolved` / `stage_not_proposed`. Both get the guard from `ResolveThread.tsx:46-59`: a ref blocks re-entry, and a `busy` state disables the card's buttons while the event is being sent. On the stage, the Edit editor's accept goes through the same helper. That helper is the one accept path that Task 5 extends.

**Files:**
- Modify: `web/src/thread/ConclusionCard.tsx` (imports line 1, hooks after line 10, the actions at lines 44-61)
- Modify: `web/src/stage/StageView.tsx` (import line 1, `StageBody` hooks after line 26, the helper after line 36, the editor's `onSave` at lines 76-78, the actions at lines 94-106)
- Test: `web/src/thread/ThreadView.test.tsx`, `web/src/stage/StageView.test.tsx`

**Interfaces:**
- Consumes: `SessionCtx.run(action): Promise<boolean>`.
- Produces:
  - In `ConclusionCard`: `busy: boolean` and `accept(): Promise<void>`. While `busy` is true, `Accept` and `Edit` are `disabled`. Tasks 7 and 9 keep these names and `disabled={busy}` on both buttons.
  - In `StageBody`: `accepting: boolean` and `accept(text?: string): Promise<boolean>`. The helper sends `stage.accept {stageId}`, or `{stageId, text}` when `text` is given. It resolves `false` without sending while another accept is in flight. While `accepting` is true, `Accept summary`, `Edit` and `Request changes` are `disabled`. Task 5 adds its success side effects inside `accept`. Task 7 removes the `text` parameter (Edit then saves with `stage.revise`). Tasks 7, 10 and 11 keep routing Accept summary through `accept` and keep `disabled={accepting}` on the summary's buttons.

- [ ] **Step 1: Write the failing tests**

In `web/src/thread/ThreadView.test.tsx`, directly after the test `re-enables Resolve and does not advance when it fails` (it ends around line 224), add:

```tsx
  // Stage summary flow, part A: one conclusion.accept per click. Accept and Edit are disabled
  // while it is in flight, like Resolve above.
  it('sends a single Accept while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, makeCtx({ run }))
    const accept = screen.getByRole('button', { name: /^Accept/ })
    await user.click(accept)
    expect(accept).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    fireEvent.click(accept)
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('re-enables Accept after a failed accept, without advancing', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(onResolved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  })
```

(`act`, `fireEvent`, `vi`, `makeCtx` and `renderWithCtx` are already imported in this file.)

In `web/src/stage/StageView.test.tsx`, change line 2 to:

```tsx
import { act, fireEvent, screen, within } from '@testing-library/react'
```

and append inside `describe('StageView', …)` (before its closing `})` at line 175):

```tsx
  // Stage summary flow, part A: one stage.accept per click. The summary's buttons are disabled
  // while it is in flight, and a failure re-enables them.
  it('sends a single Accept summary while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, run })
    const accept = screen.getByRole('button', { name: 'Accept summary' })
    await user.click(accept)
    expect(accept).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    fireEvent.click(accept)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith({ type: 'stage.accept', data: { stageId: 'st_1' } })
    await act(async () => finish(false))
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/ThreadView.test.tsx src/stage/StageView.test.tsx`
Expected: FAIL. `sends a single Accept while one is in flight` and `sends a single Accept summary while one is in flight` fail at `expect(accept).toBeDisabled()`, because the button stays enabled. (`re-enables Accept after a failed accept…` already passes. It guards the failure path.)

- [ ] **Step 3: Guard the conclusion's Accept**

In `web/src/thread/ConclusionCard.tsx`, change line 1 to:

```tsx
import { useRef, useState } from 'react'
```

Directly after line 10 (`const [mode, setMode] = useState<'view' | 'edit'>('view')`), add the new hooks. They go before the early returns so the hook order never changes:

```tsx
  // In-flight guard (stage summary flow, part A), like ResolveThread's resolve: one
  // conclusion.accept per click, and Accept and Edit are disabled while it is being sent.
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const accept = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (await run({ type: 'conclusion.accept', data: { threadId: thread.id } })) onResolved?.()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
```

Replace the actions block (old lines 44-61, from `{mode === 'view' && !readOnly && (` through its closing `)}`) with:

```tsx
      {mode === 'view' && !readOnly && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void accept()}>
            Accept <kbd>a</kbd>
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setMode('edit')}>
            Edit
          </button>
        </div>
      )}
```

- [ ] **Step 4: Guard Accept summary**

In `web/src/stage/StageView.tsx`, change line 1 to:

```tsx
import { useEffect, useRef, useState } from 'react'
```

In `StageBody`, directly after line 26 (`const [mode, setMode] = useState<SummaryMode>('view')`), add:

```tsx
  const [accepting, setAccepting] = useState(false)
  const acceptInFlight = useRef(false)
```

Directly after the `useEffect` that closes the Edit editor on a re-proposal (it ends at line 36, `}, [stage.proposedSummary])`), add:

```tsx
  // In-flight guard (stage summary flow, part A), like ResolveThread's resolve: one stage.accept
  // at a time, from the button or from the Edit editor, and the summary's buttons are disabled
  // while it is being sent. Resolves false without sending while another accept is in flight.
  const accept = async (text?: string): Promise<boolean> => {
    if (acceptInFlight.current) return false
    acceptInFlight.current = true
    setAccepting(true)
    try {
      return await run({ type: 'stage.accept', data: { stageId: stage.id, ...(text !== undefined ? { text } : {}) } })
    } finally {
      acceptInFlight.current = false
      setAccepting(false)
    }
  }
```

In the Edit editor, replace the `onSave` (old lines 76-78):

```tsx
              onSave={async (text) => {
                if (await run({ type: 'stage.accept', data: { stageId: stage.id, text } })) setMode('view')
              }}
```

with:

```tsx
              onSave={async (text) => {
                if (await accept(text)) setMode('view')
              }}
```

Replace the actions block (old lines 94-106, `{!readOnly && mode === 'view' && (` through its closing `)}`) with:

```tsx
          {!readOnly && mode === 'view' && (
            <div className="actions">
              <button type="button" className="btn primary" disabled={accepting} onClick={() => void accept()}>
                Accept summary
              </button>
              <button type="button" className="btn" disabled={accepting} onClick={() => setMode('edit')}>
                Edit
              </button>
              <button type="button" className="btn" disabled={accepting} onClick={() => setMode('changes')}>
                Request changes
              </button>
            </div>
          )}
```

- [ ] **Step 4b: Route the `a` shortcut through the card's guard**

Added on the user's request after the plan review: `a` must not bypass the in-flight guard. Today `handleShortcut` (`web/src/session/shortcuts.ts:62-74`) calls `ctx.run` itself. Instead it asks the card to accept, the same way `c` asks `ResolveThread` to open its note editor (`RESOLVE_NOTE_EVENT`).

In `web/src/session/shortcuts.ts`, next to `RESOLVE_NOTE_EVENT`, add:

```ts
// ACCEPT_CONCLUSION_EVENT asks the open thread's ConclusionCard to accept its proposal (the `a`
// key), so the key goes through the card's in-flight guard and its onResolved auto-advance.
export const ACCEPT_CONCLUSION_EVENT = 'tdm:accept-conclusion'
```

Replace the body of `case 'a'` with:

```ts
    case 'a': {
      const t = ctx.state.threads[current]
      if (ctx.readOnly || !t || t.status !== 'conclusion_proposed' || isEditingConclusion()) return false
      document.dispatchEvent(new CustomEvent(ACCEPT_CONCLUSION_EVENT, { detail: { threadId: t.id } }))
      return true
    }
```

`getCurrent`, `nextAfterResolve` and the `currentRef` in `useShortcuts` are then unused by `a`. Remove whatever becomes dead: `select` stays for j/k. The "advance only if still current" rule now lives in `SessionPage.onResolved`, which the card calls.

In `web/src/thread/ConclusionCard.tsx`, add `useEffect` to the React import, import `ACCEPT_CONCLUSION_EVENT` from `'../session/shortcuts'`, and after the `accept` helper add:

```tsx
  // The `a` shortcut (Task 2, step 4b): accept through the same guard as the button. A key press
  // while an accept is in flight, or while the Edit editor is open, is ignored.
  useEffect(() => {
    const onKey = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail?.threadId !== thread.id) return
      if (mode !== 'view') return
      void accept()
    }
    document.addEventListener(ACCEPT_CONCLUSION_EVENT, onKey)
    return () => document.removeEventListener(ACCEPT_CONCLUSION_EVENT, onKey)
  })
```

(No dependency array: the listener must always see the current `mode` and `accept`. `accept` already returns early while `inFlight.current` is set.) Place the hook before any early `return` in the component so hook order stays stable, and bail out inside the listener when `thread.status !== 'conclusion_proposed'` or `readOnly`.

Tests:
- In `web/src/session/shortcuts.test.ts`, rewrite the `a` tests at lines 28-71. The true/false return cases (lines 28-42) stay. The advance tests (lines 52-71) become one test: `a` dispatches `ACCEPT_CONCLUSION_EVENT` with `{ threadId: 't_2' }` (spy with `document.addEventListener`) and does **not** call `ctx.run`.
- In `web/src/thread/ThreadView.test.tsx`, next to the new Accept tests, add `'accepts once when a is pressed twice while the first accept is in flight'`. Render `t_2` with a pending `run` like `sends a single Accept while one is in flight`, then dispatch `new CustomEvent(ACCEPT_CONCLUSION_EVENT, { detail: { threadId: 't_2' } })` on `document` twice (inside `act`). Expect `run` to have been called once, then `finish(true)` and expect `onResolved` once.
- The `SessionPage` test `does not advance after Accept resolves if the user already navigated elsewhere` must still pass. If it drove the `a` key, it now goes through the card's `onResolved`.

Add `web/src/session/shortcuts.ts` and `web/src/session/shortcuts.test.ts` to the Step 6 `git add`.

- [ ] **Step 5: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. The existing tests still pass: `accepts a proposed summary or requests changes` (a plain accept still sends exactly `{ stageId: 'st_1' }`), `edits a proposed summary and accepts the edited text` (the editor still sends `{ stageId, text }`), `SessionPage` `advances to the next open thread once accepting a proposed conclusion succeeds (F12b-4)`, and `does not advance after Accept resolves if the user already navigated elsewhere`.

- [ ] **Step 6: Commit**

```bash
git add web/src/thread/ConclusionCard.tsx web/src/stage/StageView.tsx web/src/thread/ThreadView.test.tsx web/src/stage/StageView.test.tsx web/src/session/shortcuts.ts web/src/session/shortcuts.test.ts
git commit -m "fix(web): send Accept and Accept summary once per click

Both buttons (and Edit next to them) are disabled while the accept is in
flight, like Resolve; a failed accept re-enables them."
```

---

### Task 3: Variants action bar: no Cancel mid-send, one name for rejecting all (Part A)

In `web/src/blocks/VariantsBlock.tsx`, `Send choice` and `Choose & resolve` are already disabled while `pending` (lines 117-122). `Cancel` (lines 123-125) and the textarea's Escape (lines 110-113) are not. Either one can clear the selection and comment while the choice is still being sent, so a failed send loses both. The reject action also has two names: the link says `None of these…` (line 132) and the editor's submit says `Reject all` (line 139). Both now read `None of these`.

**Files:**
- Modify: `web/src/blocks/VariantsBlock.tsx` (Escape at lines 110-113, Cancel at lines 123-125, the link at line 132, `submitLabel` at line 139)
- Modify: `web/src/shell/SessionPage.tsx` (comment at line 45 only)
- Test: `web/src/blocks/VariantsBlock.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the reject link and the reject editor's submit button are both named `None of these`. `Cancel` is `disabled` while a choice is pending, and Escape in the comment box does nothing while one is pending.

- [ ] **Step 1: Write the failing tests**

In `web/src/blocks/VariantsBlock.test.tsx`, change line 2 to:

```tsx
import { act, fireEvent, screen, within } from '@testing-library/react'
```

Rename the button in the existing tests:
- in `opening the reject editor clears any pending selection` (line 124), `selecting an option closes the reject editor` (line 133) and `offers no actions once the thread is resolved` (line 185), replace `'None of these…'` with `'None of these'`;
- replace the whole test `rejects all options with a reason` (lines 139-146) with:

```tsx
  // Stage summary flow, part A: the link and the editor's submit share one name.
  it('rejects all options with a reason, under one name: None of these', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<VariantsBlock block={b3()} />)
    await user.click(screen.getByRole('button', { name: 'None of these' }))
    await user.type(screen.getByRole('textbox', { name: 'Why none of these?' }), 'Both leak memory')
    expect(screen.queryByRole('button', { name: 'Reject all' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'None of these' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'variants.reject', data: { blockId: 'b_3', comment: 'Both leak memory' } })
  })
```

After the test `disables Send choice while a request is in flight` (it ends at line 117), add:

```tsx
  // Stage summary flow, part A: neither Cancel nor Escape can drop the selection while the choice
  // is being sent, so a failed send leaves the choice and the comment to retry.
  it('disables Cancel, and ignores Escape, while a choice is sending', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    let resolve!: (v: boolean) => void
    vi.mocked(ctx.run).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    const box = screen.getByRole('textbox', { name: 'Comment for your choice (optional)' })
    await user.type(box, 'keep it')
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(empty).toHaveClass('is-selected')
    await act(async () => resolve(false))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(empty).toHaveClass('is-selected')
    expect(box).toHaveValue('keep it')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/blocks/VariantsBlock.test.tsx`
Expected: FAIL. The renamed tests find no button named `None of these` (the link still reads `None of these…`). `disables Cancel, and ignores Escape, while a choice is sending` fails at `expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()`.

- [ ] **Step 3: Implement**

In `web/src/blocks/VariantsBlock.tsx`, replace the Escape branch of the textarea's `onKeyDown` (lines 110-113):

```tsx
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
```

with:

```tsx
              } else if (e.key === 'Escape') {
                e.preventDefault()
                // Like the Cancel button: the selection stays while the choice is being sent.
                if (!pending) cancel()
              }
```

Replace the Cancel button (lines 123-125):

```tsx
            <button type="button" className="btn small" disabled={pending} onClick={cancel}>
              Cancel
            </button>
```

Replace the link's text at line 132 (`None of these…`) with `None of these`, and the editor's `submitLabel="Reject all"` at line 139 with:

```tsx
          submitLabel="None of these"
```

In `web/src/shell/SessionPage.tsx` line 45, change the comment's `"Reject all"` to `"None of these"`. The line becomes:

```tsx
  // if the user isn't near it (choosing a variant, "None of these", "Request changes" and the top
```

- [ ] **Step 4: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. `grep -rn --exclude='*.test.tsx' "Reject all\|None of these…" web/src` prints nothing. (The test file still names `Reject all` once, in the `queryByRole(…)` check that it is gone.)

- [ ] **Step 5: Commit**

```bash
git add web/src/blocks/VariantsBlock.tsx web/src/blocks/VariantsBlock.test.tsx web/src/shell/SessionPage.tsx
git commit -m "fix(web): keep a sending variant choice, and name rejecting all once

Cancel is disabled and Escape is ignored while a choice is in flight.
The reject link and its editor's submit both read \"None of these\"."
```

---

### Task 4: `tdm wait` tells the agent its next step after an accepted stage summary, and guide step 7 (Part B, agent side)

After `## Stage summary — accepted` the agent gets no prompt to act. In the dogfood session it went straight back to `tdm wait` and the user sat on an accepted stage with nothing happening. `render/wait.go` now appends one `Next:` line to both accepted forms. The line depends on whether a stage already follows the accepted one in the state `tdm wait` renders from. Guide step 7 says to act in the same turn.

The line names `tdm say --stage`, which Task 8 adds. This follows the fixed interface. Both strings stay as written here when Task 8 lands.

**Files:**
- Modify: `internal/render/wait.go` (the `case domain.EvStageSummaryAccepted:` block at lines 152-160, plus a new helper `nextStep`)
- Modify: `internal/guide/guide.md` (step 7, lines 51-54)
- Test: `internal/render/wait_test.go`, `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: `domain.State.Stages` (ordered), `domain.StageSummaryAccepted{StageID, Text, Original}`.
- Produces:
  - `func nextStep(s *domain.State, stageID string) string` (package `render`, unexported). It returns the `Next:` line with a trailing `\n`.
  - `tdm wait` block for an accepted summary: `<existing body>` + `"\n"` + `nextStep(...)`. For example, `## Stage summary — accepted\n\nAccepted as proposed.\n\nNext: continue in st_2 (already created).\n`.
  - The guide's step 7 contains `never go back to \`tdm wait\` silently`, `` `Next:` ``, `add its first thread` and `tdm say --stage st_N`.

- [ ] **Step 1: Write the failing render test**

Append to `internal/render/wait_test.go`:

```go
// Stage summary flow, part B: after an accepted stage summary, tdm wait ends the stage's section
// with the agent's next step, so it never returns to tdm wait silently. With no later stage it
// offers both ways on; with one already created it points there. The edited form gets the same
// line.
func TestWaitStageAcceptedNextStep(t *testing.T) {
	build := func(text string, laterStage bool) string {
		cmds := []domain.Command{
			&domain.AddStage{Title: "API"},
			&domain.AddThread{Title: "Endpoints"},
			&domain.ResolveThread{ThreadID: "t_1"},
			&domain.ProposeStageSummary{Text: "REST."},
		}
		if laterStage {
			cmds = append(cmds, &domain.AddStage{Title: "Storage"})
		}
		cmds = append(cmds, &domain.AcceptStageSummary{StageID: "st_1", Text: text})
		st, events := domaintest.Build(t, cmds...)
		got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	const addNext = "Next: add the next stage (`tdm stage add`), or tell the user you have nothing more (`tdm say --stage st_1 \"…\"`), then `tdm wait`.\n"
	cases := []struct {
		name, text string
		later      bool
		want       string
	}{
		{"accepted, last stage", "", false, "## Stage summary — accepted\n\nAccepted as proposed.\n\n" + addNext},
		{"edited, last stage", "REST under /v1.", false, "## Stage summary — edited and accepted\n\nFinal summary:\n> REST under /v1.\n\n" + addNext},
		{"accepted, later stage", "", true, "## Stage summary — accepted\n\nAccepted as proposed.\n\nNext: continue in st_2 (already created).\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := build(tc.text, tc.later)
			if !strings.Contains(got, tc.want) {
				t.Fatalf("missing %q in:\n%s", tc.want, got)
			}
			if strings.Count(got, "Next:") != 1 {
				t.Fatalf("want exactly one Next: line in:\n%s", got)
			}
		})
	}
}
```

- [ ] **Step 2: Write the failing guide test**

Append to `internal/guide/guide_test.go`:

```go
// Stage summary flow, part B: after an accepted summary the agent acts in the same turn (a new
// stage with its first thread, or a one-line wrap-up on the stage), never a silent tdm wait.
func TestGuideActsAfterAcceptedSummary(t *testing.T) {
	for _, s := range []string{"never go back to `tdm wait` silently", "`Next:`", "add its first thread", "tdm say --stage st_N"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/render/ ./internal/guide/`
Expected: FAIL. `TestWaitStageAcceptedNextStep` fails in all three subtests with `missing "## Stage summary — accepted\n\nAccepted as proposed.\n\nNext: …`. `TestGuideActsAfterAcceptedSummary` fails with `guide.md does not mention "never go back to `tdm wait` silently"` (and the other three strings).

- [ ] **Step 4: Append the `Next:` line in `tdm wait`**

In `internal/render/wait.go`, replace the `case domain.EvStageSummaryAccepted:` block (lines 152-160) with:

```go
	case domain.EvStageSummaryAccepted:
		var p domain.StageSummaryAccepted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		body := "## Stage summary — accepted\n\nAccepted as proposed.\n"
		if p.Original != "" {
			body = "## Stage summary — edited and accepted\n\nFinal summary:\n" + Quote(p.Text)
		}
		return []section{{p.StageID, body + "\n" + nextStep(s, p.StageID)}}, nil
```

After `func threadSection` (it ends at line 55), add:

```go
// nextStep is the agent's next move after the user accepted stageID's summary (stage summary
// flow, part B): continue in the stage that already follows it, or add one or say there is
// nothing more. It reads the state tdm wait renders from, so a stage added before the wait
// returned counts.
func nextStep(s *domain.State, stageID string) string {
	for i, st := range s.Stages {
		if st.ID == stageID && i+1 < len(s.Stages) {
			return fmt.Sprintf("Next: continue in %s (already created).\n", s.Stages[i+1].ID)
		}
	}
	return fmt.Sprintf("Next: add the next stage (`tdm stage add`), or tell the user you have nothing more (`tdm say --stage %s \"…\"`), then `tdm wait`.\n", stageID)
}
```

- [ ] **Step 5: Update guide step 7**

In `internal/guide/guide.md`, replace step 7 (lines 51-54):

```markdown
7. After `stage summary — accepted` or `stage summary — edited and accepted`, add the next stage. An edited
   summary quotes the user's final text: that text, not your proposal, is the stage summary, and it
   is what `tdm export` writes. On `# Session — end requested`, run `tdm export --out <path>` if the
   user wants a document, then `tdm session close`.
```

with:

```markdown
7. After `stage summary — accepted` or `stage summary — edited and accepted`, act in the same turn:
   never go back to `tdm wait` silently. The event ends with a `Next:` line.
   - If more work is planned, run `tdm stage add` and add its first thread (`tdm thread add`) in the same turn.
   - `Next: continue in st_M (already created)` means the next stage exists: continue there.
   - Otherwise send a one-line wrap-up with `tdm say --stage st_N "…"` and offer to export.

   An edited summary quotes the user's final text: that text, not your proposal, is the stage summary, and it
   is what `tdm export` writes. On `# Session — end requested`, run `tdm export --out <path>` if the
   user wants a document, then `tdm session close`.
```

(`TestGuideCoversEditedStageSummaryAndIds` still finds `stage summary — edited and accepted` and ``is what `tdm export` writes``, each on one line.)

- [ ] **Step 6: Run the Go tests**

Run: `gofmt -l internal; go test ./...`
Expected: `gofmt` lists no files. PASS, including the existing `TestWaitStageSummaryEdited` (it checks with `strings.Contains`), `e2e/TestFullLoop` (it checks that `## Stage summary — accepted` is contained), and `TestSnapshotContractFixture` (the state JSON is unchanged).

- [ ] **Step 7: Commit**

```bash
git add internal/render/wait.go internal/render/wait_test.go internal/guide/guide.md internal/guide/guide_test.go
git commit -m "feat(render): tell the agent its next step after an accepted stage summary

tdm wait ends an accepted (or edited and accepted) stage summary with a
Next: line: continue in the stage that already follows, or add one or
say there is nothing more. Guide step 7: act in the same turn, never a
silent tdm wait."
```

---

### Task 5: Web: after Accept summary, advance or wait for the AI's next step (Part B, UI)

After `Accept summary` succeeds, `StageView` calls a new `onAccepted` prop. `SessionPage` records the accepted stage as the one to advance from. An effect then moves to `nextAfterStageAccept(state, stageId)`. It does so at once if a later stage exists, or as soon as the AI adds one. The advance is cancelled when `current` changes, which is the same `currentRef` rule as `onResolved`.

The accepted box on the session's last stage shows the stage's waiting state:
- a typing bubble while the AI works (same rules as `stageAwaitsSummary`'s bubble);
- the still text once the agent is back in `tdm wait` with the accept delivered;
- and, in both cases, `End session`, which is the top bar's `onEnd` passed down as a prop.

Once a later stage exists, the box shows `Next: <chip> →` instead.

`onEnd` is passed as a prop, not through `SessionCtx`, because `onEnd` is built from `ctx` in `SessionPage` (line 133). Putting it into `ctx` would make the context depend on itself.

**Files:**
- Modify: `web/src/thread/delivery.ts` (type import line 1; add `stageAwaitsNextStep` after line 55)
- Modify: `web/src/session/nav.ts` (add `nextAfterStageAccept` after `nextAfterResolve`, line 63)
- Modify: `web/src/stage/StageView.tsx` (imports lines 4 and 7, constants after line 11, `StageView` lines 13-18, `StageBody` signature line 24, the `accept` helper from Task 2, the accepted box lines 61-66)
- Modify: `web/src/shell/SessionPage.tsx` (import line 6, the new advance state and effect after `onResolved` at lines 157-162, the `StageView` render at line 172)
- Modify: `web/src/styles/app.css` (add `.stage-next` after line 360)
- Test: `web/src/thread/delivery.test.ts`, `web/src/session/nav.test.ts`, `web/src/stage/StageView.test.tsx`, `web/src/shell/SessionPage.test.tsx`

**Interfaces:**
- Consumes:
  - `accept(text?)` and `accepting` in `StageBody` (Task 2);
  - `TypingBubble({ quietMinutes, label, text })`, `IdChip({ id, title })`;
  - `SessionCtx.waiting`, `quietMinutes`, `readOnly`, `state.delivered`, `state.lastSeq`, `state.endRequested`;
  - `onEnd` in `SessionPage`.
- Produces:
  - `stageAwaitsNextStep(state: State, stage: Stage): boolean` (`thread/delivery.ts`): the stage is `accepted`, it is `state.stages.at(-1)`, and `state.session.status !== 'closed'`;
  - `nextAfterStageAccept(state: State, stageId: string): string | null` (`session/nav.ts`): for the stage right after `stageId`, its first thread that is not resolved, else that stage's id; `null` when no stage follows (or `stageId` is unknown);
  - `StageView({ stageId, onAccepted, onEnd }: { stageId: string; onAccepted?: () => void; onEnd?: () => void })`;
  - the accepted box is a region named `Stage summary`, and it may contain `Next: <IdChip> →` (class `stage-next`), the bubble or the still text, and `End session`.

- [ ] **Step 1: Write the failing unit tests**

In `web/src/thread/delivery.test.ts`, change the imports (lines 2-3) to:

```ts
import type { Stage, Thread } from '../api/types'
import { fixtureSnapshot } from '../test/session'
import { deliveryStatus, isReplying, isUndelivered, stageAwaitsNextStep, stageAwaitsSummary, threadIsReplying } from './delivery'
```

and append:

```ts
describe('stageAwaitsNextStep (stage summary flow, part B)', () => {
  const { state } = fixtureSnapshot() // st_1 (open), st_2 (open, the last stage)
  const acceptedLast: Stage = { ...state.stages[1], status: 'accepted', summary: 'Done.' }

  it('is true for the accepted last stage of an open session', () => {
    expect(stageAwaitsNextStep({ ...state, stages: [state.stages[0], acceptedLast] }, acceptedLast)).toBe(true)
  })

  it('is false for an earlier stage, a last stage not yet accepted, or a closed session', () => {
    const acceptedFirst: Stage = { ...state.stages[0], status: 'accepted', summary: 'Done.' }
    expect(stageAwaitsNextStep({ ...state, stages: [acceptedFirst, state.stages[1]] }, acceptedFirst)).toBe(false)
    expect(stageAwaitsNextStep(state, state.stages[1])).toBe(false)
    const closed = { ...state, session: { ...state.session, status: 'closed' as const }, stages: [state.stages[0], acceptedLast] }
    expect(stageAwaitsNextStep(closed, acceptedLast)).toBe(false)
  })
})
```

In `web/src/session/nav.test.ts`, change line 3 to:

```ts
import { anchorOf, defaultItem, isValidItem, navOrder, nextAfterResolve, nextAfterStageAccept, statusIcon, useCurrentItem } from './nav'
```

add `import type { Stage } from '../api/types'` below it, and add inside `describe('nav', …)` after the `nextAfterResolve` test (it ends at line 55):

```ts
  it('after a stage is accepted, opens the next stage: its first unresolved thread, else its page (stage summary flow B)', () => {
    const { state } = fixtureSnapshot()
    expect(nextAfterStageAccept(state, 'st_1')).toBe('st_2') // st_2 has no threads yet
    expect(nextAfterStageAccept(state, 'st_2')).toBeNull() // the last stage
    expect(nextAfterStageAccept(state, 'st_9')).toBeNull()

    const setup: Stage = { id: 'st_0', title: 'Setup', status: 'accepted', threadIds: [] }
    const withSetup = { ...state, stages: [setup, ...state.stages] }
    expect(nextAfterStageAccept(withSetup, 'st_0')).toBe('t_1')
    const t1Resolved = { ...withSetup, threads: { ...state.threads, t_1: { ...state.threads.t_1, status: 'resolved' as const } } }
    expect(nextAfterStageAccept(t1Resolved, 'st_0')).toBe('t_2')
    const allResolved = {
      ...t1Resolved,
      threads: {
        ...t1Resolved.threads,
        t_2: { ...state.threads.t_2, status: 'resolved' as const },
        t_3: { ...state.threads.t_3, status: 'resolved' as const },
      },
    }
    expect(nextAfterStageAccept(allResolved, 'st_0')).toBe('st_1')
  })
```

- [ ] **Step 2: Write the failing StageView tests**

Append to `web/src/stage/StageView.test.tsx`:

```tsx
describe('StageView after Accept summary (stage summary flow, part B)', () => {
  const NEXT_PENDING = "Summary accepted — waiting for the AI's next step…"
  const NOTHING_MORE = 'The AI has nothing more planned. Message it, or end the session.'
  // st_1 accepted. With last (the default), st_2 is dropped, so st_1 is the session's last stage.
  function accepted(over: Partial<SessionCtx> = {}, { last = true } = {}) {
    const base = makeCtx(over)
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.' }
    if (last) base.state.stages.pop()
    return base
  }

  it('waits for the AI with a typing bubble and offers End session on the last stage', async () => {
    const user = userEvent.setup()
    const onEnd = vi.fn()
    const { container } = renderStateful(<StageView stageId="st_1" onEnd={onEnd} />, accepted())
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByRole('status', { name: NEXT_PENDING })).toHaveTextContent(NEXT_PENDING)
    expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
    await user.click(within(box).getByRole('button', { name: 'End session' }))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('goes still when the agent is back in tdm wait with nothing planned', () => {
    const { container } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, accepted({ waiting: true }))
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByText(NOTHING_MORE)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('.typing-dot')).toBeNull()
    expect(within(box).getByRole('button', { name: 'End session' })).toBeInTheDocument()
  })

  it('says the AI went quiet after 10 minutes', () => {
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, accepted({ quietMinutes: 12 }))
    expect(screen.getByRole('status')).toHaveTextContent(`${NEXT_PENDING} AI quiet for 12m, it may have stopped`)
  })

  it('keeps the bubble moving after an accept until the agent has picked it up', async () => {
    const user = userEvent.setup()
    const base = accepted({ waiting: true })
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', summary: undefined, proposedSummary: 'We keep a JSONL log.' }
    // Explicit seqs, so the test does not depend on the fixture's lastSeq (Task 8 changes it).
    base.state.lastSeq = 40
    base.state.delivered = 40
    const { rerender } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    await user.click(screen.getByRole('button', { name: 'Accept summary' })) // state.lastSeq is 40 at the click
    // The accepted snapshot arrives while the agent's tdm wait is still delivering the accept.
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.', proposedSummary: undefined }
    rerender(<StageView stageId="st_1" onEnd={vi.fn()} />)
    expect(screen.getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    // tdm wait delivered the accept (seq 41) and the agent is back in tdm wait.
    base.state.delivered = 41
    rerender(<StageView stageId="st_1" onEnd={vi.fn()} />)
    expect(screen.getByText(NOTHING_MORE)).toBeInTheDocument()
  })

  it('links the next stage, with no bubble and no End session, once one exists', () => {
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, accepted({}, { last: false }))
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(box).toHaveTextContent('Next: API →')
    expect(within(box).getByRole('link', { name: 'API' })).toHaveAttribute('href', '#st_2')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })

  it('shows neither the bubble nor End session on a closed session, and no End session once the end is requested', () => {
    const closed = accepted({ readOnly: true })
    closed.state.session = { ...closed.state.session, status: 'closed' }
    const first = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, closed)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
    first.unmount()

    const ending = accepted()
    ending.state.endRequested = true
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, ending)
    expect(screen.getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })

  it('calls onAccepted once Accept summary succeeds, not when it fails', async () => {
    const user = userEvent.setup()
    const onAccepted = vi.fn()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const ok = renderStateful(<StageView stageId="st_1" onAccepted={onAccepted} />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(onAccepted).toHaveBeenCalledTimes(1)
    ok.unmount()

    renderStateful(<StageView stageId="st_1" onAccepted={onAccepted} />, { state: base.state, run: vi.fn(async () => false) })
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Write the failing SessionPage tests**

In `web/src/shell/SessionPage.test.tsx`, change line 2 to:

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react'
```

After `const load = …` (line 27), add:

```tsx
const emit = (json: string) => act(() => FakeEventSource.instances.at(-1)!.emit('state', json))
// Every thread of st_1 resolved, st_1's summary proposed or accepted. Without `later`, st_2 is
// dropped, so st_1 is the last stage.
function stageSnap(status: 'summary_proposed' | 'accepted', later: boolean): string {
  const snap = structuredClone(fixture) as typeof fixture
  for (const id of ['t_1', 't_2', 't_3'] as const) snap.state.threads[id].status = 'resolved'
  Object.assign(
    snap.state.stages[0],
    status === 'accepted' ? { status, summary: 'We keep a JSONL log.' } : { status, proposedSummary: 'We keep a JSONL log.' },
  )
  if (!later) snap.state.stages.pop()
  return JSON.stringify(snap)
}
```

and add inside `describe('SessionPage', …)`, after the test `does not advance after Accept resolves if the user already navigated elsewhere (fix round 1, Important)` (it ends at line 157):

```tsx
  // Stage summary flow, part B: Accept summary moves on to the next stage, at once when it exists.
  it('advances to the next stage once Accept summary succeeds', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('summary_proposed', true))
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    // st_2 has no threads yet, so its stage page opens.
    expect(await screen.findByRole('heading', { level: 1, name: 'API' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#st_2')
  })

  it('waits on the last stage after Accept summary, then advances when the AI adds a stage', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('summary_proposed', false))
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    emit(stageSnap('accepted', false))
    expect(screen.getByRole('heading', { level: 1, name: 'Data model' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: "Summary accepted — waiting for the AI's next step…" })).toBeInTheDocument()
    emit(stageSnap('accepted', true))
    expect(await screen.findByRole('heading', { level: 1, name: 'API' })).toBeInTheDocument()
  })

  it('does not advance to a new stage once the user has left the accepted stage', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('summary_proposed', false))
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    emit(stageSnap('accepted', false))
    await userEvent.keyboard('j')
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    emit(stageSnap('accepted', true))
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
  })

  it("ends the session from the accepted last stage through the top bar's path", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('accepted', false))
    const box = screen.getByRole('region', { name: 'Stage summary' })
    await userEvent.click(within(box).getByRole('button', { name: 'End session' }))
    expect(window.confirm).toHaveBeenCalledWith('End this session? The AI will wrap up and export.')
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/actions'))!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ type: 'session.end', data: {} })
    expect(await screen.findByText('✓ Session ended')).toBeInTheDocument()
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/delivery.test.ts src/session/nav.test.ts src/stage/StageView.test.tsx src/shell/SessionPage.test.tsx`
Expected: FAIL.
- `delivery.test.ts` and `nav.test.ts` fail on the missing exports: `stageAwaitsNextStep is not a function` and `nextAfterStageAccept is not a function`.
- The new StageView tests find no region named `Stage summary`.
- The new SessionPage tests find no heading `API` and no region `Stage summary`.
- `does not advance to a new stage once the user has left…` already passes. It is the regression guard for the `currentRef` rule.

- [ ] **Step 5: Add the predicates**

In `web/src/thread/delivery.ts`, change line 1 to:

```ts
import type { Stage, State, Thread } from '../api/types'
```

and append:

```ts
// stageAwaitsNextStep is true while the page waits on the AI after the user accepted the last
// stage's summary (stage summary flow, part B): the stage is accepted, no stage follows it, and
// the session is open. StageView then shows "Summary accepted — waiting for the AI's next step…"
// under stageAwaitsSummary's bubble rules (still while the agent sits in tdm wait, the quiet state
// after AGENT_QUIET_MS), and End session.
export function stageAwaitsNextStep(state: State, stage: Stage): boolean {
  return stage.status === 'accepted' && state.stages.at(-1)?.id === stage.id && state.session.status !== 'closed'
}
```

In `web/src/session/nav.ts`, after `nextAfterResolve` (it ends at line 63), add:

```ts
// nextAfterStageAccept picks what to show after the user accepts stageId's summary (stage summary
// flow, part B): the first unresolved thread of the stage right after it, else that stage's page.
// null while no stage follows it: the page then waits for the AI to add one.
export function nextAfterStageAccept(state: State, stageId: string): string | null {
  const i = state.stages.findIndex((s) => s.id === stageId)
  const next = i < 0 ? undefined : state.stages[i + 1]
  if (!next) return null
  return next.threadIds.find((id) => id in state.threads && state.threads[id].status !== 'resolved') ?? next.id
}
```

- [ ] **Step 6: Show the waiting state in the accepted box**

In `web/src/stage/StageView.tsx`:

Change line 4 to `import { AgentText, IdChip } from '../refs/IdChip'` and line 7 to:

```tsx
import { stageAwaitsNextStep, stageAwaitsSummary } from '../thread/delivery'
```

After line 11 (`const SUMMARY_PENDING = …`), add:

```tsx
const NEXT_PENDING = "Summary accepted — waiting for the AI's next step…"
const NOTHING_MORE = 'The AI has nothing more planned. Message it, or end the session.'
```

Replace `StageView` (lines 13-18) with:

```tsx
// onAccepted runs after Accept summary succeeds: SessionPage then moves on to the next stage
// (stage summary flow, part B). onEnd is the top bar's End session, offered in the accepted box
// of the last stage.
export function StageView({ stageId, onAccepted, onEnd }: { stageId: string; onAccepted?: () => void; onEnd?: () => void }) {
  const { state } = useSessionCtx()
  // Keyed on stageId so per-stage UI state (e.g. the "Request changes" editor below) resets
  // when the caller switches stages without remounting StageView itself.
  return <StageBody key={stageId} stageId={stageId} state={state} onAccepted={onAccepted} onEnd={onEnd} />
}
```

Change the `StageBody` signature (line 24) to:

```tsx
function StageBody({
  stageId,
  state,
  onAccepted,
  onEnd,
}: {
  stageId: string
  state: State
  onAccepted?: () => void
  onEnd?: () => void
}) {
```

Next to the `accepting` state from Task 2, add:

```tsx
  // state.lastSeq when this page's accept was sent; null if the stage was accepted before the page
  // loaded. See `still` below.
  const [acceptedAfter, setAcceptedAfter] = useState<number | null>(null)
```

Replace the `accept` helper from Task 2 with:

```tsx
  // In-flight guard (stage summary flow, part A), like ResolveThread's resolve: one stage.accept
  // at a time, from the button or from the Edit editor, and the summary's buttons are disabled
  // while it is being sent. Resolves false without sending while another accept is in flight.
  // On success it remembers the seq it was sent after and lets the page move on (part B).
  const accept = async (text?: string): Promise<boolean> => {
    if (acceptInFlight.current) return false
    acceptInFlight.current = true
    setAccepting(true)
    const before = state.lastSeq
    try {
      const ok = await run({ type: 'stage.accept', data: { stageId: stage.id, ...(text !== undefined ? { text } : {}) } })
      if (ok) {
        setAcceptedAfter(before)
        onAccepted?.()
      }
      return ok
    } finally {
      acceptInFlight.current = false
      setAccepting(false)
    }
  }
```

After `const awaitsSummary = stageAwaitsSummary(stage, threads)` (line 31), add:

```tsx
  const nextStage = state.stages[index + 1]
  const awaitsNext = stageAwaitsNextStep(state, stage)
  // The bubble goes still once the agent is back in tdm wait with nothing planned. Right after an
  // accept made here, the agent can still be in the tdm wait that is about to deliver it, so that
  // accept counts only once `delivered` has passed the seq it was sent after.
  const still = waiting && (acceptedAfter === null || state.delivered > acceptedAfter)
```

Replace the accepted box (lines 61-66):

```tsx
      {stage.status === 'accepted' && (
        <section className="conclusion is-resolved">
          <div className="kicker">Stage summary</div>
          <Prose text={stage.summary ?? ''} />
        </section>
      )}
```

with:

```tsx
      {stage.status === 'accepted' && (
        <section className="conclusion is-resolved" aria-label="Stage summary">
          <div className="kicker">Stage summary</div>
          <Prose text={stage.summary ?? ''} />
          {nextStage ? (
            <p className="stage-next">
              Next: <IdChip id={nextStage.id} title={nextStage.title} /> →
            </p>
          ) : (
            !readOnly &&
            awaitsNext && (
              <>
                {still ? (
                  <p className="muted">{NOTHING_MORE}</p>
                ) : (
                  <TypingBubble quietMinutes={quietMinutes} label={NEXT_PENDING} text={NEXT_PENDING} />
                )}
                {onEnd && !state.endRequested && (
                  <div className="actions">
                    <button type="button" className="btn" onClick={onEnd}>
                      End session
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </section>
      )}
```

In `web/src/styles/app.css`, after `.conclusion .comment-editor { margin-top: 12px; }` (line 360), add:

```css
.stage-next { margin: 10px 0 0; font: 0.8125rem var(--font-ui); }
```

- [ ] **Step 7: Advance from SessionPage**

In `web/src/shell/SessionPage.tsx`, change line 6 to:

```tsx
import { nextAfterResolve, nextAfterStageAccept, useCurrentItem } from '../session/nav'
```

After `onResolved` (it ends at line 162), add:

```tsx
  // Stage summary flow, part B: after the user accepts a stage summary, move on to the next
  // stage (its first unresolved thread, else its page) as soon as one exists: at once, or when
  // the AI adds it while the user is still on this stage. Like onResolved, it only applies while
  // the user is still on the stage they accepted. Navigating away drops it, and nothing survives
  // a reload.
  const [advanceFrom, setAdvanceFrom] = useState<string | null>(null)
  const onStageAccepted = useCallback(() => {
    if (currentRef.current === current) setAdvanceFrom(current)
  }, [current])
  useEffect(() => {
    if (!advanceFrom) return
    if (current !== advanceFrom) {
      setAdvanceFrom(null)
      return
    }
    const next = nextAfterStageAccept(snapshot.state, advanceFrom)
    if (!next) return
    setAdvanceFrom(null)
    select(next)
  }, [advanceFrom, current, snapshot.state, select])
```

Replace line 172, `<StageView stageId={current} />`, with:

```tsx
              <StageView stageId={current} onAccepted={onStageAccepted} onEnd={onEnd} />
```

- [ ] **Step 8: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. Existing tests still pass:
- `shows an accepted summary`: the fixture keeps st_2, so the box now also reads `Next: API →`, and `getByText('Stage summary')` still finds only the kicker;
- `follows the hash and j/k`;
- the F12b-4 advance tests.

If any build touched `internal/daemon/webdist`, discard it with `git checkout internal/daemon/webdist`.

- [ ] **Step 9: Commit**

```bash
git add web/src/thread/delivery.ts web/src/thread/delivery.test.ts web/src/session/nav.ts web/src/session/nav.test.ts web/src/stage/StageView.tsx web/src/stage/StageView.test.tsx web/src/shell/SessionPage.tsx web/src/shell/SessionPage.test.tsx web/src/styles/app.css
git commit -m "feat(web): after Accept summary, advance or wait for the AI's next step

Accepting a stage summary opens the next stage (its first unresolved
thread) when one exists, or when the AI adds it while the user is still
there. On the last stage the box shows a typing bubble that goes still
once the AI is back in tdm wait with nothing planned, plus End session;
any stage with a later one links to it."
```

---

### Task 6: Domain, `tdm wait` and guide: Save an edit over a proposal (Part C, Go side)

Today Edit on a proposed conclusion sends `conclusion.edit`, which resolves the thread in one step (`conclusion.edited {original, text}`), and Edit on a proposed stage summary sends `stage.accept {text}` (`stage.summary.accepted {original}`). Part C separates Save from Accept. Two new user events replace the proposal in place: `conclusion.revised {threadId, text}` and `summary.revised {stageId, text}`. The status stays proposed, and the new `editedByUser` flag marks the proposal as the user's. Accept is then the ordinary accept, which already takes the current proposal (`t.ProposedConclusion`, `st.ProposedSummary`), so `decide.go`'s accept cases need no change. The old events stay decodable and replay unchanged.

A revise does not bump `LastUserSeq`: the agent is told (`tdm wait`), but nothing is expected from it until the accept, so the thread must not read "awaiting AI" and the page must not show the typing bubble.

**Files:**
- Modify: `internal/domain/commands.go` (new `ReviseConclusion`, `ReviseStageSummary`, their `isCommand`, two factory entries)
- Modify: `internal/domain/events.go` (two consts, two payloads)
- Modify: `internal/domain/errors.go` (`CodeTextUnchanged`)
- Modify: `internal/domain/state.go` (`Stage.EditedByUser`, `Thread.EditedByUser`)
- Modify: `internal/domain/decide.go` (two cases, `revisedText`)
- Modify: `internal/domain/reducer.go` (two cases; clear the flag in six places)
- Modify: `internal/render/wait.go` (two cases)
- Modify: `internal/guide/guide.md` (steps 5 and 6)
- Modify: `docs/superpowers/specs/2026-09-25-tandem-design.md` (user event table)
- Test: `internal/domain/decide_test.go`, `internal/domain/lifecycle_test.go`, `internal/render/wait_test.go`, `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: nothing new (Task 4's Next line in the `EvStageSummaryAccepted` case of `wait.go` is left as it is).
- Produces:
  - user action `conclusion.revise {threadId, text}` → `domain.ReviseConclusion{ThreadID string "threadId"; Text string "text"}`;
  - user action `stage.revise {stageId, text}` → `domain.ReviseStageSummary{StageID string "stageId"; Text string "text"}`;
  - events `domain.EvConclusionRevised = "conclusion.revised"` with `domain.ConclusionRevised{ThreadID "threadId"; Text "text"}`, and `domain.EvSummaryRevised = "summary.revised"` with `domain.SummaryRevised{StageID "stageId"; Text "text"}`, both `ActorUser`;
  - `domain.CodeTextUnchanged = "text_unchanged"`;
  - `domain.Thread.EditedByUser` and `domain.Stage.EditedByUser`, `bool`, JSON `editedByUser,omitempty`;
  - `tdm wait` blocks `## t_N "<title>" — conclusion edited\n\nYour proposal was replaced with:\n> <text>\n` and `## Stage summary — edited\n\nYour proposal was replaced with:\n> <text>\n`.

- [ ] **Step 1: Write the failing domain tests**

Append to `internal/domain/decide_test.go`:

```go
// Stage summary flow, part C: Save in a proposed conclusion's Edit editor replaces the proposal
// and keeps the thread proposed. The saved text is trimmed and marked as the user's, and it asks
// nothing of the AI (not awaiting AI). Accept then accepts it as it stands; a re-proposal by the
// AI replaces it and clears the mark.
func TestReviseConclusion(t *testing.T) {
	revise := &ReviseConclusion{ThreadID: "t_1", Text: "  done, documented\n"}
	s, events := domaintest.Build(t, stage, thread, conclude, revise)
	th := s.Threads["t_1"]
	if th.Status != ThreadConclusionProposed || th.ProposedConclusion != "done, documented" || !th.EditedByUser || th.AwaitingAI() {
		t.Fatalf("thread = %+v", th)
	}
	last := events[len(events)-1]
	var p ConclusionRevised
	if last.Type != EvConclusionRevised || last.Actor != ActorUser || last.Decode(&p) != nil || p != (ConclusionRevised{ThreadID: "t_1", Text: "done, documented"}) {
		t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
	}

	s, events = domaintest.Build(t, stage, thread, conclude, revise, accept)
	if th := s.Threads["t_1"]; th.Status != ThreadResolved || th.Conclusion != "done, documented" || th.EditedByUser {
		t.Fatalf("after accept: %+v", th)
	}
	var acc ConclusionAccepted
	if last := events[len(events)-1]; last.Type != EvConclusionAccepted || last.Decode(&acc) != nil || acc.Text != "done, documented" {
		t.Fatalf("accept event = %s, payload %+v", last.Type, acc)
	}

	s, _ = domaintest.Build(t, stage, thread, conclude, revise, &Conclude{ThreadID: "t_1", Text: "done v2"})
	if th := s.Threads["t_1"]; th.ProposedConclusion != "done v2" || th.EditedByUser {
		t.Fatalf("after re-proposal: %+v", th)
	}
}

// Stage summary flow, part C: the same for a proposed stage summary. The accept after a Save is a
// plain accept (no original), and a re-proposal clears the mark.
func TestReviseStageSummary(t *testing.T) {
	propose := &ProposeStageSummary{Text: "Keep the log."}
	revise := &ReviseStageSummary{StageID: "st_1", Text: "Keep the log; blobs by hash.\n"}
	s, events := domaintest.Build(t, stage, thread, conclude, accept, propose, revise)
	st := s.Stage("st_1")
	if st.Status != StageSummaryProposed || st.ProposedSummary != "Keep the log; blobs by hash." || !st.EditedByUser {
		t.Fatalf("stage = %+v", st)
	}
	last := events[len(events)-1]
	var p SummaryRevised
	if last.Type != EvSummaryRevised || last.Actor != ActorUser || last.Decode(&p) != nil || p != (SummaryRevised{StageID: "st_1", Text: "Keep the log; blobs by hash."}) {
		t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
	}

	s, events = domaintest.Build(t, stage, thread, conclude, accept, propose, revise, &AcceptStageSummary{StageID: "st_1"})
	if st := s.Stage("st_1"); st.Status != StageAccepted || st.Summary != "Keep the log; blobs by hash." || st.EditedByUser {
		t.Fatalf("after accept: %+v", st)
	}
	var acc StageSummaryAccepted
	if last := events[len(events)-1]; last.Decode(&acc) != nil || acc != (StageSummaryAccepted{StageID: "st_1", Text: "Keep the log; blobs by hash."}) {
		t.Fatalf("accept payload = %+v", acc)
	}

	s, _ = domaintest.Build(t, stage, thread, conclude, accept, propose, revise, &ProposeStageSummary{Text: "Keep the log, v2."})
	if st := s.Stage("st_1"); st.ProposedSummary != "Keep the log, v2." || st.EditedByUser {
		t.Fatalf("after re-proposal: %+v", st)
	}
}
```

In `TestDecideRules` (same file), append these rows to `cases`, directly after the `{"choose after choose and resolve", …}` row (lines 98-99 before this task):

```go
		{"revise without a proposal", []Command{stage, thread, &ReviseConclusion{ThreadID: "t_1", Text: "x"}}, CodeNoConclusionProposed},
		{"revise needs text", []Command{stage, thread, conclude, &ReviseConclusion{ThreadID: "t_1", Text: " \n"}}, CodeInvalidInput},
		{"revise to the same text", []Command{stage, thread, conclude, &ReviseConclusion{ThreadID: "t_1", Text: " done\n"}}, CodeTextUnchanged},
		{"revise a resolved thread", []Command{stage, thread, conclude, accept, &ReviseConclusion{ThreadID: "t_1", Text: "x"}}, CodeThreadResolved},
		{"revise summary without a proposal", []Command{stage, thread, conclude, accept, &ReviseStageSummary{StageID: "st_1", Text: "x"}}, CodeNoSummaryProposed},
		{"revise summary needs text", append(append([]Command{stage, thread}, proposeAccept[:3]...), &ReviseStageSummary{StageID: "st_1"}), CodeInvalidInput},
		{"revise summary to the same text", append(append([]Command{stage, thread}, proposeAccept[:3]...), &ReviseStageSummary{StageID: "st_1", Text: "s "}), CodeTextUnchanged},
		{"revise an accepted summary", append(append([]Command{stage, thread}, proposeAccept...), &ReviseStageSummary{StageID: "st_1", Text: "x"}), CodeNoSummaryProposed},
```

(`proposeAccept[:3]` is `conclude, accept, &ProposeStageSummary{Text: "s"}`: the summary is proposed, not yet accepted.)

In `TestDecodeCommand` (same file), directly before `if _, err := DecodeCommand(ActorAI, "thread.resolve", nil); err == nil {` (line 146 before this task), insert:

```go
	cmd, err = DecodeCommand(ActorUser, "conclusion.revise", json.RawMessage(`{"threadId":"t_1","text":"mine"}`))
	if err != nil || *cmd.(*ReviseConclusion) != (ReviseConclusion{ThreadID: "t_1", Text: "mine"}) {
		t.Fatalf("conclusion.revise = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "stage.revise", json.RawMessage(`{"stageId":"st_1","text":"mine"}`))
	if err != nil || *cmd.(*ReviseStageSummary) != (ReviseStageSummary{StageID: "st_1", Text: "mine"}) {
		t.Fatalf("stage.revise = %#v, %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorAI, "conclusion.revise", nil); err == nil {
		t.Fatal("agent must not be able to revise a proposal")
	}
```

Append to `internal/domain/lifecycle_test.go` (`encoding/json` and `strings` are already imported):

```go
// Stage summary flow, part C: old logs keep replaying. conclusion.edited (the old Accept edited,
// and Resolve with a note) and an edited stage.summary.accepted resolve and accept exactly as
// before and leave no editedByUser behind.
func TestOldEditedEventsReplay(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),
		Event{Actor: ActorUser, Type: EvConclusionEdited, V: 1, Data: json.RawMessage(`{"threadId":"t_1","original":"v1","text":"v1 edited"}`)},
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum"}),
		Event{Actor: ActorUser, Type: EvStageSummaryAccepted, V: 1, Data: json.RawMessage(`{"stageId":"st_1","text":"sum edited","original":"sum"}`)},
	)
	s := replay(t, evs...)
	if th := s.Threads["t_1"]; th.Status != ThreadResolved || th.Conclusion != "v1 edited" || th.ProposedConclusion != "" || th.EditedByUser || th.AwaitingAI() {
		t.Fatalf("old conclusion.edited: %+v", th)
	}
	if st := s.Stage("st_1"); st.Status != StageAccepted || st.Summary != "sum edited" || st.ProposedSummary != "" || st.EditedByUser {
		t.Fatalf("old edited stage.summary.accepted: %+v", st)
	}
}

// Stage summary flow, part C: a revised proposal is replaced in place and marked as the user's,
// without bumping lastUserSeq (the AI has nothing to do until the accept). Every later proposal,
// accept, resolve or request clears the mark. Both events are placed by EventStageID (tdm log --stage).
func TestRevisedProposalsReplay(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),
		NewEvent(ActorUser, EvConclusionRevised, ConclusionRevised{ThreadID: "t_1", Text: "mine"}),
	)
	s := replay(t, evs...)
	th := s.Threads["t_1"]
	if th.Status != ThreadConclusionProposed || th.ProposedConclusion != "mine" || !th.EditedByUser || th.LastUserSeq != 0 || th.AwaitingAI() {
		t.Fatalf("after conclusion.revised: %+v", th)
	}
	if got := EventStageID(s, evs[len(evs)-1]); got != "st_1" {
		t.Fatalf("conclusion.revised stage = %q", got)
	}
	for _, next := range []Event{
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v2"}),
		NewEvent(ActorUser, EvConclusionDiscussionRequested, ConclusionDiscussionRequested{ThreadID: "t_1", Comment: "not yet"}),
		NewEvent(ActorUser, EvConclusionAccepted, ConclusionAccepted{ThreadID: "t_1", Text: "mine"}),
		NewEvent(ActorUser, EvConclusionEdited, ConclusionEdited{ThreadID: "t_1", Original: "mine", Text: "Resolved by user"}),
	} {
		if th := replay(t, append(evs[:len(evs):len(evs)], next)...).Threads["t_1"]; th.EditedByUser {
			t.Errorf("%s kept editedByUser: %+v", next.Type, th)
		}
	}

	evs = append(structureEvents(),
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum"}),
		NewEvent(ActorUser, EvSummaryRevised, SummaryRevised{StageID: "st_1", Text: "my sum"}),
	)
	s = replay(t, evs...)
	if st := s.Stage("st_1"); st.Status != StageSummaryProposed || st.ProposedSummary != "my sum" || !st.EditedByUser {
		t.Fatalf("after summary.revised: %+v", st)
	}
	if got := EventStageID(s, evs[len(evs)-1]); got != "st_1" {
		t.Fatalf("summary.revised stage = %q", got)
	}
	for _, next := range []Event{
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum2"}),
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "more"}),
		NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: "st_1", Text: "my sum"}),
	} {
		if st := replay(t, append(evs[:len(evs):len(evs)], next)...).Stage("st_1"); st.EditedByUser {
			t.Errorf("%s kept editedByUser: %+v", next.Type, st)
		}
	}
}

// Stage summary flow, part C: the wire shapes. editedByUser is omitted unless set, so snapshots of
// sessions without a Save (and the contract fixture) do not change.
func TestRevisedJSON(t *testing.T) {
	b, err := json.Marshal(ConclusionRevised{ThreadID: "t_1", Text: "x"})
	if want := `{"threadId":"t_1","text":"x"}`; err != nil || string(b) != want {
		t.Fatalf("conclusion.revised json = %s (%v), want %s", b, err, want)
	}
	b, err = json.Marshal(SummaryRevised{StageID: "st_1", Text: "x"})
	if want := `{"stageId":"st_1","text":"x"}`; err != nil || string(b) != want {
		t.Fatalf("summary.revised json = %s (%v), want %s", b, err, want)
	}
	for _, v := range []any{Thread{ID: "t_1"}, Stage{ID: "st_1"}} {
		if b, _ := json.Marshal(v); strings.Contains(string(b), "editedByUser") {
			t.Errorf("without a Save: %s", b)
		}
	}
	for _, v := range []any{Thread{ID: "t_1", EditedByUser: true}, Stage{ID: "st_1", EditedByUser: true}} {
		if b, _ := json.Marshal(v); !strings.Contains(string(b), `"editedByUser":true`) {
			t.Errorf("after a Save: %s", b)
		}
	}
}
```

(`append(evs[:len(evs):len(evs)], next)` copies, so each case replays the base log plus one event.)

- [ ] **Step 2: Write the failing render and guide tests**

Append to `internal/render/wait_test.go`:

```go
// Stage summary flow, part C: Save reaches the agent as "conclusion edited" / "stage summary —
// edited" with the user's text, and the Accept after it is a plain accept of that text.
func TestWaitRevisedProposals(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.Conclude{Text: "REST"},
		&domain.ReviseConclusion{ThreadID: "t_1", Text: "REST, versioned under /v1."},
		&domain.AcceptConclusion{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "REST."},
		&domain.ReviseStageSummary{StageID: "st_1", Text: "REST under /v1."},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	want := `# Stage st_1 "API" — 1/1 threads resolved

## t_1 "Endpoints" — conclusion edited

Your proposal was replaced with:
> REST, versioned under /v1.

## t_1 "Endpoints" — conclusion accepted

Accepted as proposed.
> REST, versioned under /v1.

## Stage summary — edited

Your proposal was replaced with:
> REST under /v1.
`
	if got != want {
		t.Fatalf("Wait mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}
```

(The stage summary is not accepted here, so Task 4's `Next:` line is not part of the output.)

Append to `internal/guide/guide_test.go`:

```go
// Stage summary flow, part C: a saved edit is the user's new proposal. The agent recognises both
// sections, does not propose over the user's text, and waits for the accept.
func TestGuideCoversRevisedProposals(t *testing.T) {
	for _, s := range []string{
		"`conclusion edited`",
		"`stage summary — edited`",
		"`Your proposal was replaced with:`",
		"That text is now the proposal",
		"unless the user asks for changes",
		"wait for the accept",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

(The backticks matter: the guide already says `` `conclusion edited and accepted` `` and `` `stage summary — edited and accepted` ``, which must not satisfy this test.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/domain/ ./internal/render/`
Expected: compile FAIL, e.g. `undefined: ReviseConclusion`, `undefined: EvConclusionRevised`, `th.EditedByUser undefined (type *Thread has no field or method EditedByUser)`, `undefined: domain.ReviseConclusion`.

Run: `go test ./internal/guide/ -run TestGuideCoversRevisedProposals`
Expected: FAIL, six lines `guide.md does not mention …`, starting with ``"`conclusion edited`"``.

- [ ] **Step 4: Add the commands, events, error code and state fields**

In `internal/domain/commands.go`, directly after `type EditConclusion struct { … }` (lines 92-95), insert:

```go
// ReviseConclusion is Save in a proposed conclusion's Edit editor (stage summary flow, part C): the
// user's text replaces the proposal, and the thread stays proposed until Accept. EditConclusion
// (edit and accept in one step) stays for old clients; the UI no longer sends it.
type ReviseConclusion struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}
```

Directly after `type AcceptStageSummary struct { … }` (lines 107-110), insert:

```go
// ReviseStageSummary is Save in a proposed stage summary's Edit editor: the same as ReviseConclusion,
// for a stage. AcceptStageSummary with a Text stays for old clients; the UI no longer sends it.
type ReviseStageSummary struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}
```

After `func (*AcceptStageSummary) isCommand()  {}` (line 142), add:

```go
func (*ReviseConclusion) isCommand()    {}
func (*ReviseStageSummary) isCommand()  {}
```

In `commandFactories[ActorUser]`, add after the `"conclusion.discuss"` entry (line 171):

```go
		"conclusion.revise":     func() Command { return &ReviseConclusion{} },
```

and after the `"stage.accept"` entry (line 172):

```go
		"stage.revise":          func() Command { return &ReviseStageSummary{} },
```

In `internal/domain/events.go`, add to the `const` block after `EvConclusionDiscussionRequested` (line 18):

```go
	EvConclusionRevised             = "conclusion.revised"
	EvSummaryRevised                = "summary.revised"
```

and directly after `type ConclusionEdited struct { … }` (lines 105-109), insert:

```go
// ConclusionRevised is the user's saved edit of a proposed conclusion: Text (trimmed) replaces the
// proposal, and the thread stays proposed (stage summary flow, part C).
type ConclusionRevised struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

// SummaryRevised is the same for a proposed stage summary.
type SummaryRevised struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}
```

In `internal/domain/errors.go`, add after `CodeQuestionClosed` (line 26):

```go
	CodeTextUnchanged        = "text_unchanged"
```

In `internal/domain/state.go`, add to `Stage` after `ProposedSummary` (line 46):

```go
	EditedByUser    bool        `json:"editedByUser,omitempty"` // ProposedSummary is the user's saved edit (summary.revised)
```

and to `Thread` after `ProposedConclusion` (line 59):

```go
	EditedByUser       bool            `json:"editedByUser,omitempty"` // ProposedConclusion is the user's saved edit (conclusion.revised)
```

- [ ] **Step 5: Decide the revise commands**

In `internal/domain/decide.go`, directly before `case *RequestDiscussion:` (line 91), insert:

```go
	case *ReviseConclusion:
		t, err := s.proposedThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		text, err := revisedText(c.Text, t.ProposedConclusion)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvConclusionRevised, ConclusionRevised{ThreadID: t.ID, Text: text}), t.ID)
```

Directly before `case *RequestStageChanges:` (line 111), insert:

```go
	case *ReviseStageSummary:
		st, err := s.proposedStage(c.StageID)
		if err != nil {
			return nil, Result{}, err
		}
		text, err := revisedText(c.Text, st.ProposedSummary)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvSummaryRevised, SummaryRevised{StageID: st.ID, Text: text}), st.ID)
```

After `func one(…)` (line 136), add:

```go

// revisedText checks the user's Save over a proposal (stage summary flow, part C): the text is
// required, stored trimmed, and must differ from the current proposal. An unchanged text is
// rejected, so the log never records a Save that changed nothing.
func revisedText(text, proposed string) (string, error) {
	if err := required("text", text); err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == strings.TrimSpace(proposed) {
		return "", errorf(CodeTextUnchanged, "change the text, or accept the proposal as it is", "the text is the same as the current proposal")
	}
	return text, nil
}
```

The accept cases stay as they are: `AcceptConclusion` accepts `t.ProposedConclusion` and `AcceptStageSummary` without text accepts `st.ProposedSummary`, which after a Save are the user's text.

- [ ] **Step 6: Fold the revise events and clear the mark**

In `internal/domain/reducer.go`:

In `case EvConclusionProposed:` replace line 114 with:

```go
		t.Status, t.ProposedConclusion, t.EditedByUser, t.LastAISeq = ThreadConclusionProposed, p.Text, false, e.Seq
```

In `case EvConclusionDiscussionRequested:` replace `t.Status, t.ProposedConclusion = ThreadOpen, ""` (line 144) with:

```go
		t.Status, t.ProposedConclusion, t.EditedByUser = ThreadOpen, "", false
```

and directly after the following `t.userMessage(p.Comment, e.Seq)` (line 145), add the new case:

```go
	case EvConclusionRevised:
		p, err := decode[ConclusionRevised](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		// The AI has nothing to do until the accept, so LastUserSeq stays: no "awaiting AI".
		t.ProposedConclusion, t.EditedByUser = p.Text, true
```

In `case EvStageSummaryProposed:` replace line 155 with:

```go
		st.Status, st.ProposedSummary, st.EditedByUser = StageSummaryProposed, p.Text, false
```

and directly after it add:

```go
	case EvSummaryRevised:
		p, err := decode[SummaryRevised](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.ProposedSummary, st.EditedByUser = p.Text, true
```

In `case EvStageSummaryAccepted:` replace line 165 with:

```go
		st.Status, st.Summary, st.ProposedSummary, st.EditedByUser = StageAccepted, p.Text, "", false
```

In `case EvStageSummaryChangesRequested:` replace line 175 with:

```go
		st.Status, st.ProposedSummary, st.EditedByUser = StageOpen, "", false
```

Replace the body of `func (t *Thread) resolve` (line 301), which serves `conclusion.accepted`, `conclusion.edited` and Choose & resolve:

```go
	t.Status, t.Conclusion, t.ProposedConclusion, t.EditedByUser, t.LastUserSeq = ThreadResolved, conclusion, "", false, seq
```

- [ ] **Step 7: Render the revise events in `tdm wait`**

In `internal/render/wait.go`, directly before `case domain.EvConclusionDiscussionRequested:` (line 146), insert:

```go
	case domain.EvConclusionRevised:
		var p domain.ConclusionRevised
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "conclusion edited", "Your proposal was replaced with:\n"+Quote(p.Text))}, nil
```

Directly before `case domain.EvStageSummaryAccepted:` (line 152 before Task 4; leave Task 4's body of that case as it is), insert:

```go
	case domain.EvSummaryRevised:
		var p domain.SummaryRevised
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{{p.StageID, "## Stage summary — edited\n\nYour proposal was replaced with:\n" + Quote(p.Text)}}, nil
```

- [ ] **Step 8: Update the agent guide and the design spec**

In `internal/guide/guide.md`, replace step 5 of `## The loop` (lines 44-47):

```markdown
5. `discussion requested` means the user rejected your conclusion: keep discussing, then conclude again.
   `conclusion edited` means the user saved their own text over your proposed conclusion, quoted after
   `Your proposal was replaced with:`. That text is now the proposal. Do not propose over it unless the user
   asks for changes: wait for the accept. The thread stays unresolved until then.
   `conclusion accepted` or `conclusion edited and accepted` resolves the thread. Use the final text you are
   given. The user can also resolve a thread you never proposed a conclusion for. You then get
   `conclusion edited and accepted` with their text (`Resolved by user` when they left no note).
```

and step 6 (lines 48-50):

```markdown
6. When every thread of the stage is resolved, run `tdm stage summarize` and write a summary that **covers the
   conclusion of every thread**. Then `tdm stage propose "<summary>"` and `tdm wait`. If the user sends
   `changes requested`, revise and propose again. `stage summary — edited` works like `conclusion edited`:
   the quoted text is now the proposed summary. Do not propose over it unless the user asks for changes:
   wait for the accept.
```

Step 7 (Task 4's text) is not changed: `stage summary — edited and accepted` still arrives from logs and clients that predate Save.

In `docs/superpowers/specs/2026-09-25-tandem-design.md`, in the user event table, replace the row

```
| `conclusion.edited` | `original`, `text` (edited and accepted) |
```

with

```
| `conclusion.edited` | `original`, `text` (edited and accepted: Resolve with a note; the UI's Accept edited before Save existed) |
| `conclusion.revised` | `text` (the user saved their own text over the proposed conclusion; the thread stays proposed: "conclusion edited") |
```

and after the `stage.summary.accepted` row add

```
| `summary.revised` | `stageId`, `text` (the same for a proposed stage summary: "stage summary — edited") |
```

- [ ] **Step 9: Run the Go tests**

Run: `gofmt -l internal; go test ./...`
Expected: `gofmt` lists no files. PASS, including `TestSnapshotContractFixture` (its scenario has no Save and `editedByUser` is `omitempty`, so `web/src/test/fixtures/snapshot.json` is unchanged), `TestWaitLifecycleAndSessionEvents` (still sends `EditConclusion`, which still reads `conclusion edited and accepted`) and `e2e/TestFullLoop`.

- [ ] **Step 10: Commit**

```bash
git add internal/domain internal/render internal/guide docs/superpowers/specs/2026-09-25-tandem-design.md
git commit -m "feat(domain): save an edit over a proposal without accepting it

conclusion.revise and stage.revise replace the proposed conclusion or
stage summary with the user's text, keep it proposed and mark it
editedByUser; any re-proposal, accept or request clears the mark.
tdm wait reports \"conclusion edited\" / \"stage summary — edited\" with
the new text, and the guide tells the agent to wait for the accept.
conclusion.edited and stage.accept with text still replay."
```

---

### Task 7: Web: Edit → Save → Accept for conclusions and stage summaries (Part C, UI side)

After Task 6 the daemon accepts `conclusion.revise` and `stage.revise`. The Edit editor's submit becomes **Save**: it sends the revise action, closes the editor and leaves the card proposed, and never calls `onResolved` (no auto-advance). Accept is the existing plain accept. A saved card shows *edited by you* in its kicker. The UI no longer emits `conclusion.edit` or `stage.accept` with text; the `Action` type drops both, so the typechecker catches any leftover sender.

Tasks 2–5 have landed. Task 2 added the in-flight guards: `busy`, `inFlight` and `accept()` in `ConclusionCard`, and `accepting`, `acceptInFlight` and `accept(text?)` in `StageBody`. Task 5 extended the stage's `accept` (it records `acceptedAfter` and calls `onAccepted`) and the accepted box. This task keeps both guards. Its one change to them: the stage's `accept` loses its `text` parameter (Step 6), because Edit now saves with `stage.revise` and nothing accepts with a text any more. Line numbers below are from before Task 2; the anchors are quoted so they can be found after it.

**Files:**
- Modify: `web/src/api/types.ts` (`Thread.editedByUser`, `Stage.editedByUser`, `Action`)
- Modify: `web/src/thread/ConclusionCard.tsx` (Save, marker, re-proposal effect)
- Modify: `web/src/stage/StageView.tsx` (Save, marker)
- Modify: `web/src/styles/app.css` (`.edited-by-you`)
- Modify: `web/e2e/loop.spec.ts` (the follow-up 7 block; the e2e suite runs in Task 12)
- Test: `web/src/thread/ThreadView.test.tsx`, `web/src/stage/StageView.test.tsx`

**Interfaces:**
- Consumes: the actions `conclusion.revise {threadId, text}` and `stage.revise {stageId, text}`, and the state field `editedByUser` (Task 6).
- Produces:
  - `Thread.editedByUser?: boolean`, `Stage.editedByUser?: boolean`;
  - `Action` members `{ type: 'conclusion.revise'; data: { threadId: string; text: string } }` and `{ type: 'stage.revise'; data: { stageId: string; text: string } }`; `stage.accept` becomes `{ stageId: string }`, and `conclusion.edit` is removed;
  - in both proposed cards: the Edit editor's submit `Save` (a `save(text)` helper guarded by a `saving` ref), and `<span class="edited-by-you">edited by you</span>` inside the `.kicker` while `editedByUser` is set (Tasks 9 and 11 move this marker into `ProposalCard`'s header);
  - `StageBody`'s `accept(): Promise<boolean>`, now without a `text` parameter.

- [ ] **Step 1: Write the failing ThreadView tests**

In `web/src/thread/ThreadView.test.tsx`, replace the test `it('accepts or edits a proposed conclusion (Discuss removed, round 3 #7)', …)` (lines 83-98) with:

```tsx
  it('accepts a proposed conclusion, or edits and saves it without accepting (stage summary flow, part C)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx } = renderStateful(<ThreadView threadId="t_2" onResolved={onResolved} />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(card).toHaveTextContent('Use a lazy delegate for the cache.')
    expect(screen.queryByRole('button', { name: 'Discuss' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'conclusion.accept', data: { threadId: 't_2' } })
    onResolved.mockClear()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit conclusion' })
    await user.clear(box)
    await user.type(box, 'Lazy delegate, documented.')
    expect(screen.queryByRole('button', { name: 'Accept edited' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'conclusion.revise', data: { threadId: 't_2', text: 'Lazy delegate, documented.' } })
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
    expect(onResolved).not.toHaveBeenCalled() // Save keeps the thread proposed: no auto-advance
  })
```

Replace the test `it('calls onResolved after Accept edited succeeds (fix round 1, Minor)', …)` (lines 118-127) with:

```tsx
  it('keeps the editor open when Save fails, and cancels back to the proposal', async () => {
    const user = userEvent.setup()
    renderWithCtx(<ThreadView threadId="t_2" />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), ' More.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('textbox', { name: 'Edit conclusion' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('region', { name: 'Proposed conclusion' })).toHaveTextContent('Use a lazy delegate for the cache.')
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
  })
```

Append at the end of the file (`act`, `fireEvent`, `within`, `vi`, `makeCtx`, `renderStateful` and `renderWithCtx` are already imported):

```tsx
describe('ThreadView Edit → Save → Accept (stage summary flow, part C)', () => {
  it('marks a conclusion the user saved, and Accept accepts it as it stands', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, proposedConclusion: 'Lazy delegate, documented.', editedByUser: true }
    const { ctx } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(card).getByText('edited by you')).toHaveClass('edited-by-you')
    expect(card).toHaveTextContent('Lazy delegate, documented.')
    await user.click(within(card).getByRole('button', { name: /^Accept/ }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'conclusion.accept', data: { threadId: 't_2' } })
  })

  it("shows no marker on the AI's own proposal", () => {
    renderStateful(<ThreadView threadId="t_2" />)
    expect(screen.queryByText('edited by you')).toBeNull()
  })

  it('closes the editor without sending when the text is unchanged', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_2" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), '  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
  })

  it('sends a single Save while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    renderWithCtx(<ThreadView threadId="t_2" />, makeCtx({ run }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), ' More.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
  })

  it('closes the editor and shows the new proposal when the AI re-proposes underneath it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // Mutated in place and re-rendered with the same threadId, as in StageView's matching test.
    base.state.threads.t_2 = { ...base.state.threads.t_2, proposedConclusion: 'Use a lazy delegate; document it.' }
    rerender(<ThreadView threadId="t_2" />)
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Proposed conclusion' })).toHaveTextContent('Use a lazy delegate; document it.')
  })
})
```

- [ ] **Step 2: Write the failing StageView tests**

In `web/src/stage/StageView.test.tsx`, change the Testing Library import (line 2) to:

```tsx
import { act, fireEvent, screen, within } from '@testing-library/react'
```

Replace the test `it('edits a proposed summary and accepts the edited text', …)` with its comment (lines 67-85) with:

```tsx
  // Stage summary flow, part C: Edit → Save replaces the proposal; Accept summary is a separate click.
  it('saves an edited summary without accepting it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.queryByText('edited by you')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit summary' })
    expect(box).toHaveValue('We keep a JSONL log.')
    expect(screen.queryByRole('button', { name: 'Accept summary' })).toBeNull()
    await user.clear(box)
    await user.type(box, 'We keep a JSONL log and content-addressed blobs.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenLastCalledWith({
      type: 'stage.revise',
      data: { stageId: 'st_1', text: 'We keep a JSONL log and content-addressed blobs.' },
    })
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
  })

  it('marks a summary the user saved, and Accept summary accepts it as it stands', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'Mine.', editedByUser: true }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const region = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(region).getByText('edited by you')).toHaveClass('edited-by-you')
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.accept', data: { stageId: 'st_1' } })
  })

  it('closes the summary editor without sending when the text is unchanged', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), '\n')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
  })

  it('sends a single summary Save while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, run })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), ' And blobs.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
  })
```

In the next test, `it('keeps the editor open when accepting fails, and cancels back to the proposal', …)` (lines 87-99), rename it to `'keeps the editor open when saving fails, and cancels back to the proposal'` and replace its line

```tsx
    await user.click(screen.getByRole('button', { name: 'Accept edited' }))
```

(line 93) with

```tsx
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), ' And blobs.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
```

(A Save with the text unchanged closes the editor without sending, so the failing path needs an edit first.) The rest of that test stays. The test `'closes the Edit editor and shows the new proposal when the proposed summary changes underneath it'` stays as it is.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/ThreadView.test.tsx src/stage/StageView.test.tsx`
Expected: 11 tests FAIL (6 in ThreadView, 5 in StageView), e.g. `Unable to find an accessible element with the role "button" and name "Save"`, and `Unable to find an element with the text: edited by you`.

- [ ] **Step 4: Update the types**

In `web/src/api/types.ts`, in `interface Thread`, after `proposedConclusion?: string` (line 108) add:

```ts
  /** Set while the proposed conclusion is the user's saved edit (conclusion.revised). */
  editedByUser?: boolean
```

In `interface Stage`, after `proposedSummary?: string` (line 119) add:

```ts
  /** Set while the proposed summary is the user's saved edit (summary.revised). */
  editedByUser?: boolean
```

In `Action`, replace the member

```ts
  | { type: 'conclusion.edit'; data: { threadId: string; text: string } }
```

(line 174) with

```ts
  | { type: 'conclusion.revise'; data: { threadId: string; text: string } }
```

and replace

```ts
  | { type: 'stage.accept'; data: { stageId: string; text?: string } }
```

(line 176) with

```ts
  | { type: 'stage.accept'; data: { stageId: string } }
  | { type: 'stage.revise'; data: { stageId: string; text: string } }
```

- [ ] **Step 5: Save a conclusion edit**

In `web/src/thread/ConclusionCard.tsx`, make the React import `import { useEffect, useRef, useState } from 'react'` (Task 2 already added `useRef`).

Directly after `const [mode, setMode] = useState<'view' | 'edit'>('view')` (line 10), add (before the early returns, so the hooks always run):

```tsx
  const saving = useRef(false)
  // If the AI re-proposes while the Edit editor is open, close it and show the new proposal, so a
  // Save never replaces a proposal the user has not read (as StageView does for the summary).
  useEffect(() => {
    setMode((m) => (m === 'edit' ? 'view' : m))
  }, [thread.proposedConclusion])
```

`saving` is separate from Task 2's Accept guard: Task 2's ref and `busy` state stay as they are.

Directly after `const text = thread.proposedConclusion ?? ''` (line 22), add:

```tsx

  // Save replaces the proposal and keeps the thread proposed; Accept is a separate click (stage
  // summary flow, part C). An unchanged text has nothing to save, and a second Save while one is
  // in flight is dropped (the daemon would reject it as text_unchanged).
  const save = async (t: string) => {
    if (saving.current) return
    if (t === text.trim()) {
      setMode('view')
      return
    }
    saving.current = true
    try {
      if (await run({ type: 'conclusion.revise', data: { threadId: thread.id, text: t } })) setMode('view')
    } finally {
      saving.current = false
    }
  }
```

Replace the kicker and the edit-mode editor (lines 26-40, from `<div className="kicker">Proposed conclusion</div>` through the `CommentEditor`'s closing `/>`):

```tsx
      <div className="kicker">
        Proposed conclusion
        {thread.editedByUser && <span className="edited-by-you">edited by you</span>}
      </div>
      {mode === 'edit' ? (
        <CommentEditor
          label="Edit conclusion"
          initial={text}
          submitLabel="Save"
          autoGrow
          onSave={(t) => void save(t)}
          onCancel={() => setMode('view')}
        />
```

The `) : (` `<Prose text={text} />` branch and the actions (Accept with Task 2's guard, Edit) stay unchanged. `onResolved` is now only called by Accept.

- [ ] **Step 6: Save a stage summary edit**

In `web/src/stage/StageView.tsx`, make the React import `import { useEffect, useRef, useState } from 'react'`.

Replace the `SummaryMode` comment (lines 20-21):

```tsx
// view: the proposed summary and its buttons; edit: the summary in an editor, saved over the
// proposal (stage summary flow, part C, like Edit on a proposed conclusion); changes: the
// "Request changes" editor.
```

In `StageBody`, directly after `const [mode, setMode] = useState<SummaryMode>('view')` (line 26), add:

```tsx
  const saving = useRef(false)
```

Replace the re-proposal effect and its comment (lines 32-36) with:

```tsx
  // If the AI re-proposes while the Edit editor is open, close it and show the new proposal,
  // so a Save never replaces a proposal the user has not read.
  useEffect(() => {
    setMode((m) => (m === 'edit' ? 'view' : m))
  }, [stage.proposedSummary])
  // Save replaces the proposed summary and keeps it proposed; Accept summary is a separate click
  // (stage summary flow, part C). An unchanged text has nothing to save, and a second Save while
  // one is in flight is dropped (the daemon would reject it as text_unchanged).
  const save = async (text: string) => {
    if (saving.current) return
    if (text === (stage.proposedSummary ?? '').trim()) {
      setMode('view')
      return
    }
    saving.current = true
    try {
      if (await run({ type: 'stage.revise', data: { stageId: stage.id, text } })) setMode('view')
    } finally {
      saving.current = false
    }
  }
```

Replace the `accept` helper (as Task 5 left it) with the same helper without `text`:

```tsx
  // In-flight guard (stage summary flow, part A), like ResolveThread's resolve: one stage.accept
  // at a time, and the summary's buttons are disabled while it is being sent. Resolves false
  // without sending while another accept is in flight. On success it remembers the seq it was
  // sent after and lets the page move on (part B). Edit saves with stage.revise (part C), so an
  // accept never carries a text.
  const accept = async (): Promise<boolean> => {
    if (acceptInFlight.current) return false
    acceptInFlight.current = true
    setAccepting(true)
    const before = state.lastSeq
    try {
      const ok = await run({ type: 'stage.accept', data: { stageId: stage.id } })
      if (ok) {
        setAcceptedAfter(before)
        onAccepted?.()
      }
      return ok
    } finally {
      acceptInFlight.current = false
      setAccepting(false)
    }
  }
```

In the `summary_proposed` section, replace the kicker and the edit-mode editor (lines 69-80, from `<div className="kicker">Proposed stage summary</div>` through the `CommentEditor`'s closing `/>`):

```tsx
          <div className="kicker">
            Proposed stage summary
            {stage.editedByUser && <span className="edited-by-you">edited by you</span>}
          </div>
          {!readOnly && mode === 'edit' ? (
            <CommentEditor
              label="Edit summary"
              initial={stage.proposedSummary ?? ''}
              submitLabel="Save"
              autoGrow
              onSave={(text) => void save(text)}
              onCancel={() => setMode('view')}
            />
```

This replaces Task 2's `onSave={async (text) => { if (await accept(text)) setMode('view') }}`. The `Request changes` editor and the action buttons (Accept summary, Edit and Request changes, all with Task 2's `disabled={accepting}`) stay unchanged.

- [ ] **Step 7: Style the marker**

In `web/src/styles/app.css`, directly after `.conclusion .comment-editor { margin-top: 12px; }` (line 360), add:

```css
.conclusion .kicker .edited-by-you {
  margin-left: 8px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
}
```

(The selector outranks `.conclusion .kicker { color: var(--ok); }`, so the marker is muted, in sentence case, next to the upper-case kicker.)

- [ ] **Step 8: Update the e2e flow**

In `web/e2e/loop.spec.ts`, in the first test, replace the comment line

```ts
  // Follow-up 7: edit the proposed summary and accept it; the agent and the export get the edited text.
```

(line 153) with

```ts
  // Part C: Edit → Save replaces the proposed summary and keeps it proposed; Accept summary then
  // accepts it, and the agent and the export get the user's text.
```

and replace lines 167-172 (from `await page.getByRole('button', { name: 'Accept edited' }).click()` through the `run(['export'])` expectation) with:

```ts
  await proposed.getByRole('button', { name: 'Save' }).click()
  await expect(proposed.getByText('edited by you')).toBeVisible()
  await expect(proposed).toContainText('Events go to a JSONL log; blobs are content-addressed.')
  expect(run(['wait', '--timeout', '5s'])).toContain(
    '## Stage summary — edited\n\nYour proposal was replaced with:\n> Events go to a JSONL log; blobs are content-addressed.\n',
  )
  await proposed.getByRole('button', { name: 'Accept summary' }).click()
  await expect(page.getByText('Stage summary', { exact: true })).toBeVisible()
  expect(run(['wait', '--timeout', '5s'])).toContain('## Stage summary — accepted\n\nAccepted as proposed.\n')
  expect(run(['export'])).toContain('## 1. Storage\nEvents go to a JSONL log; blobs are content-addressed.')
```

The e2e suite (`npm run e2e`) builds `internal/daemon/webdist`, so it runs in Task 12, not here.

- [ ] **Step 9: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. The typecheck confirms nothing sends `conclusion.edit` or `stage.accept` with a `text` any more. The unchanged tests `resets the composer draft and conclusion editor when switching threads`, `closes the Edit editor and shows the new proposal when the proposed summary changes underneath it` and `offers no summary actions on a read-only session` still pass.

If a build touched `internal/daemon/webdist`, discard it: `git checkout internal/daemon/webdist`.

- [ ] **Step 10: Commit**

```bash
git add web/src/api/types.ts web/src/thread/ConclusionCard.tsx web/src/stage/StageView.tsx web/src/styles/app.css web/src/thread/ThreadView.test.tsx web/src/stage/StageView.test.tsx web/e2e/loop.spec.ts
git commit -m "feat(web): Edit → Save → Accept for conclusions and stage summaries

The Edit editor saves the user's text over the proposal (conclusion.revise,
stage.revise) and leaves it proposed, marked \"edited by you\"; Accept is
a separate click. Unchanged or repeated Saves send nothing."
```

---

### Task 8: Domain, CLI, `tdm wait` and guide: stage messages and proposal versions (Parts D and E, Go side)

Today `Say` only reaches threads, `message.posted` is thread-only and AI-only, and user messages exist only inside `review.submitted`. Part E makes the stage page a conversation. `Say` gains `StageID`. A new user command, `stage.message` (`PostStageMessage`), emits the same `message.posted` event with actor user and a `stageId`. `Stage` keeps its `messages` and the seqs that say whether the user's latest stage message awaits the AI.

Part D needs to number proposals and to show earlier ones. `Thread` and `Stage` gain `proposalVersion` and `proposals` (text and seq of every AI proposal). No event type is added, and every new JSON field is `omitempty`, so old logs replay unchanged.

**Files:**
- Modify: `internal/domain/commands.go` (`Say.StageID`, new `PostStageMessage`, factory `stage.message`)
- Modify: `internal/domain/events.go` (`MessagePosted.StageID`, both ids `omitempty`)
- Modify: `internal/domain/state.go` (`Proposal`, new `Stage`/`Thread` fields, `Stage.AwaitingAI`)
- Modify: `internal/domain/decide.go` (the `*Say` case, the `*PostStageMessage` case, `decideStageMessage`)
- Modify: `internal/domain/reducer.go` (`EvMessagePosted`, `EvConclusionProposed`, `EvStageSummaryProposed`, `EvThreadCreated`)
- Modify: `internal/render/wait.go` (the `EvMessagePosted` case)
- Modify: `internal/render/views.go` (`Show`'s stage line, `awaiting`)
- Modify: `internal/cli/content.go` (`sayCmd`: `--stage`)
- Modify: `internal/guide/guide.md` (step 6, `Reading tdm wait output`, the command table)
- Modify: `internal/daemon/contract_test.go` (a stage conversation in the fixture scenario)
- Modify: `web/src/test/fixtures/snapshot.json` (regenerated)
- Modify: `docs/superpowers/specs/2026-09-25-tandem-design.md` (the `tdm say` line, the user event table)
- Test: `internal/domain/decide_test.go`, `internal/domain/lifecycle_test.go`, `internal/render/wait_test.go`, `internal/render/views_test.go`, `internal/cli/content_test.go`, `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: nothing new. Task 6's `EditedByUser` fields and its `conclusion.revised` / `summary.revised` reducer cases sit next to the code changed here and stay as they are.
- Produces:
  - `domain.Say{ThreadID "threadId,omitempty"; StageID "stageId,omitempty"; Text "text"}`;
  - `domain.PostStageMessage{StageID "stageId"; Text "text"}`, the user command `stage.message`;
  - `domain.MessagePosted{ThreadID "threadId,omitempty"; StageID "stageId,omitempty"; Text "text"}`;
  - `domain.Proposal{Text "text"; Seq "seq"}`;
  - `Thread.ProposalVersion int "proposalVersion,omitempty"`, `Thread.Proposals []Proposal "proposals,omitempty"`;
  - `Stage.Messages []Message "messages,omitempty"`, `Stage.LastUserSeq int64 "lastUserSeq,omitempty"`, `Stage.LastAISeq int64 "lastAiSeq,omitempty"`, `Stage.ProposalVersion`, `Stage.Proposals` (same tags as Thread's);
  - `func (st *Stage) AwaitingAI() bool`;
  - `tdm say [text] --stage st_N` → prints `st_N`;
  - `tdm wait` sections `## Stage st_N — message` / `## Stage summary — message`, each followed by a blank line and the quoted text;
  - `tdm session show` stage line suffix `, awaiting AI`.

- [ ] **Step 1: Write the failing domain tests**

In `internal/domain/decide_test.go`, add these cases to the `cases` table of `TestDecideRules`, directly after the `"say to resolved thread"` case:

```go
		{"say to a thread and a stage", []Command{stage, thread, &Say{ThreadID: "t_1", StageID: "st_1", Text: "x"}}, CodeInvalidInput},
		{"say to an unknown stage", []Command{stage, &Say{StageID: "st_9", Text: "x"}}, CodeStageNotFound},
		{"empty say on a stage", []Command{stage, &Say{StageID: "st_1", Text: " "}}, CodeInvalidInput},
		{"stage message needs a stage", []Command{stage, &PostStageMessage{Text: "x"}}, CodeInvalidInput},
		{"stage message to an unknown stage", []Command{stage, &PostStageMessage{StageID: "st_9", Text: "x"}}, CodeStageNotFound},
		{"empty stage message", []Command{stage, &PostStageMessage{StageID: "st_1", Text: "  "}}, CodeInvalidInput},
```

In `TestDecodeCommand`, before the final `thread.resolve` agent check, add:

```go
	cmd, err = DecodeCommand(ActorUser, "stage.message", json.RawMessage(`{"stageId":"st_1","text":"hi"}`))
	if err != nil || *cmd.(*PostStageMessage) != (PostStageMessage{StageID: "st_1", Text: "hi"}) {
		t.Fatalf("stage.message = %#v, %v", cmd, err)
	}
```

Append to `internal/domain/decide_test.go`:

```go
// Stage summary flow spec, part E: `tdm say --stage` and the user's stage.message both post
// message.posted with a stageId. The user's message awaits the AI until the AI acts in that stage
// (a message, a summary proposal or a new thread). Accepted stages take messages too (part B's
// wrap-up).
func TestStageMessages(t *testing.T) {
	s, events := domaintest.Build(t, stage,
		&Say{StageID: "st_1", Text: "Threads come next."},
		&PostStageMessage{StageID: "st_1", Text: "Add one on auth."},
	)
	st := s.Stage("st_1")
	if len(st.Messages) != 2 || st.Messages[0].Actor != ActorAI || st.Messages[1].Actor != ActorUser || st.Messages[1].Text != "Add one on auth." {
		t.Fatalf("messages = %+v", st.Messages)
	}
	if !st.AwaitingAI() || st.LastAISeq != 3 || st.LastUserSeq != 4 {
		t.Fatalf("stage = %+v", st)
	}
	last := events[len(events)-1]
	var p MessagePosted
	if last.Type != EvMessagePosted || last.Actor != ActorUser || last.Decode(&p) != nil || p != (MessagePosted{StageID: "st_1", Text: "Add one on auth."}) {
		t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
	}
	if len(s.Threads) != 0 {
		t.Fatalf("a stage message created threads: %+v", s.Threads)
	}

	for _, reply := range []Command{&Say{StageID: "st_1", Text: "Adding it."}, &AddThread{Title: "Auth"}} {
		s, _ := domaintest.Build(t, stage, &PostStageMessage{StageID: "st_1", Text: "Add one on auth."}, reply)
		if s.Stage("st_1").AwaitingAI() {
			t.Fatalf("%T did not answer the stage message", reply)
		}
	}

	s, _ = domaintest.Build(t, stage, thread, conclude, accept,
		&ProposeStageSummary{Text: "sum"}, &AcceptStageSummary{StageID: "st_1"},
		&Say{StageID: "st_1", Text: "Nothing more planned."},
		&PostStageMessage{StageID: "st_1", Text: "Thanks!"},
	)
	if st := s.Stage("st_1"); st.Status != StageAccepted || len(st.Messages) != 2 || !st.AwaitingAI() {
		t.Fatalf("accepted stage = %+v", st)
	}
}
```

Append to `internal/domain/lifecycle_test.go` (`encoding/json` and `reflect` are already imported):

```go
// Stage summary flow spec, part D: every AI proposal is a new version, kept in order with its seq,
// also across a "discussion requested" / "changes requested" round trip (older logs). A summary
// proposal is the AI acting in its stage.
func TestProposalVersions(t *testing.T) {
	evs := append(structureEvents(), // seqs 1–8
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),                           // 9
		NewEvent(ActorUser, EvConclusionDiscussionRequested, ConclusionDiscussionRequested{ThreadID: "t_1", Comment: "no"}), // 10
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v2"}),                           // 11
		NewEvent(ActorUser, EvConclusionAccepted, ConclusionAccepted{ThreadID: "t_1", Text: "v2"}),                         // 12
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "s1"}),                // 13
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "more"}), // 14
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "s2"}),                // 15
	)
	s := replay(t, evs...)
	th := s.Threads["t_1"]
	if th.ProposalVersion != 2 || !reflect.DeepEqual(th.Proposals, []Proposal{{Text: "v1", Seq: 9}, {Text: "v2", Seq: 11}}) {
		t.Fatalf("thread: v%d %+v", th.ProposalVersion, th.Proposals)
	}
	st := s.Stage("st_1")
	if st.ProposalVersion != 2 || !reflect.DeepEqual(st.Proposals, []Proposal{{Text: "s1", Seq: 13}, {Text: "s2", Seq: 15}}) || st.LastAISeq != 15 {
		t.Fatalf("stage: v%d %+v, lastAiSeq %d", st.ProposalVersion, st.Proposals, st.LastAISeq)
	}
}

// Part E, Review Focus 1: an AI message.posted line written before stage messages existed replays
// as before, and a thread message still marshals to exactly that shape. A stage message replays
// onto the stage, never into a thread, and belongs to the stage for `tdm log --stage`.
func TestMessagePostedShapes(t *testing.T) {
	old := `{"threadId":"t_1","text":"hi"}`
	if b, err := json.Marshal(MessagePosted{ThreadID: "t_1", Text: "hi"}); err != nil || string(b) != old {
		t.Fatalf("thread message json = %s (%v), want %s", b, err, old)
	}
	stageMsg := Event{Actor: ActorUser, Type: EvMessagePosted, V: 1, Data: json.RawMessage(`{"stageId":"st_1","text":"hello"}`)}
	evs := append(structureEvents(), stageMsg) // structureEvents ends with the AI's thread message "hi"
	s := replay(t, evs...)
	st := s.Stage("st_1")
	if len(st.Messages) != 1 || st.Messages[0] != (Message{Actor: ActorUser, Text: "hello", Seq: 9}) || !st.AwaitingAI() {
		t.Fatalf("stage = %+v", st)
	}
	if th := s.Threads["t_1"]; len(th.Messages) != 1 || th.Messages[0].Text != "hi" {
		t.Fatalf("thread messages = %+v", th.Messages)
	}
	if got := EventStageID(s, evs[len(evs)-1]); got != "st_1" {
		t.Fatalf("stage message stage = %q", got)
	}
}
```

- [ ] **Step 2: Write the failing render, CLI and guide tests**

Append to `internal/render/wait_test.go`:

```go
// Stage summary flow spec, part E: a message on the stage page reaches the agent under its stage,
// as "Stage st_N — message" before a summary and "Stage summary — message" while one is proposed.
func TestWaitStageMessage(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.PostStageMessage{StageID: "st_1", Text: "Start with auth."},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if want := "# Stage st_1 \"API\" — 0/0 threads resolved\n\n## Stage st_1 — message\n\n> Start with auth.\n"; err != nil || got != want {
		t.Fatalf("got %q, %v\nwant %q", got, err, want)
	}

	st, events = domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.ResolveThread{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "REST."},
		&domain.PostStageMessage{StageID: "st_1", Text: "Mention versioning."},
	)
	got, err = Wait(st, domain.PendingUserEvents(events, 5), blobs) // only the message (seq 6)
	if want := "# Stage st_1 \"API\" — 1/1 threads resolved\n\n## Stage summary — message\n\n> Mention versioning.\n"; err != nil || got != want {
		t.Fatalf("got %q, %v\nwant %q", got, err, want)
	}
}
```

Append to `internal/render/views_test.go`:

```go
// Part E, Review Focus 2: a stage message awaits the AI, like a thread message, until the AI acts in
// that stage. AI activity elsewhere (here, adding another stage) does not clear it.
func TestShowStageMessageAwaitingAI(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.PostStageMessage{StageID: "st_1", Text: "Start with auth."},
		&domain.AddStage{Title: "Later"},
	)
	got, err := Show(st, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{
		"\n## Stage st_1 \"API\" — open, awaiting AI\n",
		"\n## Stage st_2 \"Later\" — open\n",
		"\n# Awaiting AI\n\n# Stage st_1 \"API\" — 0/0 threads resolved\n\n## Stage st_1 — message\n\n> Start with auth.\n",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in:\n%s", part, got)
		}
	}

	st, events = domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.PostStageMessage{StageID: "st_1", Text: "Start with auth."},
		&domain.Say{StageID: "st_1", Text: "Will do."},
	)
	got, _ = Show(st, events, blobs)
	if !strings.Contains(got, "\n## Stage st_1 \"API\" — open\n") || !strings.Contains(got, "# Awaiting AI\n\nNothing.") {
		t.Fatalf("answered stage message still awaiting:\n%s", got)
	}
}
```

Append to `internal/cli/content_test.go`:

```go
// Stage summary flow spec, part E: tdm say --stage posts on the stage page and prints the stage id,
// a user stage message reaches tdm wait, and --thread with --stage is a usage error.
func TestSayToStage(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "Storage")
	if out := must(t, "", "say", "--stage", "st_1", "Nothing more planned."); out != "st_1\n" {
		t.Fatalf("say --stage = %q", out)
	}
	userAction(t, home, sid, "stage.message", `{"stageId":"st_1","text":"Thanks, let us stop here."}`)
	if out := must(t, "", "wait", "--timeout", "5s"); !strings.Contains(out, "## Stage st_1 — message\n\n> Thanks, let us stop here.\n") {
		t.Fatalf("wait = %q", out)
	}
	if _, errOut, code := run(t, "", "say", "--thread", "t_1", "--stage", "st_1", "x"); code != 2 || !strings.Contains(errOut, "pass --thread or --stage, not both") {
		t.Fatalf("both ids: %d %q", code, errOut)
	}
	if _, errOut, code := run(t, "", "say", "--stage", "st_9", "x"); code != 1 || !strings.Contains(errOut, "error: stage_not_found:") {
		t.Fatalf("unknown stage: %d %q", code, errOut)
	}
}
```

Append to `internal/guide/guide_test.go`:

```go
// Stage summary flow spec, part E: the agent reads stage messages, answers on the stage, and
// re-proposes the summary when the user asks for changes there.
func TestGuideCoversStageMessages(t *testing.T) {
	for _, s := range []string{
		"## Stage st_N — message",
		"## Stage summary — message",
		"Answer on the stage with `tdm say --stage st_N`",
		"propose again with `tdm stage propose`",
		"[--stage st_N]",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/domain/ ./internal/render/ ./internal/cli/ ./internal/guide/`
Expected: compile FAIL in `domain`, `render` and `cli`: `unknown field StageID in struct literal of type Say` and `undefined: PostStageMessage`. `guide` FAIL: `guide.md does not mention "## Stage st_N — message"` (and the other four strings).

- [ ] **Step 4: Implement the commands, the payload and the state**

In `internal/domain/commands.go`, replace `type Say struct { … }` (lines 32-35 on main):

```go
// Say posts the AI's chat message to a thread (ThreadID, or the latest open thread when both ids
// are empty) or to a stage page (StageID, stage summary flow spec part E). Setting both is an error.
type Say struct {
	ThreadID string `json:"threadId,omitempty"`
	StageID  string `json:"stageId,omitempty"`
	Text     string `json:"text"`
}
```

Directly after `type RequestStageChanges struct { … }`, add:

```go
// PostStageMessage is the user's message on a stage page (stage summary flow spec, part E). It is
// how the user asks for changes to a proposed summary, and any stage takes it, an accepted one too.
type PostStageMessage struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}
```

After `func (*RequestStageChanges) isCommand() {}` add `func (*PostStageMessage) isCommand()    {}`. In the `ActorUser` map of `commandFactories`, after the `"stage.request_changes"` entry, add:

```go
		"stage.message":         func() Command { return &PostStageMessage{} },
```

In `internal/domain/events.go`, replace `MessagePosted` and its comment (lines 89-93 on main):

```go
// MessagePosted is a chat message with exactly one of ThreadID and StageID. In a thread it is the
// AI's (user thread messages arrive inside ReviewSubmitted). On a stage page it is either side's,
// told apart by the event's actor (stage summary flow spec, part E). Both ids are omitempty, so a
// thread message marshals exactly as it did before stage messages existed.
type MessagePosted struct {
	ThreadID string `json:"threadId,omitempty"`
	StageID  string `json:"stageId,omitempty"`
	Text     string `json:"text"`
}
```

In `internal/domain/state.go`, append these fields at the end of `type Stage struct` (after `ThreadIDs`, and after Task 6's `EditedByUser`):

```go
	// The stage page's conversation (stage summary flow spec, part E), and the seqs that tell
	// whether the user's latest stage message still awaits the AI.
	Messages    []Message `json:"messages,omitempty"`
	LastUserSeq int64     `json:"lastUserSeq,omitempty"`
	LastAISeq   int64     `json:"lastAiSeq,omitempty"`
	// ProposalVersion counts the AI's summary proposals; Proposals keeps each one (part D).
	ProposalVersion int        `json:"proposalVersion,omitempty"`
	Proposals       []Proposal `json:"proposals,omitempty"`
```

Append the same two proposal fields at the end of `type Thread struct` (after `LastAISeq`, and after Task 6's `EditedByUser`):

```go
	// ProposalVersion counts the AI's conclusion proposals; Proposals keeps each one (part D).
	ProposalVersion int        `json:"proposalVersion,omitempty"`
	Proposals       []Proposal `json:"proposals,omitempty"`
```

Directly after `type Stage struct { … }`, add:

```go
// AwaitingAI reports whether the user messaged the stage after the AI's last action in it: a stage
// message, a summary proposal or a new thread (part E). Mirrors Thread.AwaitingAI.
func (st *Stage) AwaitingAI() bool {
	return st.LastUserSeq > st.LastAISeq
}

// Proposal is one AI proposal of a thread conclusion or a stage summary. Proposals[i] is version
// i+1. The UI lists the earlier versions in the timeline by Seq (stage summary flow spec, part D).
type Proposal struct {
	Text string `json:"text"`
	Seq  int64  `json:"seq"`
}
```

- [ ] **Step 5: Decide and reduce**

In `internal/domain/decide.go`, replace the `case *Say:` block (lines 28-31 on main):

```go
	case *Say:
		if c.StageID != "" {
			if c.ThreadID != "" {
				return nil, Result{}, errorf(CodeInvalidInput, "pass --thread or --stage, not both", "say goes to a thread or a stage, not both")
			}
			return decideStageMessage(s, ActorAI, c.StageID, c.Text)
		}
		return decideThreadText(s, c.ThreadID, c.Text, func(id string) Event {
			return NewEvent(ActorAI, EvMessagePosted, MessagePosted{ThreadID: id, Text: c.Text})
		})
```

Directly after the `case *RequestStageChanges:` block, add:

```go
	case *PostStageMessage:
		if err := required("stageId", c.StageID); err != nil {
			return nil, Result{}, err
		}
		return decideStageMessage(s, ActorUser, c.StageID, c.Text)
```

Directly after `func decideThreadText`, add:

```go
// decideStageMessage posts a message on a stage page, from the AI (`tdm say --stage`) or the user.
// Any stage takes messages, an accepted one too: that is where the AI wraps up and the user
// answers (stage summary flow spec, parts B and E).
func decideStageMessage(s *State, actor Actor, stageID, text string) ([]Event, Result, error) {
	st := s.Stage(stageID)
	if st == nil {
		return nil, Result{}, errorf(CodeStageNotFound, hintShow, "no stage %s in session %s", stageID, s.Session.ID)
	}
	if err := required("text", text); err != nil {
		return nil, Result{}, err
	}
	return one(NewEvent(actor, EvMessagePosted, MessagePosted{StageID: st.ID, Text: text}), st.ID)
}
```

In `internal/domain/reducer.go`:

1. `case EvThreadCreated:`: after `st.ThreadIDs = append(st.ThreadIDs, p.ID)`, add `st.LastAISeq = e.Seq // a new thread answers a stage message (part E)`.
2. Replace the `case EvMessagePosted:` block:

```go
	case EvMessagePosted:
		p, err := decode[MessagePosted](e)
		if err != nil {
			return err
		}
		if p.StageID != "" {
			st := s.Stage(p.StageID)
			if st == nil {
				return unknown("stage", p.StageID, e)
			}
			st.Messages = append(st.Messages, Message{Actor: e.Actor, Text: p.Text, Seq: e.Seq})
			if e.Actor == ActorUser {
				st.LastUserSeq = e.Seq
			} else {
				st.LastAISeq = e.Seq
			}
			return nil
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Messages = append(t.Messages, Message{Actor: ActorAI, Text: p.Text, Seq: e.Seq})
		t.LastAISeq = e.Seq
```

3. `case EvConclusionProposed:`: after the status assignment line (which Task 6 extended to clear `EditedByUser`), add:

```go
		t.ProposalVersion++
		t.Proposals = append(t.Proposals, Proposal{Text: p.Text, Seq: e.Seq})
```

4. `case EvStageSummaryProposed:`: after the status assignment line (which Task 6 extended), add:

```go
		st.LastAISeq = e.Seq
		st.ProposalVersion++
		st.Proposals = append(st.Proposals, Proposal{Text: p.Text, Seq: e.Seq})
```

- [ ] **Step 6: Render stage messages in `tdm wait` and `tdm session show`**

In `internal/render/wait.go`, add this case directly before `case domain.EvStageSummaryAccepted:`. Only user events reach `Wait`, and every user `message.posted` is a stage message:

```go
	case domain.EvMessagePosted:
		var p domain.MessagePosted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return nil, fmt.Errorf("message on unknown stage %q", p.StageID)
		}
		head := fmt.Sprintf("## Stage %s — message", st.ID)
		if st.Status == domain.StageSummaryProposed {
			head = "## Stage summary — message"
		}
		return []section{{st.ID, head + "\n\n" + Quote(p.Text)}}, nil
```

In `internal/render/views.go`, replace line 19 (`fmt.Fprintf(&b, "\n## Stage %s %q — %s\n", st.ID, st.Title, human(st.Status))`):

```go
		status := human(st.Status)
		if st.AwaitingAI() {
			status += ", awaiting AI"
		}
		fmt.Fprintf(&b, "\n## Stage %s %q — %s\n", st.ID, st.Title, status)
```

In `awaiting`, directly after the `if e.Actor != domain.ActorUser { continue }` block, add:

```go
		// A stage message awaits the AI until the AI acts in that stage (part E, Review Focus 2),
		// not until it acts anywhere, as other stage- and session-level events do below.
		if e.Type == domain.EvMessagePosted {
			if st := s.Stage(domain.EventStageID(s, e)); st != nil && st.AwaitingAI() && e.Seq > st.LastAISeq {
				out = append(out, e)
			}
			continue
		}
```

Update the doc comment of `awaiting` to: `// awaiting returns user events the AI has not acted on: thread events newer than the thread's last AI action, stage messages newer than the stage's, and session/stage events newer than the AI's last action anywhere.`

- [ ] **Step 7: `tdm say --stage`**

In `internal/cli/content.go`, replace `sayCmd`:

```go
func (a *app) sayCmd() *cobra.Command {
	var thread, stage string
	cmd := &cobra.Command{
		Use: "say [text]", Short: "Post a chat message to a thread, or to a stage page with --stage", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if thread != "" && stage != "" {
				return &usageError{"pass --thread or --stage, not both"}
			}
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "say", domain.Say{ThreadID: thread, StageID: stage, Text: text})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	cmd.Flags().StringVar(&stage, "stage", "", "stage id: post on the stage page instead of a thread")
	return cmd
}
```

- [ ] **Step 8: Update the guide and the design doc**

In `internal/guide/guide.md`, replace step 6 of `## The loop` (as Task 6 left it):

```markdown
6. When every thread of the stage is resolved, run `tdm stage summarize` and write a summary that **covers the
   conclusion of every thread**. Then `tdm stage propose "<summary>"` and `tdm wait`. If the user sends
   `changes requested`, revise and propose again. `stage summary — edited` works like `conclusion edited`:
   the quoted text is now the proposed summary. Do not propose over it unless the user asks for changes:
   wait for the accept.
```

with:

```markdown
6. When every thread of the stage is resolved, run `tdm stage summarize` and write a summary that **covers the
   conclusion of every thread**. Then `tdm stage propose "<summary>"` and `tdm wait`. The user asks for changes
   by messaging the stage (`Stage summary — message`): answer there, revise, and propose again.
   `stage summary — edited` works like `conclusion edited`: the quoted text is now the proposed summary. Do not
   propose over it unless the user asks for changes: wait for the accept.
```

(Task 6's `TestGuideCoversRevisedProposals` strings and Task 4's step 7, including ``tdm say --stage st_N "…"``, stay as they are.)

In `## Reading \`tdm wait\` output`, directly before the bullet `- User text is always quoted with \`> \`. …`, insert:

```markdown
- `## Stage st_N — message` (no summary proposed yet) and `## Stage summary — message` (your summary is
  proposed) are messages the user wrote on the stage page. Answer on the stage with `tdm say --stage st_N`.
  When they ask for changes to the summary, revise it and propose again with `tdm stage propose`.
```

In the `## Commands` table, replace the row ``| `tdm say ["<text>"] [--thread t_N]` | chat message in a thread |`` with:

```markdown
| `tdm say ["<text>"] [--thread t_N] [--stage st_N]` | chat message in a thread, or on the stage page with `--stage` (not both) |
```

In `docs/superpowers/specs/2026-09-25-tandem-design.md`, replace the CLI line `tdm say "<text>" [--thread t_N]             AI chat message` with:

```
tdm say "<text>" [--thread t_N | --stage st_N]  AI chat message in a thread or on a stage page
```

In the user event table, directly after the `` | `stage.summary.changes_requested` | `comment` | `` row, add:

```
| `message.posted` (user, on a stage) | `stageId`, `text` (a message on the stage page; the AI's `tdm say --stage` posts the same event as actor `ai`) |
```

- [ ] **Step 9: Pin a stage conversation in the snapshot fixture**

In `internal/daemon/contract_test.go`, after the last `run(...)` (`run(&domain.Say{ThreadID: "t_2", Text: "Noted: user lookups are cached too."})`), add:

```go
	// Stage summary flow spec, part E: a stage conversation (seqs 23 and 24), so the web tests see
	// Stage.messages, lastAiSeq and lastUserSeq. t_2's conclusion (seq 17) is proposal v1.
	run(&domain.Say{StageID: "st_2", Text: "Next we pick the API style."})
	run(&domain.PostStageMessage{StageID: "st_2", Text: "REST, please."})
```

Run: `go test ./internal/daemon -run TestSnapshotContractFixture -update && git diff --stat web/src/test/fixtures/snapshot.json`
Expected: the fixture changes in these places:
- `st_1` gains `"lastAiSeq": 10` (t_3's `thread.created`);
- `st_2` gains `messages` (the AI message at seq 23, the user message at seq 24), `"lastUserSeq": 24` and `"lastAiSeq": 23`;
- `t_2` gains `"proposalVersion": 1` and `"proposals": [{"text": "Use a lazy delegate for the cache.", "seq": 17}]`;
- `lastSeq` becomes 24 and `lastAiSeq` becomes 23.

- [ ] **Step 10: Run all tests**

Run: `gofmt -w internal && gofmt -l internal; go test ./... && (cd web && npm test)`
Expected: `gofmt -w` realigns the trailing seq comments in `TestProposalVersions`, and `gofmt -l` then lists no files. Everything passes, including `TestSnapshotContractFixture`, `e2e/TestFullLoop` and the whole web suite. The UI does not read the new keys yet, and nothing in it deep-compares a stage or `t_2`.

- [ ] **Step 11: Commit**

```bash
git add internal/domain internal/render internal/cli internal/guide internal/daemon/contract_test.go web/src/test/fixtures/snapshot.json docs/superpowers/specs/2026-09-25-tandem-design.md
git commit -m "feat(domain): stage messages and proposal versions

tdm say --stage and the user's stage.message post message.posted with a
stageId; stages keep their messages and await the AI like threads do.
tdm wait shows them as \"Stage st_N — message\" or \"Stage summary —
message\". Threads and stages number their proposals and keep each
one for the timeline."
```

---

### Task 9: Web: collapsible proposal card for the proposed conclusion, with its earlier versions (Part D, thread side)

**Files:**
- Create: `web/src/proposal/proposals.ts` (`previewOf`, `earlierProposals`)
- Create: `web/src/proposal/useProposalCollapse.ts`
- Create: `web/src/proposal/ProposalCard.tsx` (`ProposalCard`, `EarlierProposal`)
- Modify: `web/src/api/types.ts` (`Proposal`, `proposalVersion`/`proposals` on `Thread` and `Stage`)
- Modify: `web/src/thread/timeline.ts` (a `proposal` timeline item)
- Modify: `web/src/thread/ConclusionCard.tsx` (the proposed branch through `ProposalCard`)
- Modify: `web/src/thread/ThreadView.tsx` (the collapse state, earlier versions, auto-collapse on send)
- Modify: `web/src/styles/app.css` (the proposal card block)
- Test: `web/src/proposal/proposals.test.ts`, `web/src/proposal/useProposalCollapse.test.ts`, `web/src/proposal/ProposalCard.test.tsx`, `web/src/thread/timeline.test.ts`, `web/src/thread/ThreadView.test.tsx`, `web/src/api/types.test.ts`, `web/src/styles/proposal.test.ts`

**Interfaces:**
- Consumes: `Thread.proposalVersion` / `Thread.proposals` in the snapshot (Task 8). From Task 7: `Thread.editedByUser`, the `Save` editor (`save`, `saving`, the re-proposal effect) and its `.edited-by-you` marker. From Task 2: `busy` and `accept()` in `ConclusionCard`.
- Produces:
  - `interface Proposal { text: string; seq: number }`, and `proposalVersion?: number` / `proposals?: Proposal[]` on `Thread` and `Stage`;
  - `previewOf(text: string): string`;
  - `interface PastProposal { version: number; seq: number; text: string }` and `earlierProposals(proposals: Proposal[] | undefined, newestShown: boolean): PastProposal[]`;
  - `interface ProposalCollapse { collapsed: boolean; updated: boolean; toggle(): void; collapse(): void }` and `useProposalCollapse(version: number): ProposalCollapse`;
  - `ProposalCard(props: { label: string; kicker: string; text: string; version: number; editedByUser?: boolean; actions?: ReactNode; collapsed: boolean; onToggle(): void; updated: boolean; body?: ReactNode; land?: string })`;
  - `EarlierProposal(props: { kicker: string; version: number; text: string })`;
  - `TimelineItem` gains `{ kind: 'proposal'; seq: number; version: number; text: string }`;
  - `ConclusionCard({ thread, proposal, onResolved }: { thread: Thread; proposal: ProposalCollapse; onResolved?: () => void })`.

- [ ] **Step 1: Write the failing unit tests**

Create `web/src/proposal/proposals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { earlierProposals, previewOf } from './proposals'

describe('previewOf (stage summary flow spec, part D)', () => {
  it('is the first sentence of the first paragraph, as plain text', () => {
    expect(previewOf('Use a lazy delegate for the cache. It is built on first use.')).toBe('Use a lazy delegate for the cache.')
    expect(previewOf('## Summary\n\nWe keep **JSONL** logs. Blobs by hash.')).toBe('We keep JSONL logs.')
    expect(previewOf('- Keep `v0` logs, see t_2.\n- Export')).toBe('Keep v0 logs, see t_2.')
    expect(previewOf('Version 1.2 is out')).toBe('Version 1.2 is out')
    expect(previewOf('## Only a heading')).toBe('Only a heading')
    expect(previewOf('')).toBe('')
  })
})

describe('earlierProposals', () => {
  const proposals = [
    { text: 'v1', seq: 17 },
    { text: 'v2', seq: 23 },
  ]
  it('numbers the proposals and leaves out the newest while the card (or the accepted text) shows it', () => {
    expect(earlierProposals(proposals, true)).toEqual([{ version: 1, seq: 17, text: 'v1' }])
    expect(earlierProposals(proposals, false)).toEqual([
      { version: 1, seq: 17, text: 'v1' },
      { version: 2, seq: 23, text: 'v2' },
    ])
    expect(earlierProposals(undefined, true)).toEqual([])
  })
})
```

Create `web/src/proposal/useProposalCollapse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useProposalCollapse } from './useProposalCollapse'

// Review Focus 3: never auto-expands; "Updated" only for a version newer than the collapse; expanding clears it.
describe('useProposalCollapse (stage summary flow spec, part D)', () => {
  it('collapses on request, flags newer versions, and clears the flag on expand', () => {
    const { result, rerender } = renderHook(({ v }) => useProposalCollapse(v), { initialProps: { v: 1 } })
    expect(result.current).toMatchObject({ collapsed: false, updated: false })

    act(() => result.current.collapse())
    expect(result.current).toMatchObject({ collapsed: true, updated: false })

    rerender({ v: 2 }) // the AI re-proposes: still collapsed, now "Updated"
    expect(result.current).toMatchObject({ collapsed: true, updated: true })
    act(() => result.current.collapse()) // a second send keeps the flag
    expect(result.current).toMatchObject({ collapsed: true, updated: true })

    act(() => result.current.toggle())
    expect(result.current).toMatchObject({ collapsed: false, updated: false })

    rerender({ v: 3 })
    act(() => result.current.toggle()) // collapsed by hand at v3: nothing newer yet
    expect(result.current).toMatchObject({ collapsed: true, updated: false })
  })
})
```

Create `web/src/proposal/ProposalCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithCtx } from '../test/session'
import { EarlierProposal, ProposalCard } from './ProposalCard'

const TEXT = 'Use a lazy delegate. It is built on first use.'

function card(over: Partial<Parameters<typeof ProposalCard>[0]> = {}) {
  return (
    <ProposalCard
      label="Proposed conclusion"
      kicker="Proposed conclusion"
      text={TEXT}
      version={1}
      collapsed={false}
      updated={false}
      onToggle={() => {}}
      actions={<button type="button">Accept</button>}
      {...over}
    />
  )
}

describe('ProposalCard (stage summary flow spec, part D)', () => {
  it('shows the version from v2 on, the edited marker, and the actions and toggle in its header', () => {
    const { rerender } = renderWithCtx(card())
    const region = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(region).queryByText(/· v\d/)).toBeNull()
    expect(within(region).queryByText('edited by you')).toBeNull()
    expect(region).toHaveTextContent('It is built on first use.')

    rerender(card({ version: 3, editedByUser: true }))
    expect(within(region).getByText('· v3')).toBeInTheDocument()
    expect(within(region).getByText('edited by you')).toHaveClass('edited-by-you')
    const head = region.querySelector('.proposal-head') as HTMLElement
    expect(within(head).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(head).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses to a one-line preview, keeps the actions, and shows Updated', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    renderWithCtx(card({ collapsed: true, updated: true, onToggle }))
    const region = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(region.querySelector('.proposal-preview')).toHaveTextContent(/^Use a lazy delegate\.$/)
    expect(region.querySelector('.prose')).toBeNull()
    expect(within(region).getByText('Updated')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    const toggle = within(region).getByRole('button', { name: 'Expand' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows the editor instead of the text, even collapsed, and hides the toggle meanwhile', () => {
    renderWithCtx(card({ collapsed: true, actions: null, body: <textarea aria-label="Edit conclusion" /> }))
    expect(screen.getByRole('textbox', { name: 'Edit conclusion' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Expand|Collapse)$/ })).toBeNull()
    expect(document.querySelector('.proposal-preview')).toBeNull()
  })

  it('carries the landing target', () => {
    renderWithCtx(card({ land: 'proposed-summary' }))
    expect(screen.getByRole('region', { name: 'Proposed conclusion' })).toHaveAttribute('data-land', 'proposed-summary')
  })
})

describe('EarlierProposal', () => {
  it('is a closed "vN" entry, like a superseded block', () => {
    renderWithCtx(<EarlierProposal kicker="Proposed conclusion" version={1} text="Empty map." />)
    const entry = screen.getByText('Proposed conclusion · v1').closest('details') as HTMLElement
    expect(entry).toHaveClass('superseded')
    expect(entry).not.toHaveAttribute('open')
    expect(entry).toHaveTextContent('Empty map.')
  })
})
```

Create `web/src/styles/proposal.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('proposal card (stage summary flow spec, part D)', () => {
  it('pulses the Updated pill once, and keeps it still under reduced motion', () => {
    expect(appCss).toMatch(/\.proposal-updated\s*{[^}]*animation:\s*tdm-updated-pulse\s[^;]*\s1;/)
    expect(appCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.proposal-updated\s*{\s*animation:\s*none;?\s*}/)
  })

  it('clips the collapsed preview to one line', () => {
    expect(appCss).toMatch(/\.proposal-preview\s*{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/)
  })
})
```

In `web/src/thread/timeline.test.ts`, replace the `.map` expression of `interleaves blocks and messages by seq` (line 9) so it compiles with the new item kind:

```ts
    expect(items.map((i) => (i.kind === 'block' ? i.block.id : i.kind === 'message' ? `${i.message.actor}:${i.message.text}` : `v${i.version}`))).toEqual([
```

and append inside `describe('timeline', …)`:

```ts
  // Stage summary flow spec, part D: earlier proposals sit in the timeline at their seq; the newest
  // is the live card and is not listed, unless the thread went back to open.
  it('lists earlier conclusion proposals by seq', () => {
    const { state } = fixtureSnapshot()
    const t2 = {
      ...state.threads.t_2,
      proposalVersion: 2,
      proposals: [
        { text: 'Empty map.', seq: 17 },
        { text: 'Use a lazy delegate for the cache.', seq: 23 },
      ],
    }
    const items = timeline(state, t2)
    expect(items.filter((i) => i.kind === 'proposal')).toEqual([{ kind: 'proposal', seq: 17, version: 1, text: 'Empty map.' }])
    expect(items.map((i) => i.seq)).toEqual([...items.map((i) => i.seq)].sort((a, b) => a - b))
    expect(timeline(state, { ...t2, status: 'open', proposedConclusion: undefined }).filter((i) => i.kind === 'proposal')).toHaveLength(2)
  })
```

In `web/src/api/types.test.ts`, append inside `describe('normalizeSnapshot', …)`:

```ts
  // Stage summary flow spec, part D: the proposal history in the contract fixture.
  it('reads proposal versions', () => {
    const t2 = normalizeSnapshot(fixture).state.threads.t_2
    expect(t2.proposalVersion).toBe(1)
    expect(t2.proposals).toEqual([{ text: 'Use a lazy delegate for the cache.', seq: 17 }])
  })
```

- [ ] **Step 2: Write the failing ThreadView tests**

Append to `web/src/thread/ThreadView.test.tsx` (all helpers are already imported):

```tsx
describe('ThreadView proposal card (stage summary flow spec, part D)', () => {
  it('collapses the proposed conclusion after a sent message, keeping Accept and Edit in its header', async () => {
    const user = userEvent.setup()
    renderStateful(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(card).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Why lazy?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(within(card).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(card.querySelector('.proposal-preview')).toHaveTextContent('Use a lazy delegate for the cache.')
    expect(card.querySelector('.prose')).toBeNull()
    expect(within(card).getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('keeps the card open when the send fails', async () => {
    const user = userEvent.setup()
    renderStateful(<ThreadView threadId="t_2" />, { sendReview: vi.fn(async () => false) })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Why lazy?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a conclusion proposed after a sent message expanded', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Conclude, please.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    base.state.threads.t_1 = {
      ...base.state.threads.t_1,
      status: 'conclusion_proposed',
      proposedConclusion: 'Keep the repository.',
      proposalVersion: 1,
      proposals: [{ text: 'Keep the repository.', seq: 30 }],
    }
    rerender(<ThreadView threadId="t_1" />)
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows Updated when the AI re-proposes while collapsed, and clears it on expand', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Updated')).toBeNull()

    const next = 'Lazy delegate, documented. Tests cover it.'
    base.state.threads.t_2 = {
      ...base.state.threads.t_2,
      proposedConclusion: next,
      proposalVersion: 2,
      proposals: [...(base.state.threads.t_2.proposals ?? []), { text: next, seq: 30 }],
    }
    rerender(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(card).getByText('Updated')).toBeInTheDocument()
    expect(within(card).getByText('· v2')).toBeInTheDocument()
    expect(card.querySelector('.proposal-preview')).toHaveTextContent(/^Lazy delegate, documented\.$/)

    await user.click(within(card).getByRole('button', { name: 'Expand' }))
    expect(within(card).queryByText('Updated')).toBeNull()
    expect(card).toHaveTextContent('Tests cover it.')
  })

  it('lists earlier proposals as closed vN entries in the timeline', () => {
    const base = makeCtx()
    base.state.threads.t_2 = {
      ...base.state.threads.t_2,
      proposalVersion: 2,
      proposals: [
        { text: 'Empty map.', seq: 17 },
        { text: 'Use a lazy delegate for the cache.', seq: 23 },
      ],
    }
    const { container } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const earlier = screen.getByText('Proposed conclusion · v1').closest('details') as HTMLElement
    expect(earlier).not.toHaveAttribute('open')
    expect(earlier).toHaveTextContent('Empty map.')
    expect(container.querySelectorAll('.conclusion')).toHaveLength(1) // the entry is not a second card
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/proposal src/styles/proposal.test.ts src/thread/timeline.test.ts src/thread/ThreadView.test.tsx src/api/types.test.ts`
Expected: FAIL. `src/proposal/*` cannot resolve `./proposals`, `./useProposalCollapse` and `./ProposalCard`. `proposal.test.ts` finds no `.proposal-updated` rule. The new timeline and ThreadView tests fail (no `Collapse` button, no `Proposed conclusion · v1`). `reads proposal versions` passes at runtime (Task 8 regenerated the fixture), and `npm run typecheck` fails on it (`proposalVersion` does not exist on `Thread`).

- [ ] **Step 4: Types, pure helpers and the collapse hook**

In `web/src/api/types.ts`, directly before `export interface Thread`, add:

```ts
/** One AI proposal of a conclusion or stage summary; proposals[i] is version i + 1 (stage summary flow spec, part D). */
export interface Proposal {
  text: string
  seq: number
}
```

and append to both `interface Thread` and `interface Stage`:

```ts
  /** How many times the AI proposed; absent before the first proposal. */
  proposalVersion?: number
  proposals?: Proposal[]
```

Create `web/src/proposal/proposals.ts`:

```ts
import type { Proposal } from '../api/types'

// previewOf is the one-line preview of a collapsed proposal card (stage summary flow spec, part D):
// the first sentence of the first paragraph that is not a heading (the heading when that is all
// there is), as plain text. List, quote and heading markers at its start and bold and code marks
// are dropped. Single `*` and `_` stay, so ids like t_2 survive. The sentence ends at the first
// `.`, `!` or `?` followed by a space or the end of the line, and CSS clips what does not fit.
export function previewOf(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const line = lines.find((l) => !l.startsWith('#')) ?? lines[0] ?? ''
  const plain = line.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '').replace(/\*\*|__|`/g, '')
  return /^.*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain
}

export interface PastProposal {
  version: number
  seq: number
  text: string
}

// earlierProposals are the proposals the timeline lists as closed "vN" entries (part D). The
// newest is left out while something else shows it: the live card (proposed) or the accepted
// text (resolved or accepted). With nothing proposed any more (a thread or stage sent back to open
// by "discussion requested" / "changes requested" in older logs), every version is listed.
export function earlierProposals(proposals: Proposal[] | undefined, newestShown: boolean): PastProposal[] {
  const all = (proposals ?? []).map((p, i) => ({ version: i + 1, seq: p.seq, text: p.text }))
  return newestShown ? all.slice(0, -1) : all
}
```

Create `web/src/proposal/useProposalCollapse.ts`:

```ts
import { useCallback, useRef, useState } from 'react'

export interface ProposalCollapse {
  collapsed: boolean
  /** The AI proposed a newer version since the card was collapsed. Expanding clears it. */
  updated: boolean
  toggle(): void
  /** Collapses the card (after a sent message, part D). Never expands it. */
  collapse(): void
}

// useProposalCollapse is the collapse state of one proposal card (stage summary flow spec, part
// D). It lives in memory only: its caller remounts per thread or stage, and a reload resets it. The
// card remembers the version it was collapsed at, so a newer proposal flags "Updated" without ever
// expanding the card (Review Focus 3).
export function useProposalCollapse(version: number): ProposalCollapse {
  const [collapsedAt, setCollapsedAt] = useState<number | null>(null)
  const versionRef = useRef(version)
  versionRef.current = version
  const collapse = useCallback(() => setCollapsedAt((at) => at ?? versionRef.current), [])
  const toggle = useCallback(() => setCollapsedAt((at) => (at === null ? versionRef.current : null)), [])
  return { collapsed: collapsedAt !== null, updated: collapsedAt !== null && version > collapsedAt, toggle, collapse }
}
```

- [ ] **Step 5: The card and the earlier-version entry**

Create `web/src/proposal/ProposalCard.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Prose } from '../markdown/Prose'
import { previewOf } from './proposals'

// ProposalCard is the live card of an AI proposal the user acts on: a thread's proposed conclusion
// or a stage's proposed summary (stage summary flow spec, part D). The header row holds the
// following, so Accept and Edit stay in reach while the card is collapsed:
// - the kicker and the version (· vN, from v2 on);
// - the "edited by you" marker (part C) and the Updated pill;
// - the actions and the collapse toggle.
// Collapsed, the body is a one-line preview. `body` (the Edit editor) replaces the text, even on a
// collapsed card, and hides the toggle meanwhile.
export function ProposalCard({
  label,
  kicker,
  text,
  version,
  editedByUser = false,
  actions,
  collapsed,
  onToggle,
  updated,
  body,
  land,
}: {
  /** The region's accessible name, e.g. "Proposed conclusion". */
  label: string
  kicker: string
  text: string
  /** 1 for the first proposal. */
  version: number
  editedByUser?: boolean
  actions?: ReactNode
  collapsed: boolean
  onToggle(): void
  /** A newer version arrived while the card was collapsed. */
  updated: boolean
  body?: ReactNode
  /** useFollowBottom's landing target (demo2 follow-up 6). */
  land?: string
}) {
  const folded = collapsed && !body
  return (
    <section className={folded ? 'conclusion proposal is-collapsed' : 'conclusion proposal'} aria-label={label} data-land={land}>
      <div className="proposal-head">
        <span className="kicker">{kicker}</span>
        {version > 1 && <span className="proposal-version">{`· v${version}`}</span>}
        {editedByUser && <span className="edited-by-you">edited by you</span>}
        {updated && <span className="proposal-updated">Updated</span>}
        <span className="proposal-actions">
          {actions}
          {!body && (
            <button type="button" className="btn link proposal-toggle" aria-expanded={!collapsed} onClick={onToggle}>
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </span>
      </div>
      {body ?? (folded ? <p className="proposal-preview">{previewOf(text)}</p> : <Prose text={text} />)}
    </section>
  )
}

// EarlierProposal is an earlier version of a proposal in the timeline: closed by default, like a
// superseded block (Superseded.tsx), and opened to read it (part D).
export function EarlierProposal({ kicker, version, text }: { kicker: string; version: number; text: string }) {
  return (
    <details className="superseded proposal-earlier">
      <summary>{`${kicker} · v${version}`}</summary>
      <Prose text={text} />
    </details>
  )
}
```

In `web/src/styles/app.css`, directly after `.superseded[open] summary { margin-bottom: 8px; }` (line 365 on main), add:

```css
/* ---- Proposal card (stage summary flow spec, part D) ---- */
/* One header row for the kicker, version, markers, actions and toggle, so Accept and Edit stay in
   reach while the card is collapsed to its one-line preview. */
.proposal-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-family: var(--font-ui); }
.proposal-head .kicker { margin-bottom: 0; }
.proposal-version { font-size: 0.6875rem; color: var(--faint); }
.proposal-head .edited-by-you { font-size: 0.6875rem; color: var(--muted); }
.proposal-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.proposal > .prose, .proposal > .comment-editor { margin-top: 8px; }
.proposal-preview { margin: 6px 0 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); font-family: var(--font-prose); }
/* "Updated": the AI re-proposed while the card was collapsed. It pulses once, and is a still accent
   pill under reduced motion. */
.proposal-updated { font: 600 0.6875rem/1.4 var(--font-ui); color: var(--accent-fg); background: var(--accent); border-radius: 999px; padding: 0 8px; animation: tdm-updated-pulse 1.2s ease-out 1; }
@keyframes tdm-updated-pulse {
  from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent); }
  to { box-shadow: 0 0 0 8px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .proposal-updated { animation: none; }
}
```

Task 7's `.conclusion .kicker .edited-by-you` rule stays for now: the stage summary still shows its marker inside the old kicker until Task 11, which deletes that rule.

- [ ] **Step 6: Earlier versions in the thread timeline**

In `web/src/thread/timeline.ts`, add `import { earlierProposals } from '../proposal/proposals'`, and replace lines 4-15 (`TimelineItem` and `timeline`):

```ts
export type TimelineItem =
  | { kind: 'block'; seq: number; block: Block }
  | { kind: 'message'; seq: number; message: Message }
  | { kind: 'proposal'; seq: number; version: number; text: string }

// timeline orders a thread's blocks, chat messages and earlier conclusion proposals (stage summary
// flow spec, part D) by event seq. The newest proposal is the live card, or the accepted
// conclusion, and is not listed while the thread is proposed or resolved.
export function timeline(state: State, thread: Thread): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const id of thread.blockIds) {
    const block = state.blocks[id]
    if (block) items.push({ kind: 'block', seq: block.seq, block })
  }
  for (const message of thread.messages) items.push({ kind: 'message', seq: message.seq, message })
  for (const p of earlierProposals(thread.proposals, thread.status !== 'open')) items.push({ kind: 'proposal', ...p })
  return items.sort((a, b) => a.seq - b.seq)
}
```

- [ ] **Step 7: The conclusion card through `ProposalCard`**

In `web/src/thread/ConclusionCard.tsx`, add the imports `import { ProposalCard } from '../proposal/ProposalCard'` and `import type { ProposalCollapse } from '../proposal/useProposalCollapse'`. Change the signature to:

```tsx
export function ConclusionCard({ thread, proposal, onResolved }: { thread: Thread; proposal: ProposalCollapse; onResolved?: () => void }) {
```

After Tasks 2 and 7, the proposed branch's `return` (after `const text = thread.proposedConclusion ?? ''` and Task 7's `save`) reads:

```tsx
  return (
    <section className="conclusion" aria-label="Proposed conclusion">
      <div className="kicker">
        Proposed conclusion
        {thread.editedByUser && <span className="edited-by-you">edited by you</span>}
      </div>
      {mode === 'edit' ? (
        <CommentEditor
          label="Edit conclusion"
          initial={text}
          submitLabel="Save"
          autoGrow
          onSave={(t) => void save(t)}
          onCancel={() => setMode('view')}
        />
      ) : (
        <Prose text={text} />
      )}
      {mode === 'view' && !readOnly && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void accept()}>
            Accept <kbd>a</kbd>
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setMode('edit')}>
            Edit
          </button>
        </div>
      )}
    </section>
  )
```

Replace it with the version below. It keeps Task 7's `CommentEditor` element (and its `save`) and Task 2's guarded buttons unchanged, and only moves them into the card's `body` and `actions`. The hooks (`busy`, `inFlight`, `accept`, `saving` and the re-proposal effect) stay where Tasks 2 and 7 put them:

```tsx
  return (
    <ProposalCard
      label="Proposed conclusion"
      kicker="Proposed conclusion"
      text={text}
      version={thread.proposalVersion ?? 1}
      editedByUser={thread.editedByUser}
      collapsed={proposal.collapsed}
      updated={proposal.updated}
      onToggle={proposal.toggle}
      body={
        mode === 'edit' ? (
          <CommentEditor
            label="Edit conclusion"
            initial={text}
            submitLabel="Save"
            autoGrow
            onSave={(t) => void save(t)}
            onCancel={() => setMode('view')}
          />
        ) : undefined
      }
      actions={
        mode === 'view' && !readOnly ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void accept()}>
              Accept <kbd>a</kbd>
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode('edit')}>
              Edit
            </button>
          </>
        ) : null
      }
    />
  )
```

Remove the `Prose` import if nothing else in the file uses it. The resolved branch still uses it, so it normally stays.

- [ ] **Step 8: The thread wires the card and collapses it on send**

In `web/src/thread/ThreadView.tsx`, add:

```tsx
import { EarlierProposal } from '../proposal/ProposalCard'
import { useProposalCollapse } from '../proposal/useProposalCollapse'
```

In `ThreadBody`, after `const keyQuestion = openQuestion(thread)?.id`, add:

```tsx
  // Part D: the proposal card's collapse state lives here, next to the composer that collapses it.
  // ThreadBody is keyed on the thread, so each thread starts expanded.
  const proposal = useProposalCollapse(thread.proposalVersion ?? 0)
```

Pass `proposal={proposal}` to both `<ConclusionCard … />` elements (lines 52 and 87 on main). Replace the first branch of the timeline map (`item.kind === 'block' ? (` on line 54) so earlier versions render first:

```tsx
      {timeline(state, thread).map((item) =>
        item.kind === 'proposal' ? (
          <EarlierProposal key={`p${item.version}`} kicker="Proposed conclusion" version={item.version} text={item.text} />
        ) : item.kind === 'block' ? (
```

The rest of the map is unchanged. Replace `<Composer thread={thread} onSent={onSent} />` with:

```tsx
      <Composer
        thread={thread}
        onSent={() => {
          // Part D: a sent message collapses the live card so the reply stays in view. A card that
          // appears later starts expanded (Review Focus 3).
          if (thread.status === 'conclusion_proposed') proposal.collapse()
          onSent?.()
        }}
      />
```

- [ ] **Step 9: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. The existing ThreadView tests still pass: `keeps a proposed conclusion at the bottom` counts one `.conclusion`, the card is still the region `Proposed conclusion`, and `Accept`/`Edit`/`Save` keep their names. `SessionPage.followBottom.test.tsx` still passes: the stage's proposed summary is unchanged until Task 11.

- [ ] **Step 10: Commit**

Discard webdist changes if a build touched them: `git checkout internal/daemon/webdist`.

```bash
git add web/src/proposal web/src/api web/src/thread web/src/styles
git commit -m "feat(web): collapsible proposal card with versions

The proposed conclusion shows its version and keeps Accept and Edit in
its header. A sent message collapses it to a one-line preview; a
re-proposal while collapsed shows an Updated pill. Earlier proposals
appear in the timeline as closed vN entries."
```

---

### Task 10: Web: talk to the AI on the stage page, without Request changes (Part E)

**Files:**
- Modify: `web/src/api/types.ts` (stage conversation fields, the `stage.message` action)
- Modify: `web/src/thread/delivery.ts` (`isUndelivered`/`isReplying` take `{ lastAiSeq }`, `stageIsReplying`, `stageDeliveryStatus`)
- Modify: `web/src/thread/Composer.tsx` (`ComposerBox` core, `StageComposer`)
- Modify: `web/src/draft/threadText.ts` (doc comment: stage ids share the composer key)
- Modify: `web/src/stage/StageView.tsx` (messages, reply bubble, composer; Request changes removed)
- Modify: `web/src/shell/SessionPage.tsx` (`onSent` to the stage, the stage content key, landing only on a new summary)
- Modify: `web/src/styles/app.css` (`.stage` fills the page so the composer sits at the bottom)
- Test: `web/src/thread/delivery.test.ts`, `web/src/thread/Composer.test.tsx`, `web/src/stage/StageView.test.tsx`, `web/src/shell/SessionPage.followBottom.test.tsx`, `web/src/api/types.test.ts`, `web/src/styles/stage.test.ts`

**Interfaces:**
- Consumes: `Stage.messages` / `lastUserSeq` / `lastAiSeq` in the snapshot and the user command `stage.message` (Task 8), `MessageView`, `TypingBubble`, `useThreadText`.
- Produces:
  - `Stage.messages?: Message[]`, `Stage.lastUserSeq?: number`, `Stage.lastAiSeq?: number`;
  - `Action` member `{ type: 'stage.message'; data: { stageId: string; text: string } }`;
  - `isUndelivered(msgSeq: number, item: { lastAiSeq: number }, delivered: number)`, `isReplying(msgSeq: number, item: { lastAiSeq: number }, delivered: number)` (only the parameter types are widened);
  - `stageIsReplying(stage: Stage, delivered: number, waiting: boolean): boolean`, `stageDeliveryStatus(msgSeq: number, stage: Stage, delivered: number): string | null`;
  - `StageComposer({ stage, onSent }: { stage: Stage; onSent?: () => void })`;
  - `StageView({ stageId, onAccepted, onEnd, onSent }: { stageId: string; onAccepted?: () => void; onEnd?: () => void; onSent?: () => void })` (Task 5's props plus `onSent`).

- [ ] **Step 1: Write the failing unit tests**

In `web/src/thread/delivery.test.ts`, change the import from `./delivery` to:

```ts
import {
  deliveryStatus,
  isReplying,
  isUndelivered,
  stageAwaitsNextStep,
  stageAwaitsSummary,
  stageDeliveryStatus,
  stageIsReplying,
  threadIsReplying,
} from './delivery'
```

and append:

```ts
// Stage summary flow spec, part E, Review Focus 2: the stage's own seqs decide.
describe('stage conversation', () => {
  const stage: Stage = { id: 'st_1', title: 'Data model', status: 'summary_proposed', threadIds: [], lastUserSeq: 31, lastAiSeq: 30 }

  it('is replying once the stage message was delivered, never while the agent waits in tdm wait', () => {
    expect(stageIsReplying(stage, 30, false)).toBe(false) // not delivered yet
    expect(stageIsReplying(stage, 31, false)).toBe(true)
    expect(stageIsReplying(stage, 31, true)).toBe(false)
    expect(stageIsReplying({ ...stage, lastAiSeq: 32 }, 32, false)).toBe(false) // the AI answered
    expect(stageIsReplying({ id: 'st_2', title: 'API', status: 'open', threadIds: [] }, 40, false)).toBe(false)
  })

  it('says a stage message is sent until the AI picks it up', () => {
    expect(stageDeliveryStatus(31, stage, 0)).toBe('Sent · waiting for the AI to pick it up')
    expect(stageDeliveryStatus(31, stage, 31)).toBeNull()
    expect(stageDeliveryStatus(31, { ...stage, lastAiSeq: 31 }, 0)).toBeNull()
  })
})
```

In `web/src/thread/Composer.test.tsx`, change the imports to:

```tsx
import type { Stage, Thread } from '../api/types'
import { Composer, StageComposer } from './Composer'
```

and append:

```tsx
describe('StageComposer (stage summary flow spec, part E)', () => {
  const stage: Stage = { id: 'st_1', title: 'Data model', status: 'open', threadIds: [] }

  it('sends the trimmed text as a stage message and forgets it', async () => {
    const user = userEvent.setup()
    const onSent = vi.fn()
    const { ctx } = renderStateful(<StageComposer stage={stage} onSent={onSent} />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '  Mention blobs.  ')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Mention blobs.' } })
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue(''))
    expect(loadThreadText('composer', 's_fixture', 'st_1')).toBe('')
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('needs text to send, keeps unsent text per stage, and keeps it when the send fails', async () => {
    const user = userEvent.setup()
    const first = renderStateful(<StageComposer stage={stage} />, { run: vi.fn(async () => false) })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Draft')
    first.unmount()
    renderStateful(<StageComposer stage={stage} />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Draft')
  })

  it('is hidden on a read-only session', () => {
    renderStateful(<StageComposer stage={stage} />, { readOnly: true })
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
  })
})
```

In `web/src/api/types.test.ts`, append inside `describe('normalizeSnapshot', …)`:

```ts
  // Stage summary flow spec, part E: the stage conversation in the contract fixture.
  it('reads a stage conversation', () => {
    const st2 = normalizeSnapshot(fixture).state.stages[1]
    expect(st2.messages).toEqual([
      { actor: 'ai', text: 'Next we pick the API style.', seq: 23 },
      { actor: 'user', text: 'REST, please.', seq: 24 },
    ])
    expect(st2).toMatchObject({ lastUserSeq: 24, lastAiSeq: 23 })
  })
```

In `web/src/styles/stage.test.ts`, append:

```ts
describe('stage page with a composer (stage summary flow spec, part E)', () => {
  // The composer is sticky with margin-top: auto, like the thread's: the page must fill the column.
  it('fills the scroll area so the composer sits at the bottom', () => {
    expect(appCss).toMatch(/\.stage\s*{[^}]*min-height:\s*100%/)
  })
})
```

- [ ] **Step 2: Write the failing StageView and SessionPage tests**

In `web/src/stage/StageView.test.tsx`:

1. Replace the test `accepts a proposed summary or requests changes` (lines 18-30 on main) with:

```tsx
  it('accepts a proposed summary, and offers no Request changes (part E)', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveTextContent('We keep a JSONL log.')
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.accept', data: { stageId: 'st_1' } })
  })
```

2. Replace the test `resets the request-changes editor when switching to another stage` (lines 40-56 on main) with:

```tsx
  it('keeps the composer text per stage when switching stages', async () => {
    const user = userEvent.setup()
    const { rerender } = renderStateful(<StageView stageId="st_1" />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'About the data model')
    rerender(<StageView stageId="st_2" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
    rerender(<StageView stageId="st_1" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('About the data model')
  })
```

3. Append a new block at the end of the file:

```tsx
describe('StageView conversation (stage summary flow spec, part E)', () => {
  function withMessages(over: Partial<SessionCtx> = {}) {
    const base = makeCtx(over)
    base.state.stages[0] = {
      ...base.state.stages[0],
      messages: [
        { actor: 'ai', text: 'Three threads cover it.', seq: 30 },
        { actor: 'user', text: 'Add one on auth.', seq: 31 },
      ],
      lastAiSeq: 30,
      lastUserSeq: 31,
    }
    return base
  }

  it('shows the messages in order, with the delivery status under the latest user message', () => {
    const { container } = renderStateful(<StageView stageId="st_1" />, withMessages())
    expect(container.querySelector('.msg-ai')).toHaveTextContent('Three threads cover it.')
    const mine = container.querySelector('.msg-user') as HTMLElement
    expect(mine).toHaveTextContent('Add one on auth.')
    expect(mine).toHaveClass('is-undelivered')
    expect(screen.getByText('Sent · waiting for the AI to pick it up')).toBeInTheDocument()
  })

  it('shows the typing bubble once the message was delivered, not while the agent waits', () => {
    const base = withMessages()
    base.state.delivered = 31
    const first = renderStateful(<StageView stageId="st_1" />, base)
    expect(screen.getByRole('status', { name: 'AI is replying' })).toBeInTheDocument()
    expect(screen.queryByText('Sent · waiting for the AI to pick it up')).toBeNull()
    first.unmount()
    renderStateful(<StageView stageId="st_1" />, { ...base, waiting: true })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('sends a stage message from the composer, also on an accepted stage', async () => {
    const user = userEvent.setup()
    const onSent = vi.fn()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'Done: JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" onSent={onSent} />, { state: base.state })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Anything else?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Anything else?' } })
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('has no composer on a read-only session', () => {
    renderStateful(<StageView stageId="st_1" />, { readOnly: true })
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
  })
})
```

In `web/src/shell/SessionPage.followBottom.test.tsx`, append inside `describe('SessionPage lands on a new stage summary (demo2 follow-up 6)', …)` (it defines `withStage`):

```tsx
  // Stage summary flow spec, part E, Review Focus 3: a stage message under a proposed summary is
  // followed like a thread message; only a new proposal lands on the summary's start.
  it('follows the bottom, not the summary start, when a stage message arrives', () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.location.hash = '#st_1'
      render(<SessionPage sid="s_fixture" />)
      const proposed = { status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
      load(withStage(proposed))
      const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 }) // near the bottom
      load(withStage({ ...proposed, messages: [{ actor: 'ai', text: 'Happy to change it.', seq: 30 }], lastAiSeq: 30 }))
      expect(screen.getByText('Happy to change it.')).toBeInTheDocument()
      expect(scrolled).toEqual([])
      expect(main.scrollTo).toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/delivery.test.ts src/thread/Composer.test.tsx src/stage/StageView.test.tsx src/shell/SessionPage.followBottom.test.tsx src/styles/stage.test.ts`
Expected: FAIL.
- `stageIsReplying` and `StageComposer` are not exported.
- The StageView tests find no `Reply` textbox and still find `Request changes`.
- The new SessionPage test cannot find `Happy to change it.`.
- The `.stage` rule has no `min-height`.

`reads a stage conversation` passes at runtime, and `npm run typecheck` fails on it (`messages` does not exist on `Stage`).

- [ ] **Step 4: Types and delivery rules**

In `web/src/api/types.ts`, append to `interface Stage`:

```ts
  /** The stage page's conversation (stage summary flow spec, part E); absent until the first message. */
  messages?: Message[]
  lastUserSeq?: number
  lastAiSeq?: number
```

and add to `Action`, after the `stage.request_changes` member (the domain keeps that command, and the UI stops sending it):

```ts
  | { type: 'stage.message'; data: { stageId: string; text: string } }
```

In `web/src/thread/delivery.ts`:
- Add `const SENT = 'Sent · waiting for the AI to pick it up'`, and make `deliveryStatus` return `SENT` instead of the literal.
- Change the parameter `thread: Thread` of `isUndelivered` and `isReplying` to `item: { lastAiSeq: number }`, and `thread.lastAiSeq` in their bodies to `item.lastAiSeq`. `threadIsReplying` and `deliveryStatus` keep passing the thread.
- Replace ``after "Request changes" (demo2`` in `stageAwaitsSummary`'s comment with ``after "Request changes" in older logs (demo2``.
- Append:

```ts
// stageIsReplying is threadIsReplying for a stage page (stage summary flow spec, part E): the
// user's latest stage message was delivered and the AI has not acted in the stage since (a stage
// message, a summary proposal or a new thread; see domain.Stage.AwaitingAI). Never while the agent
// sits in tdm wait.
export function stageIsReplying(stage: Stage, delivered: number, waiting: boolean): boolean {
  if (waiting) return false
  return isReplying(stage.lastUserSeq ?? 0, { lastAiSeq: stage.lastAiSeq ?? 0 }, delivered)
}

// stageDeliveryStatus is deliveryStatus for a message on a stage page. Any stage takes messages,
// so there is no resolved-state exclusion.
export function stageDeliveryStatus(msgSeq: number, stage: Stage, delivered: number): string | null {
  return isUndelivered(msgSeq, { lastAiSeq: stage.lastAiSeq ?? 0 }, delivered) ? SENT : null
}
```

- [ ] **Step 5: One composer core for threads and stages**

In `web/src/thread/Composer.tsx`, change `import type { Thread } from '../api/types'` to `import type { Stage, Thread } from '../api/types'`, and replace `export function Composer … }` (lines 8-82 on main) with:

```tsx
export function Composer({ thread, onSent }: { thread: Thread; onSent?: () => void }) {
  const { sendReview, readOnly, draft } = useSessionCtx()
  return (
    <ComposerBox
      itemId={thread.id}
      hidden={readOnly || thread.status === 'resolved'}
      // Every draft comment goes out with the message (sendReview sends the whole draft).
      pending={countDraft(draft)}
      send={(message) => sendReview(message ? { threadId: thread.id, message } : undefined)}
      onSent={onSent}
    />
  )
}

// StageComposer is the composer at the bottom of a stage page (stage summary flow spec, part E). It
// is always there, from before the first summary through after its accept. It sends stage.message
// through run, so pending draft comments go with it as with every other action. Unsent text is kept
// per stage under the same tdm:composer:<sid>:<id> key as a thread's (stage and thread ids never
// collide).
export function StageComposer({ stage, onSent }: { stage: Stage; onSent?: () => void }) {
  const { run, readOnly } = useSessionCtx()
  return (
    <ComposerBox
      itemId={stage.id}
      hidden={readOnly}
      pending={0}
      send={async (message) => (message ? run({ type: 'stage.message', data: { stageId: stage.id, text: message } }) : false)}
      onSent={onSent}
    />
  )
}

// ComposerBox is the composer UI and its send rules, shared by threads and stages. `send` gets the
// trimmed text, or undefined for a draft-only send (threads only: `pending` counts the draft
// comments that go with it).
function ComposerBox({
  itemId,
  hidden,
  pending,
  send: deliver,
  onSent,
}: {
  itemId: string
  hidden: boolean
  pending: number
  send(message: string | undefined): Promise<boolean>
  onSent?: () => void
}) {
  const { sid } = useSessionCtx()
  // Demo2 follow-up 2: unsent text is kept per thread (and per stage), across switches and reloads.
  const [text, setText] = useThreadText('composer', sid, itemId)
  const [sending, setSending] = useState(false)
  // Read inside the pending send's `.then` (not `text` from the closure) so a same-message
  // success clears the box, but an edit made while the send was in flight survives (M7).
  const textRef = useRef(text)
  textRef.current = text
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const boxRef = useRef<HTMLDivElement>(null)
  useComposerHeightVar(boxRef, hidden)
  if (hidden) return null
  const sendLabel = pending ? `Send (${pending} comment${pending > 1 ? 's' : ''})` : 'Send'
  const send = async (message: string | undefined) => {
    if (sending) return
    const sentText = textRef.current
    setSending(true)
    try {
      if (await deliver(message)) {
        if (mounted.current) {
          if (textRef.current === sentText) setText('')
        } else if (loadThreadText('composer', sid, itemId) === sentText) {
          // This composer unmounted while the send was in flight (a thread switch), and a newer
          // mount of the same item may have stored new text since: forget only what was sent.
          saveThreadText('composer', sid, itemId, '')
        }
        onSent?.()
      }
    } finally {
      setSending(false)
    }
  }
  // Send and ⌘↵/Ctrl↵ do the same thing. The typed message goes with the whole draft; with no text
  // (or only whitespace) but draft comments pending, the draft goes alone (M7, and demo2 follow-up 3
  // for the button).
  const canSend = !sending && (text.trim() !== '' || pending > 0)
  const submit = () => {
    if (!canSend) return
    void send(text.trim() || undefined)
  }
  return (
    <div className="composer" ref={boxRef}>
      <textarea
        aria-label="Reply"
        placeholder="Reply…"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer-foot">
        <span>{pending ? `${modKeyLabel()} sends with ${pending} draft comment${pending > 1 ? 's' : ''}` : `${modKeyLabel()} to send`}</span>
        <button type="button" className="btn primary small" disabled={!canSend} onClick={submit}>
          {sendLabel}
        </button>
      </div>
    </div>
  )
}
```

`useComposerHeightVar` below is unchanged. In `web/src/draft/threadText.ts`, change the first comment line to `// Unsent text the user typed in one thread or on one stage page (demo2 follow-up 2; stage summary flow spec, part E): the composer's reply and the`. The code does not change: a stage id is used as the key's item id.

- [ ] **Step 6: The stage page becomes a conversation**

In `web/src/stage/StageView.tsx`:

1. Imports: replace Task 5's delivery import with

```tsx
import { isUndelivered, stageAwaitsNextStep, stageAwaitsSummary, stageDeliveryStatus, stageIsReplying } from '../thread/delivery'
```

   and add

```tsx
import { StageComposer } from '../thread/Composer'
import { MessageView } from '../thread/MessageView'
```

2. Replace `StageView` and the `StageBody` signature (as Task 5 left them) so they also take and forward `onSent`:

```tsx
// onAccepted runs after Accept summary succeeds: SessionPage then moves on to the next stage
// (stage summary flow, part B). onEnd is the top bar's End session, offered in the accepted box
// of the last stage. onSent runs after a stage message was sent, so the page follows the reply
// (part E).
export function StageView({
  stageId,
  onAccepted,
  onEnd,
  onSent,
}: {
  stageId: string
  onAccepted?: () => void
  onEnd?: () => void
  onSent?: () => void
}) {
  const { state } = useSessionCtx()
  // Keyed on stageId so per-stage UI state (the summary editor, the composer's text) resets
  // when the caller switches stages without remounting StageView itself.
  return <StageBody key={stageId} stageId={stageId} state={state} onAccepted={onAccepted} onEnd={onEnd} onSent={onSent} />
}
```

```tsx
function StageBody({
  stageId,
  state,
  onAccepted,
  onEnd,
  onSent,
}: {
  stageId: string
  state: State
  onAccepted?: () => void
  onEnd?: () => void
  onSent?: () => void
}) {
```

3. Replace the `SummaryMode` comment and type (as Task 7 left them):

```tsx
// view: the proposed summary and its buttons; edit: the summary in the Save editor (part C).
// Asking for changes is a message on the stage now (stage summary flow spec, part E).
type SummaryMode = 'view' | 'edit'
```

4. In `StageBody`, directly after Task 5's `const still = …` line, add:

```tsx
  const messages = stage.messages ?? []
  const lastUserMessageSeq = messages.filter((m) => m.actor === 'user').at(-1)?.seq
  const replying = !readOnly && stageIsReplying(stage, state.delivered, waiting)
```

5. Replace the whole proposed-summary section (as Task 7 left it, from `{stage.status === 'summary_proposed' && (` to its closing `)}`, which still holds the `Request changes` editor and button) with the version without them:

```tsx
      {stage.status === 'summary_proposed' && (
        <section className="conclusion" aria-label="Proposed stage summary" data-land="proposed-summary">
          <div className="kicker">
            Proposed stage summary
            {stage.editedByUser && <span className="edited-by-you">edited by you</span>}
          </div>
          {!readOnly && mode === 'edit' ? (
            <CommentEditor
              label="Edit summary"
              initial={stage.proposedSummary ?? ''}
              submitLabel="Save"
              autoGrow
              onSave={(text) => void save(text)}
              onCancel={() => setMode('view')}
            />
          ) : (
            <Prose text={stage.proposedSummary ?? ''} />
          )}
          {!readOnly && mode === 'view' && (
            <div className="actions">
              <button type="button" className="btn primary" disabled={accepting} onClick={() => void accept()}>
                Accept summary
              </button>
              <button type="button" className="btn" disabled={accepting} onClick={() => setMode('edit')}>
                Edit
              </button>
            </div>
          )}
        </section>
      )}
```

6. Directly before that `{stage.status === 'summary_proposed' && (`, after the accepted section (as Task 5 left it), insert:

```tsx
      {messages.map((m) => (
        <MessageView
          key={`m${m.seq}`}
          message={m}
          undelivered={!readOnly && m.actor === 'user' && isUndelivered(m.seq, { lastAiSeq: stage.lastAiSeq ?? 0 }, state.delivered)}
          status={!readOnly && m.actor === 'user' && m.seq === lastUserMessageSeq ? stageDeliveryStatus(m.seq, stage, state.delivered) : null}
        />
      ))}
      {replying && <TypingBubble quietMinutes={quietMinutes} />}
```

7. Only one bubble moves at a time. In the open-stage block, change `readOnly || waiting ? (` to `readOnly || waiting || replying ? (`. In Task 5's accepted box, replace

```tsx
                {still ? (
                  <p className="muted">{NOTHING_MORE}</p>
                ) : (
                  <TypingBubble quietMinutes={quietMinutes} label={NEXT_PENDING} text={NEXT_PENDING} />
                )}
```

   with

```tsx
                {still ? (
                  <p className="muted">{NOTHING_MORE}</p>
                ) : replying ? null : (
                  // While the AI replies to a stage message, the reply bubble below the messages
                  // stands for it (part E).
                  <TypingBubble quietMinutes={quietMinutes} label={NEXT_PENDING} text={NEXT_PENDING} />
                )}
```

   (`still` needs no change: once the AI has answered a stage message and is back in `tdm wait`, "nothing more planned" is still what the page should say.)

8. As the last child of `<article className="stage">`, add `<StageComposer stage={stage} onSent={onSent} />`.

In `web/src/styles/app.css`, add `min-height: 100%;` to the `.stage` rule (line 210 on main):

```css
.stage { display: flex; flex-direction: column; gap: 16px; max-width: var(--col-width); min-height: 100%; margin-inline: auto; }
```

- [ ] **Step 7: SessionPage follows stage messages and lands only on a new summary**

In `web/src/shell/SessionPage.tsx`, change `import { threadIsReplying } from '../thread/delivery'` to `import { stageIsReplying, threadIsReplying } from '../thread/delivery'`. In the comment above `mainRef` (line 45, as Task 3 left it), replace `"Request changes"` with `a stage message`.

Replace `mainRef`, `contentKey`, `landOn` and `follow` (lines 51-68 on main; Tasks 3 and 5 did not change them apart from the comment above):

```tsx
  const mainRef = useRef<HTMLElement | null>(null)
  const currentStage = current.startsWith('st_') ? snapshot.state.stages.find((s) => s.id === current) : undefined
  const contentKey = useMemo(() => {
    if (current.startsWith('st_')) {
      if (!currentStage) return current
      // Stage summary flow spec, part E: stage messages and the stage's typing bubble are content
      // growth too, like a thread's.
      const bubble = stageIsReplying(currentStage, snapshot.state.delivered, snapshot.waiting) ? 1 : 0
      return `${current}:${currentStage.messages?.length ?? 0}:${currentStage.proposedSummary ?? currentStage.summary ?? ''}:${bubble}`
    }
    const thread = snapshot.state.threads[current]
    if (!thread) return current
    // Round 3 #6: the typing bubble appearing at the end of the timeline is content growth too,
    // so it must be reflected here — otherwise it could pop in without regard to whether the
    // user is near the bottom (follow-bottom would only ever look at it by accident).
    const bubble = threadIsReplying(thread, snapshot.state.delivered, snapshot.waiting) ? 1 : 0
    return `${current}:${timeline(snapshot.state, thread).length}:${thread.proposedConclusion ?? thread.conclusion ?? ''}:${bubble}`
  }, [current, currentStage, snapshot.state, snapshot.waiting])
  // Demo2 follow-up 6: a (re-)proposed stage summary is read from its start. Stage messages now
  // change the stage's key too, so land only when the proposed summary itself changed since this
  // item's previous content change; anything else follows the bottom (part E, Review Focus 3).
  const landKey = `${current}:${currentStage?.proposedSummary ?? ''}`
  const landKeyRef = useRef(landKey)
  landKeyRef.current = landKey
  const landedKey = useRef(landKey)
  const landOn = useCallback(() => {
    const changed = landedKey.current !== landKeyRef.current
    landedKey.current = landKeyRef.current
    return changed ? (mainRef.current?.querySelector<HTMLElement>('[data-land="proposed-summary"]') ?? null) : null
  }, [])
  const follow = useFollowBottom(mainRef, contentKey, landOn)
  // useFollowBottom does not ask landOn on an item switch: start each item from its own key.
  // Declared after useFollowBottom, so this runs after its effect.
  useEffect(() => {
    landedKey.current = landKeyRef.current
  }, [current])
```

Replace Task 5's `<StageView stageId={current} onAccepted={onStageAccepted} onEnd={onEnd} />` with:

```tsx
              <StageView stageId={current} onAccepted={onStageAccepted} onEnd={onEnd} onSent={follow.scrollToBottom} />
```

- [ ] **Step 8: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.
- The existing Composer tests pass unchanged, because `Composer` still calls `sendReview({ threadId, message })` or `sendReview(undefined)`.
- `scrolls to the start of a proposed (and re-proposed) summary` still lands on each new proposal.
- The fixture's `st_2` page (the SessionPage "AI not connected" test) now renders its two messages.

- [ ] **Step 9: Commit**

Discard webdist changes if a build touched them: `git checkout internal/daemon/webdist`.

```bash
git add web/src/api web/src/thread web/src/draft/threadText.ts web/src/stage web/src/shell web/src/styles
git commit -m "feat(web): talk to the AI on the stage page

The stage page shows its messages with delivery status and a typing
bubble, and keeps a composer at the bottom in every stage state that
sends stage.message. Request changes is gone: a stage message asks
for changes. The page follows new stage messages and lands on a
summary only when it is newly proposed."
```

---

### Task 11: Web: the stage summary as a proposal card, its history, and the folded thread list (Parts D and E, stage side)

**Files:**
- Create: `web/src/stage/stageTimeline.ts`
- Modify: `web/src/stage/StageView.tsx` (the timeline, `ProposalCard`, the collapse on send, the folded thread list)
- Modify: `web/src/styles/app.css` (`.stage-threads-toggle`)
- Test: `web/src/stage/stageTimeline.test.ts`, `web/src/stage/StageView.test.tsx`, `web/src/styles/stage.test.ts`

**Interfaces:**
- Consumes: `ProposalCard`, `EarlierProposal`, `useProposalCollapse`, `earlierProposals` (Task 9); `StageComposer`, stage messages, `lastUserMessageSeq`, `replying` and the delivery helpers (Task 10); `Stage.editedByUser`, `save` and the `Save` editor (`stage.revise`) from Task 7; `accept()` and `accepting` (Tasks 2, 5, 7).
- Produces:
  - `type StageTimelineItem = { kind: 'message'; seq: number; message: Message } | { kind: 'proposal'; seq: number; version: number; text: string }` and `stageTimeline(stage: Stage): StageTimelineItem[]`;
  - the proposed stage summary as `ProposalCard` (region `Proposed stage summary`, `data-land="proposed-summary"`);
  - the thread-list toggle `Threads (R/N resolved) ▸` / `▾` (`aria-expanded`) once the stage is not open.

- [ ] **Step 1: Write the failing tests**

Create `web/src/stage/stageTimeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Stage } from '../api/types'
import { stageTimeline } from './stageTimeline'

describe('stageTimeline (stage summary flow spec, part E)', () => {
  const stage: Stage = {
    id: 'st_1',
    title: 'Data model',
    status: 'summary_proposed',
    threadIds: [],
    proposedSummary: 's2',
    proposalVersion: 2,
    proposals: [
      { text: 's1', seq: 20 },
      { text: 's2', seq: 25 },
    ],
    messages: [
      { actor: 'user', text: 'Mention blobs.', seq: 22 },
      { actor: 'ai', text: 'Revised.', seq: 24 },
    ],
  }

  it('interleaves messages and earlier summary proposals by seq, leaving out the live one', () => {
    expect(stageTimeline(stage).map((i) => (i.kind === 'message' ? `${i.message.actor}:${i.message.text}` : `v${i.version}`))).toEqual([
      'v1',
      'user:Mention blobs.',
      'ai:Revised.',
    ])
    expect(stageTimeline({ ...stage, status: 'accepted', summary: 's2' }).filter((i) => i.kind === 'proposal')).toHaveLength(1)
    expect(stageTimeline({ id: 'st_2', title: 'API', status: 'open', threadIds: [] })).toEqual([])
  })
})
```

In `web/src/stage/StageView.test.tsx`, replace the test `shows ids in the goal, thread conclusions and the summary as chips (demo2 follow-up 4)` (lines 132-147 on main) with this version, which unfolds the thread list first:

```tsx
  it('shows ids in the goal, thread conclusions and the summary as chips (demo2 follow-up 4)', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.threads.t_1 = { ...base.state.threads.t_1, status: 'resolved', conclusion: 'Same as t_2.' }
    base.state.stages[0] = {
      ...base.state.stages[0],
      goal: 'Settle t_3 first',
      status: 'summary_proposed',
      proposedSummary: 'Covers t_1 and `t_2`.',
    }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const summary = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(summary).getByRole('link', { name: 'Repository layer' })).toHaveAttribute('title', 'id: t_1')
    expect(within(summary).queryByRole('link', { name: 'Cache strategy' })).toBeNull() // inside `code`
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '#t_3') // the goal
    await user.click(screen.getByRole('button', { name: /^Threads \(1\/3 resolved\)/ }))
    expect(screen.getByRole('link', { name: 'Cache strategy' })).toHaveAttribute('title', 'id: t_2') // t_1's conclusion
  })
```

Append a new block at the end of `web/src/stage/StageView.test.tsx`:

```tsx
describe('StageView summary card (stage summary flow spec, parts D and E)', () => {
  const V1 = 'We keep a JSONL log. Blobs by hash.'
  function proposed() {
    const base = makeCtx()
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    base.state.stages[0] = {
      ...base.state.stages[0],
      status: 'summary_proposed',
      proposedSummary: V1,
      proposalVersion: 1,
      proposals: [{ text: V1, seq: 30 }],
    }
    return base
  }

  it('collapses the summary after a stage message is sent, keeping Accept summary and Edit', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: proposed().state })
    const card = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(card).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Mention the cache.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Mention the cache.' } })
    expect(within(card).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(card.querySelector('.proposal-preview')).toHaveTextContent(/^We keep a JSONL log\.$/)
    expect(within(card).getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(card).toHaveAttribute('data-land', 'proposed-summary')
  })

  it('shows Updated when the AI re-proposes while collapsed, and the earlier summary as v1', async () => {
    const user = userEvent.setup()
    const base = proposed()
    const { rerender } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Collapse' }))

    const v2 = 'We keep a JSONL log and a lazy cache. Blobs by hash.'
    base.state.stages[0] = { ...base.state.stages[0], proposedSummary: v2, proposalVersion: 2, proposals: [{ text: V1, seq: 30 }, { text: v2, seq: 33 }] }
    rerender(<StageView stageId="st_1" />)
    const card = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(card).getByText('Updated')).toBeInTheDocument()
    expect(within(card).getByText('· v2')).toBeInTheDocument()
    const earlier = screen.getByText('Proposed stage summary · v1').closest('details') as HTMLElement
    expect(earlier).not.toHaveAttribute('open')
    expect(earlier).toHaveTextContent(V1)

    await user.click(within(card).getByRole('button', { name: 'Expand' }))
    expect(within(card).queryByText('Updated')).toBeNull()
  })

  it('folds the thread list into one line once a summary is proposed', async () => {
    const user = userEvent.setup()
    renderStateful(<StageView stageId="st_1" />, { state: proposed().state })
    const toggle = screen.getByRole('button', { name: 'Threads (3/3 resolved) ▸' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '✓ Repository layer' })).toBeNull()
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Threads (3/3 resolved) ▾' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '✓ Repository layer' })).toHaveAttribute('href', '#t_1')
  })

  it('keeps the thread list open while the stage is open', () => {
    renderStateful(<StageView stageId="st_1" />)
    expect(screen.queryByRole('button', { name: /^Threads \(/ })).toBeNull()
    expect(screen.getByRole('link', { name: '◆ Cache strategy' })).toBeInTheDocument()
  })
})
```

In `web/src/styles/stage.test.ts`, append:

```ts
describe('folded stage thread list (stage summary flow spec, part E)', () => {
  it('styles the one-line toggle as quiet UI text', () => {
    expect(appCss).toMatch(/\.stage-threads-toggle\s*{[^}]*font:[^;]*var\(--font-ui\)/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/stage src/styles/stage.test.ts`
Expected: FAIL.
- `stageTimeline.test.ts` cannot resolve `./stageTimeline`.
- The new StageView tests find no `Collapse` button and no `Threads (3/3 resolved) ▸` button.
- The rewritten chips test finds no `Threads (1/3 resolved)` button.
- The CSS test finds no `.stage-threads-toggle` rule.

- [ ] **Step 3: The stage timeline**

Create `web/src/stage/stageTimeline.ts`:

```ts
import type { Message, Stage } from '../api/types'
import { earlierProposals } from '../proposal/proposals'

export type StageTimelineItem = { kind: 'message'; seq: number; message: Message } | { kind: 'proposal'; seq: number; version: number; text: string }

// stageTimeline orders a stage page's conversation by event seq (stage summary flow spec, part E):
// its messages and its earlier summary proposals. The newest proposal is the live card, or the
// accepted summary, and is not listed while the stage is proposed or accepted.
export function stageTimeline(stage: Stage): StageTimelineItem[] {
  const items: StageTimelineItem[] = (stage.messages ?? []).map((message) => ({ kind: 'message', seq: message.seq, message }))
  for (const p of earlierProposals(stage.proposals, stage.status !== 'open')) items.push({ kind: 'proposal', ...p })
  return items.sort((a, b) => a.seq - b.seq)
}
```

- [ ] **Step 4: The stage page wires the card, the history and the fold**

In `web/src/stage/StageView.tsx`, add:

```tsx
import { EarlierProposal, ProposalCard } from '../proposal/ProposalCard'
import { useProposalCollapse } from '../proposal/useProposalCollapse'
import { stageTimeline } from './stageTimeline'
```

In `StageBody`, after the lines Task 10 added (`const replying = …`), add:

```tsx
  // Part D: the summary card's collapse state, collapsed by a sent stage message.
  const proposal = useProposalCollapse(stage.proposalVersion ?? 0)
  // Part E: once a summary is proposed, the thread list folds into one line so the conversation and
  // the summary lead. It can be unfolded.
  const folds = stage.status !== 'open'
  const [threadsOpen, setThreadsOpen] = useState(false)
```

Replace `<ul className="stage-threads"> … </ul>` with the same list behind the fold (the `<li>` rows are unchanged):

```tsx
      {folds && (
        <button type="button" className="stage-threads-toggle" aria-expanded={threadsOpen} onClick={() => setThreadsOpen((o) => !o)}>
          Threads ({resolved}/{threads.length} resolved) {threadsOpen ? '▾' : '▸'}
        </button>
      )}
      {(!folds || threadsOpen) && (
        <ul className="stage-threads">
          {threads.map((t) => (
            <li key={t.id}>
              {/* The icon's fixed-width slot is inline-block, which would drop the space from the
                  accessible name; the explicit label keeps it "✓ Title". */}
              <a href={`#${t.id}`} aria-label={`${statusIcon(t)} ${t.title}`}>
                <span className="stage-thread-icon">{statusIcon(t)}</span>
                {t.title}
              </a>
              {t.conclusion && <Prose className="stage-concl" text={t.conclusion} />}
            </li>
          ))}
        </ul>
      )}
```

Replace Task 10's `{messages.map((m) => ( <MessageView … /> ))}` with the timeline, which adds the earlier summaries:

```tsx
      {stageTimeline(stage).map((item) =>
        item.kind === 'proposal' ? (
          <EarlierProposal key={`p${item.version}`} kicker="Proposed stage summary" version={item.version} text={item.text} />
        ) : (
          <MessageView
            key={`m${item.seq}`}
            message={item.message}
            undelivered={!readOnly && item.message.actor === 'user' && isUndelivered(item.seq, { lastAiSeq: stage.lastAiSeq ?? 0 }, state.delivered)}
            status={!readOnly && item.message.actor === 'user' && item.seq === lastUserMessageSeq ? stageDeliveryStatus(item.seq, stage, state.delivered) : null}
          />
        ),
      )}
```

Replace the proposed-summary section (exactly as Task 10, Step 6, item 5 left it) with the version below. It moves the same editor and buttons into the card:

```tsx
      {stage.status === 'summary_proposed' && (
        <ProposalCard
          label="Proposed stage summary"
          kicker="Proposed stage summary"
          land="proposed-summary"
          text={stage.proposedSummary ?? ''}
          version={stage.proposalVersion ?? 1}
          editedByUser={stage.editedByUser}
          collapsed={proposal.collapsed}
          updated={proposal.updated}
          onToggle={proposal.toggle}
          body={
            !readOnly && mode === 'edit' ? (
              <CommentEditor
                label="Edit summary"
                initial={stage.proposedSummary ?? ''}
                submitLabel="Save"
                autoGrow
                onSave={(text) => void save(text)}
                onCancel={() => setMode('view')}
              />
            ) : undefined
          }
          actions={
            !readOnly && mode === 'view' ? (
              <>
                <button type="button" className="btn primary" disabled={accepting} onClick={() => void accept()}>
                  Accept summary
                </button>
                <button type="button" className="btn" disabled={accepting} onClick={() => setMode('edit')}>
                  Edit
                </button>
              </>
            ) : null
          }
        />
      )}
```

Replace Task 10's `<StageComposer stage={stage} onSent={onSent} />` with:

```tsx
      <StageComposer
        stage={stage}
        onSent={() => {
          // Part D: a sent message collapses the live summary so the reply stays in view; a summary
          // proposed later starts expanded (Review Focus 3).
          if (stage.status === 'summary_proposed') proposal.collapse()
          onSent?.()
        }}
      />
```

In `web/src/styles/app.css`, after the `.stage-concl strong` rule (line 229 on main), add:

```css
/* Part E: the thread list folds to one line once a summary is proposed. */
.stage-threads-toggle { align-self: flex-start; font: 0.8125rem var(--font-ui); color: var(--muted); background: none; border: none; padding: 0; cursor: pointer; }
.stage-threads-toggle:hover { color: var(--fg); }
```

Delete Task 7's marker rule (both markers now sit in `.proposal-head`, which Task 9 styles):

```css
.conclusion .kicker .edited-by-you {
  margin-left: 8px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
}
```

- [ ] **Step 5: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.
- `marks the proposed summary as the landing target` and `scrolls to the start of a proposed (and re-proposed) summary` pass, because the card keeps the region name and `data-land`.
- `closes the Edit editor … when the proposed summary changes underneath it` passes, because the editor is the card's `body`.
- The open-stage tests (`lists threads…`, `renders thread conclusions as markdown…`, `puts the status icon…`) see the unfolded list.

- [ ] **Step 6: Commit**

Discard webdist changes if a build touched them: `git checkout internal/daemon/webdist`.

```bash
git add web/src/stage web/src/styles
git commit -m "feat(web): stage summary as a collapsible card with its history

The proposed stage summary uses the proposal card: version, Updated
pill, collapse on a sent stage message. Earlier summaries sit in the
stage timeline as closed vN entries, and the thread list folds to
\"Threads (N/N resolved)\" once a summary is proposed."
```

---

### Task 12: Rebuild webdist, run everything, close the ROADMAP item

**Files:**
- Regenerate: `internal/daemon/webdist/`
- Modify: `docs/ROADMAP.md` (the `## UI polish backlog` list)

**Interfaces:**
- Consumes: everything above.
- Produces: an embedded UI that matches `web/src`.

- [ ] **Step 1: Run the unit suites and the typecheck**

Run: `go test ./... && (cd web && npm test && npm run typecheck)`
Expected: PASS. `gofmt -l internal` lists no files.

- [ ] **Step 2: Rebuild the embedded UI**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and `vite build` writes `../internal/daemon/webdist` (`index.html` plus hashed `assets/`). `git status --short internal/daemon/webdist` shows the changed files.

- [ ] **Step 3: Run the e2e suite**

Run: `cd web && npm run e2e`
Expected: every Playwright test passes, including the first test in `web/e2e/loop.spec.ts` with Task 7's Edit → Save → Accept summary block. (`npm run e2e` runs `vite build` again; the output is identical to Step 2.) If a test fails on a locator that Task 11's folded thread list hides (a thread link on a stage page with a proposed or accepted summary), click `Threads (R/N resolved) ▸` first in that test rather than changing the UI.

- [ ] **Step 4: Run the Go tests against the rebuilt UI**

Run: `go test ./...`
Expected: PASS (the daemon embeds the new `webdist`).

- [ ] **Step 5: Commit the rebuilt UI**

```bash
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the stage summary flow"
```

- [ ] **Step 6: Close the ROADMAP item**

In `docs/ROADMAP.md`, under `## UI polish backlog`, delete the line (Task 2 closed it):

```markdown
- In-flight guards on Accept and Accept summary (double click sends twice).
```

- [ ] **Step 7: Commit the ROADMAP update**

```bash
git add docs/ROADMAP.md
git commit -m "docs: drop the shipped Accept in-flight guard from the roadmap"
```
