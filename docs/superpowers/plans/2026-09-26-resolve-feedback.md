# Resolve and End-Session Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three feedback items from the demo 3 session:
1. on a resolved thread, the conclusion card sits right under the thread title (open and proposed threads keep it at the bottom, above the composer);
2. when a thread becomes resolved while the page is open, its ✓ in the left nav pops in with a short green flash (never on initial load, reconnect, or navigation);
3. after End session is confirmed and the request succeeds, a toast says `✓ Session ended`.

**Architecture:** Web UI only. `ThreadView` renders `ConclusionCard` in one of two places, chosen by `thread.status`. A new hook, `useJustResolved(threads, live)` in `web/src/shell/useJustResolved.ts`, keeps a ref of the thread statuses it saw last. The ref is seeded on first render, so the initial load never flashes. The hook returns the ids that changed from not-resolved to resolved on a snapshot that arrived while the connection was already open. The previous render's connection state is kept in a ref too. On a reconnect, the new snapshot and `connection: 'open'` arrive in the same render, after a render with `'connecting'`, so nothing flashes. Each id stays in the returned set for `JUST_RESOLVED_MS` (1200 ms, a timeout, which also covers reduced motion, where no `animationend` fires) and is then dropped, so later re-renders cannot replay the animation. `Nav` adds `is-just-resolved` to those buttons. CSS keyframes (`tdm-resolved-flash` on the row, `tdm-resolved-pop` on the icon) run on that class and are switched off under `prefers-reduced-motion`, like `.typing-dot` and `.line-note.is-flash`. `SessionPage`'s `onEnd` shows an `info` notice through the existing `Toast` when `ctx.run` resolves `true`. `Toast` already closes `info` notices after 4 s.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest + Testing Library, Playwright (e2e). No Go changes.

**Spec:** `docs/superpowers/specs/2026-09-26-resolve-feedback.md` (committed as db44ce1). Conventions: `docs/superpowers/plans/2026-09-25-demo2-followups.md` (the previous plan).

## Global Constraints

- Web tests: `cd web && npm test`. Web typecheck: `cd web && npm run typecheck` (and `npx tsc -b` in Task 3). Go tests: `go test ./...` from the repo root (run in Task 3 only; nothing in Go changes).
- No Go changes, no new dependencies, no new event types, no API or snapshot changes. `web/src/test/fixtures/snapshot.json` is not regenerated.
- UI copy, verbatim:
  - End session toast: `✓ Session ended` (an `info` notice, so `role="status"` and it closes on its own after 4 s).
  - The resolved conclusion keeps its kicker `Conclusion`. Its `<section>` gains `aria-label="Conclusion"` so tests can find it as a region. The proposed card keeps `aria-label="Proposed conclusion"`.
- Classes: `nav-thread … is-just-resolved` on the nav button while its flash plays. Keyframes: `tdm-resolved-flash`, `tdm-resolved-pop`. Timeout constant: `JUST_RESOLVED_MS = 1200` (longer than both animations: 1 s flash, 0.45 s pop).
- Flash rules (all pinned in Task 2):
  - flashes: a thread in the previous snapshot that was `open` or `conclusion_proposed` and is `resolved` in the next one, while the connection was `open` on both renders. That covers the user's own Accept or Resolve (the change arrives over SSE) and a resolve by the agent;
  - never flashes: the first render (statuses are only seeded), a snapshot that arrives on reconnect (the previous render was not `open`), a thread that is new and already resolved, navigation or any re-render without a status change, or a thread whose flash timeout has passed.
- Motion: the new animations are CSS only and are set to `animation: none` inside a `@media (prefers-reduced-motion: reduce)` block. The `✓` icon and the `is-resolved` colors still show. No JS reads `prefersReducedMotion()` for this; the timeout clears the class either way.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 3**, as its own `build(web): …` commit. If an earlier build touched it, discard with `git checkout internal/daemon/webdist`.
- Commit messages use conventional style (`docs: …`, `feat(web): …`, `test(web): …`, `build(web): …`) and carry **no** `Co-Authored-By` or other co-author trailer.
- Run the tasks in order.

## Review Focus

1. **Flash on initial load or reconnect.** A session opened with resolved threads must show plain ✓ icons. A thread resolved while the stream was down must not flash when the stream comes back. Pinned in Task 2 (`Shell.test.tsx` "does not flash on the first render", `SessionPage.test.tsx` "does not flash threads resolved while reconnecting").
2. **Flash replays on an unrelated re-render.** A new snapshot with the same statuses, a draft change, or switching the current item must not bring the class back, and the class must drop after `JUST_RESOLVED_MS`. Pinned in Task 2 (`Shell.test.tsx` "drops the flash after it played, and never replays it").
3. **Toast when End session is cancelled or fails.** Cancel in `window.confirm` sends nothing and shows no toast. A failed request shows the error toast only. A read-only session has no End session button at all (unchanged). Pinned in Task 2 (`SessionPage.test.tsx` End session tests).
4. **Conclusion duplicated or missing.** A resolved thread shows exactly one conclusion card, directly after the header and before the first block. A proposed thread shows exactly one card, after the timeline. An open thread still shows Resolve at the bottom. Pinned in Task 2 (`ThreadView.test.tsx` conclusion placement tests) and in Task 3 (e2e).
5. **Reduced motion.** The new animations must be off under `prefers-reduced-motion: reduce` while the resolved state still shows. Pinned in Task 2 (`styles/resolved.test.ts`, which reads `app.css` like `chips.test.ts`).

---

### Task 1: Commit this plan

**Files:**
- Add: `docs/superpowers/plans/2026-09-26-resolve-feedback.md` (this file; the spec is already committed as db44ce1)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Commit the plan**

```bash
git add docs/superpowers/plans/2026-09-26-resolve-feedback.md
git commit -m "docs: resolve and end-session feedback implementation plan"
```

---

### Task 2: Web: conclusion on top of a resolved thread, sidebar resolve flash, End session toast (#1, #2, #3)

**Files:**
- Modify: `web/src/thread/ThreadView.tsx` (conclusion placement)
- Modify: `web/src/thread/ConclusionCard.tsx` (`aria-label="Conclusion"` on the resolved card)
- Create: `web/src/shell/useJustResolved.ts` (`newlyResolved`, `useJustResolved`, `JUST_RESOLVED_MS`)
- Modify: `web/src/shell/Nav.tsx` (`live` prop, `is-just-resolved` class)
- Modify: `web/src/shell/SessionPage.tsx` (`live` to `Nav`, the End session toast)
- Modify: `web/src/styles/app.css` (keyframes and the reduced-motion rule)
- Test: `web/src/thread/ThreadView.test.tsx`, `web/src/shell/Shell.test.tsx`, `web/src/shell/SessionPage.test.tsx`, `web/src/shell/useJustResolved.test.ts` (new), `web/src/styles/resolved.test.ts` (new)

**Interfaces:**
- Consumes: `SessionCtx.run` (resolves `true` on success; a failure already calls `setNotice(noticeFromError(e))` inside `useController`), `Notice`, `Toast`, `Connection` from `api/useSession`.
- Produces:
  - `newlyResolved(prev: ReadonlyMap<string, ThreadStatus> | null, threads: Record<string, Thread>): string[]`;
  - `useJustResolved(threads: Record<string, Thread>, live: boolean): ReadonlySet<string>`;
  - `JUST_RESOLVED_MS = 1200`;
  - `Nav({ current, onSelect, live = true })`.

- [ ] **Step 1: Write the failing ThreadView tests (#1)**

In `web/src/thread/ThreadView.test.tsx`, replace the test `'shows the accepted conclusion and hides the composer when resolved'` with:

```tsx
  it('shows the accepted conclusion under the title and hides the composer when resolved (resolve feedback 1)', () => {
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved', conclusion: 'Lazy it is.', proposedConclusion: undefined }
    const { container } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Conclusion' })
    expect(card).toHaveTextContent('Lazy it is.')
    // Directly after the header, before the first block, and only once.
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' }).closest('header')!.nextElementSibling).toBe(card)
    expect(card.compareDocumentPosition(container.querySelector('#b_3')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.conclusion')).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
  })

  it('keeps a proposed conclusion at the bottom, after the timeline (resolve feedback 1)', () => {
    const { container } = renderStateful(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(container.querySelector('#b_3')!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.conclusion')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Conclusion' })).toBeNull()
  })
```

(The open-thread case, Resolve at the bottom, is already covered by `'offers Resolve only on open threads of a live session'` and the Resolve tests. They are unchanged.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/thread/ThreadView.test.tsx`
Expected: FAIL. There is no region named `Conclusion` yet, and the resolved card comes after the blocks.

- [ ] **Step 3: Move the resolved conclusion under the header**

In `web/src/thread/ConclusionCard.tsx`, replace

```tsx
      <section className="conclusion is-resolved">
```

with

```tsx
      <section className="conclusion is-resolved" aria-label="Conclusion">
```

In `web/src/thread/ThreadView.tsx`, in `ThreadBody`, after `const lastUserMessageSeq = …` add

```tsx
  // Resolve feedback 1: a resolved thread leads with its outcome; an open or proposed one keeps
  // the card at the bottom, next to the composer where the user acts on it.
  const resolved = thread.status === 'resolved'
```

then replace

```tsx
        <h1>{thread.title}</h1>
      </header>
```

with

```tsx
        <h1>{thread.title}</h1>
      </header>
      {resolved && <ConclusionCard thread={thread} onResolved={onResolved} />}
```

and replace

```tsx
      <ConclusionCard thread={thread} onResolved={onResolved} />
      <Composer thread={thread} onSent={onSent} />
```

with

```tsx
      {!resolved && <ConclusionCard thread={thread} onResolved={onResolved} />}
      <Composer thread={thread} onSent={onSent} />
```

(`.thread` is a flex column with `gap: 18px`, so the card gets its spacing under the header with no CSS change.)

- [ ] **Step 4: Run the ThreadView tests**

Run: `cd web && npx vitest run src/thread/ThreadView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing flash tests (#2)**

Create `web/src/shell/useJustResolved.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Thread, ThreadStatus } from '../api/types'
import { makeCtx } from '../test/session'
import { newlyResolved } from './useJustResolved'

const threads = (over: Record<string, ThreadStatus>): Record<string, Thread> => {
  const base = makeCtx().state.threads
  return Object.fromEntries(Object.entries(base).map(([id, t]) => [id, { ...t, status: over[id] ?? t.status }]))
}
const statuses = (ts: Record<string, Thread>) => new Map(Object.values(ts).map((t) => [t.id, t.status]))

describe('newlyResolved (resolve feedback 2)', () => {
  it('reports threads that changed to resolved from open or proposed', () => {
    const before = threads({})
    expect(newlyResolved(statuses(before), threads({ t_1: 'resolved', t_2: 'resolved' })).sort()).toEqual(['t_1', 't_2'])
  })

  it('reports nothing on the first render, for unchanged threads, or for a new thread that is already resolved', () => {
    const after = threads({ t_1: 'resolved' })
    expect(newlyResolved(null, after)).toEqual([])
    expect(newlyResolved(statuses(after), after)).toEqual([])
    const prev = statuses(threads({}))
    prev.delete('t_1')
    expect(newlyResolved(prev, after)).toEqual([])
  })
})
```

In `web/src/shell/Shell.test.tsx`, change the imports to

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ThreadStatus } from '../api/types'
import { addComment, emptyDraft } from '../draft/draft'
import { SessionContext, type SessionCtx } from '../session/context'
import { makeCtx, renderWithCtx } from '../test/session'
import { Nav } from './Nav'
import { SessionList } from './SessionList'
import { TopBar } from './TopBar'
import { JUST_RESOLVED_MS } from './useJustResolved'
```

and append inside `describe('Nav', …)`:

```tsx
  // Resolve feedback 2: the nav confirms a resolve with a ✓ pop and a green flash, once.
  describe('resolve flash', () => {
    // A fresh ctx (new state object, like a new SSE snapshot) with the given thread statuses.
    const snap = (over: Record<string, ThreadStatus> = {}, ctxOver: Partial<SessionCtx> = {}) => {
      const ctx = makeCtx(ctxOver)
      for (const [id, status] of Object.entries(over)) ctx.state.threads[id] = { ...ctx.state.threads[id], status }
      return ctx
    }
    const renderNav = (ctx: SessionCtx, current = 't_1', live = true) => {
      const ui = (c: SessionCtx, cur: string, l: boolean) => (
        <SessionContext.Provider value={c}>
          <Nav current={cur} onSelect={vi.fn()} live={l} />
        </SessionContext.Provider>
      )
      const r = render(ui(ctx, current, live))
      return { update: (c: SessionCtx, cur = current, l = live) => r.rerender(ui(c, cur, l)) }
    }
    const row = (name: string) => screen.getByRole('button', { name })

    afterEach(() => vi.useRealTimers())

    it('does not flash on the first render, even for resolved threads', () => {
      renderNav(snap({ t_1: 'resolved' }))
      expect(row('Repository layer')).toHaveClass('is-resolved')
      expect(row('Repository layer')).toHaveTextContent('✓')
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
    })

    it('flashes a thread that becomes resolved while live, from open or from a proposed conclusion', () => {
      const { update } = renderNav(snap())
      update(snap({ t_1: 'resolved', t_2: 'resolved' }))
      expect(row('Repository layer')).toHaveClass('is-resolved', 'is-just-resolved')
      expect(row('Cache strategy')).toHaveClass('is-resolved', 'is-just-resolved')
      expect(row('Docs')).not.toHaveClass('is-just-resolved')
    })

    it('drops the flash after it played, and never replays it', () => {
      vi.useFakeTimers()
      const { update } = renderNav(snap())
      update(snap({ t_1: 'resolved' }))
      expect(row('Repository layer')).toHaveClass('is-just-resolved')
      act(() => vi.advanceTimersByTime(JUST_RESOLVED_MS))
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
      // A new snapshot with the same statuses, a draft change, and navigating to the thread.
      update(snap({ t_1: 'resolved' }))
      update(snap({ t_1: 'resolved' }, { draft: draft2 }))
      update(snap({ t_1: 'resolved' }), 't_2')
      expect(row('Repository layer')).toHaveClass('is-resolved')
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
    })

    it('does not flash a snapshot that arrives on reconnect', () => {
      const { update } = renderNav(snap())
      update(snap(), 't_1', false) // the stream dropped
      update(snap({ t_1: 'resolved' }), 't_1', true) // the reconnect snapshot and 'open' arrive together
      expect(row('Repository layer')).toHaveClass('is-resolved')
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
      update(snap({ t_1: 'resolved', t_2: 'resolved' })) // live again: the next resolve flashes
      expect(row('Cache strategy')).toHaveClass('is-just-resolved')
    })
  })
```

In `web/src/shell/SessionPage.test.tsx`, append inside `describe('SessionPage', …)`:

```tsx
  // Resolve feedback 2, end to end through useSession: the reconnect path is the real one.
  it('flashes a thread resolved over the live stream, but not threads resolved while reconnecting', () => {
    const resolved = (ids: string[]) => {
      const snap = structuredClone(fixture) as typeof fixture
      for (const id of ids) snap.state.threads[id as 't_1'].status = 'resolved'
      return JSON.stringify(snap)
    }
    render(<SessionPage sid="s_fixture" />)
    const es = FakeEventSource.instances.at(-1)!
    act(() => es.emit('state', resolved(['t_3'])))
    expect(screen.getByRole('button', { name: 'Docs' })).not.toHaveClass('is-just-resolved')

    act(() => es.emit('state', resolved(['t_3', 't_1'])))
    expect(screen.getByRole('button', { name: 'Repository layer' })).toHaveClass('is-just-resolved')

    act(() => es.fail(false))
    act(() => es.emit('state', resolved(['t_3', 't_1', 't_2'])))
    expect(screen.getByRole('button', { name: 'Cache strategy' })).toHaveClass('is-resolved')
    expect(screen.getByRole('button', { name: 'Cache strategy' })).not.toHaveClass('is-just-resolved')
  })
```

- [ ] **Step 6: Write the failing reduced-motion CSS test (#2)**

Create `web/src/styles/resolved.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('nav resolve flash (resolve feedback 2)', () => {
  it('animates the row and the icon with keyframes', () => {
    expect(appCss).toMatch(/\.nav-thread\.is-just-resolved\s*{[^}]*animation:\s*tdm-resolved-flash/)
    expect(appCss).toMatch(/\.nav-thread\.is-just-resolved \.icon\s*{[^}]*animation:\s*tdm-resolved-pop/)
    expect(appCss).toContain('@keyframes tdm-resolved-flash')
    expect(appCss).toContain('@keyframes tdm-resolved-pop')
  })

  it('switches both animations off under prefers-reduced-motion', () => {
    const blocks = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1])
    const rule = blocks.join('\n').match(/\.nav-thread\.is-just-resolved,\s*\.nav-thread\.is-just-resolved \.icon\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('animation: none')
  })
})
```

- [ ] **Step 7: Run them to see them fail**

Run: `cd web && npx vitest run src/shell src/styles/resolved.test.ts`
Expected: FAIL. `./useJustResolved` does not exist, `Nav` has no `live` prop or `is-just-resolved` class, and `app.css` has no such rules.

- [ ] **Step 8: Implement `useJustResolved`**

Create `web/src/shell/useJustResolved.ts`:

```ts
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Thread, ThreadStatus } from '../api/types'

// How long a nav row keeps `is-just-resolved`: longer than both CSS animations (1 s flash,
// 0.45 s pop). A timeout, not animationend, so the class also drops under reduced motion,
// where no animation runs.
export const JUST_RESOLVED_MS = 1200

// newlyResolved lists threads that were known and not resolved in prev, and are resolved now.
// prev is null on the first render, so the initial load reports nothing.
export function newlyResolved(prev: ReadonlyMap<string, ThreadStatus> | null, threads: Record<string, Thread>): string[] {
  if (!prev) return []
  return Object.values(threads)
    .filter((t) => t.status === 'resolved' && prev.has(t.id) && prev.get(t.id) !== 'resolved')
    .map((t) => t.id)
}

// useJustResolved (resolve feedback 2) returns the threads whose status changed to resolved while
// the page was live, for JUST_RESOLVED_MS. `live` is connection === 'open'. A reconnect snapshot
// arrives in the same render as `live` turning true, after a render where it was false, so
// threads resolved during the outage don't flash.
export function useJustResolved(threads: Record<string, Thread>, live: boolean): ReadonlySet<string> {
  const seen = useRef<Map<string, ThreadStatus> | null>(null)
  const wasLive = useRef(live)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [just, setJust] = useState<ReadonlySet<string>>(() => new Set())

  // A layout effect so the class lands before paint: the ✓ must not show for a frame and then pop.
  useLayoutEffect(() => {
    const ids = wasLive.current ? newlyResolved(seen.current, threads) : []
    seen.current = new Map(Object.values(threads).map((t) => [t.id, t.status]))
    wasLive.current = live
    if (ids.length === 0) return
    setJust((s) => new Set([...s, ...ids]))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setJust((s) => new Set([...s].filter((id) => !ids.includes(id))))
    }, JUST_RESOLVED_MS)
    timers.current.add(timer)
  }, [threads, live])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return just
}
```

(Under StrictMode the mount effect runs twice. The second run sees the statuses it just seeded, so it reports nothing.)

- [ ] **Step 9: Use it in `Nav` and pass `live` from `SessionPage`**

In `web/src/shell/Nav.tsx`, add the import

```tsx
import { useJustResolved } from './useJustResolved'
```

replace

```tsx
export function Nav({ current, onSelect }: { current: string; onSelect(id: string): void }) {
  const { state, draft } = useSessionCtx()
```

with

```tsx
// live is connection === 'open'; it keeps a reconnect snapshot from flashing (resolve feedback 2).
export function Nav({ current, onSelect, live = true }: { current: string; onSelect(id: string): void; live?: boolean }) {
  const { state, draft } = useSessionCtx()
  const justResolved = useJustResolved(state.threads, live)
```

and replace

```tsx
                className={`nav-thread is-${t.status}${current === id ? ' is-active' : ''}`}
```

with

```tsx
                className={`nav-thread is-${t.status}${current === id ? ' is-active' : ''}${justResolved.has(id) ? ' is-just-resolved' : ''}`}
```

In `web/src/shell/SessionPage.tsx`, replace

```tsx
          <Nav current={current} onSelect={select} />
```

with

```tsx
          <Nav current={current} onSelect={select} live={connection === 'open'} />
```

- [ ] **Step 10: Add the CSS**

In `web/src/styles/app.css`, after the line `.nav-thread .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`, add:

```css
/* Resolve feedback 2: a thread that just became resolved pops its ✓ in with a short green flash.
   The class is dropped by useJustResolved after JUST_RESOLVED_MS, so it plays once. */
.nav-thread.is-just-resolved { animation: tdm-resolved-flash 1s ease-out; }
.nav-thread.is-just-resolved .icon { display: inline-block; color: var(--ok); animation: tdm-resolved-pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes tdm-resolved-flash {
  from { background-color: var(--ok-bg); color: var(--ok); }
}
@keyframes tdm-resolved-pop {
  0% { transform: scale(0.3); opacity: 0; }
  60% { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .nav-thread.is-just-resolved,
  .nav-thread.is-just-resolved .icon { animation: none; }
}
```

(`tdm-resolved-flash` has only a `from` frame, so it fades into whatever background the row has, `--nav-active` included. Under reduced motion the ✓ turns `--ok` green for `JUST_RESOLVED_MS` with no motion, and the resolved state shows as before.)

- [ ] **Step 11: Run the flash tests**

Run: `cd web && npx vitest run src/shell src/styles`
Expected: PASS, including the existing Nav, TopBar and SessionPage tests.

- [ ] **Step 12: Write the failing End session toast tests (#3)**

In `web/src/shell/SessionPage.test.tsx`, in `'exports to the clipboard and ends the session'`, after the `expect(JSON.parse(…)).toEqual({ type: 'session.end', data: {} })` line, add:

```tsx
    expect(await screen.findByText('✓ Session ended')).toBeInTheDocument()
    expect(screen.getByText('✓ Session ended').closest('.toast')).toHaveClass('is-info')
```

and append inside `describe('SessionPage', …)`:

```tsx
  // Resolve feedback 3: the toast confirms only a request that succeeded.
  it('shows no End session toast when the confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/actions'))).toBe(false)
    expect(screen.queryByText('✓ Session ended')).toBeNull()
  })

  it('shows the error, not the End session toast, when ending fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions')
        ? new Response('{"error":{"code":"end_failed","message":"boom"}}', { status: 500 })
        : url.includes('/blobs/')
          ? new Response(REPO_KT)
          : new Response('{}'),
    )
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('end_failed: boom')
    expect(screen.queryByText('✓ Session ended')).toBeNull()
  })
```

- [ ] **Step 13: Run them to see them fail**

Run: `cd web && npx vitest run src/shell/SessionPage.test.tsx`
Expected: FAIL. `'exports to the clipboard and ends the session'` finds no `✓ Session ended`. The cancel and failure tests already pass, and they must keep passing after Step 14.

- [ ] **Step 14: Show the toast after a successful end**

In `web/src/shell/SessionPage.tsx`, replace

```tsx
  const onEnd = useCallback(() => {
    if (window.confirm('End this session? The AI will wrap up and export.')) void ctx.run({ type: 'session.end', data: {} })
  }, [ctx])
```

with

```tsx
  // Resolve feedback 3: confirm a successful end with a toast. A failure already shows its error
  // notice (useController), and a cancelled confirm sends nothing.
  const onEnd = useCallback(() => {
    if (!window.confirm('End this session? The AI will wrap up and export.')) return
    void ctx.run({ type: 'session.end', data: {} }).then((ok) => {
      if (ok) setNotice({ kind: 'info', text: '✓ Session ended' })
    })
  }, [ctx])
```

- [ ] **Step 15: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src/thread web/src/shell web/src/styles
git commit -m "feat(web): conclusion on top of resolved threads, nav resolve flash, End session toast

A resolved thread shows its conclusion under the title. A thread that
becomes resolved while the page is live pops its nav check in with a
short green flash (not on load or reconnect; off under reduced motion).
A successful End session shows a toast."
```

---

### Task 3: End-to-end coverage, rebuild webdist, verify everything

**Files:**
- Modify: `web/e2e/loop.spec.ts` (the first test)
- Regenerate: `internal/daemon/webdist/`

**Interfaces:**
- Consumes: everything above.
- Produces: an embedded UI that matches `web/src`.

- [ ] **Step 1: Extend the first e2e test**

In `web/e2e/loop.spec.ts`, in `test('agent and user complete a thread through the page', …)`, replace

```ts
  // Navigate back to the thread and confirm it now shows the accepted conclusion.
  await page.getByRole('button', { name: 'Repository layer' }).click()
  await expect(page.getByText('Conclusion', { exact: true })).toBeVisible()
  await expect(page.getByText('Keep the repository; use a lazy delegate.')).toBeVisible()
```

with

```ts
  // Navigate back to the thread and confirm it now shows the accepted conclusion, under the
  // title and above the first block (resolve feedback 1).
  await page.getByRole('button', { name: 'Repository layer' }).click()
  const conclusion = page.getByRole('region', { name: 'Conclusion' })
  await expect(conclusion).toContainText('Keep the repository; use a lazy delegate.')
  const [conclusionBox, firstBlockBox] = await Promise.all([conclusion.boundingBox(), page.locator('#b_1').boundingBox()])
  expect(conclusionBox!.y).toBeLessThan(firstBlockBox!.y)
```

and after the Export lines at the end of that test

```ts
  await expect(page.getByText('Decision document copied to the clipboard.')).toBeVisible()
```

add

```ts

  // Resolve feedback 3: ending the session confirms with a toast once the request succeeds
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'End session' }).click()
  await expect(page.getByText('✓ Session ended')).toBeVisible()
  await expect(page.getByRole('button', { name: 'End session' })).toHaveCount(0)
```

(The nav flash is not asserted in e2e. It lasts 1.2 s and would make the test timing-dependent. The unit tests in Task 2 pin it.)

- [ ] **Step 2: Build the web UI**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known and fine.

- [ ] **Step 3: Run the full suites and the project typecheck**

Run: `go test ./... && (cd web && npm test && npx tsc -b)`
Expected: all PASS. `TestPageServesBuiltUI` serves the new build. `tsc -b` writes only the git-ignored `tsconfig.tsbuildinfo`.

- [ ] **Step 4: Run the e2e (needs `npx playwright install chromium` once and a Go toolchain)**

Run: `cd web && npm run e2e`
Expected: all three tests PASS.

- [ ] **Step 5: Commit the e2e test and the build, separately**

```bash
git status --short   # expect web/e2e/loop.spec.ts and internal/daemon/webdist/ only
git add web/e2e/loop.spec.ts
git commit -m "test(web): e2e for the resolved conclusion position and the End session toast"
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the resolve and end-session feedback"
```

- [ ] **Step 6: Manual smoke check (with the user)**

Use a scratch home: `TANDEM_HOME="$(mktemp -d)"`, `go build -o /tmp/tdm ./cmd/tdm`, then drive a session with two threads. Check:
- Resolve a thread in the page: the page advances, and the resolved thread's ✓ in the nav pops in with a green flash that fades in about a second;
- `tdm conclude` + Accept, and a resolve by the agent (`tdm thread resolve`), flash the same way;
- reload the page: no flash on the resolved threads. Stop and restart the daemon while a thread gets resolved, then reconnect: no flash;
- with the OS reduced-motion setting on: no pop or flash, the ✓ shows (briefly green);
- open a resolved thread: the conclusion is right under the title; an open thread still ends with Resolve above the composer;
- End session → Cancel: nothing; End session → OK: `✓ Session ended` toast, which closes by itself.

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| 1. Conclusion under the title on a resolved thread; open threads keep it at the bottom | Task 2 (ThreadView placement, `aria-label="Conclusion"`); e2e in Task 3 |
| 2. ✓ pop + green flash in the nav when a thread becomes resolved while the page is open (user action or not); never on initial load or reconnect | Task 2 (`useJustResolved`, `Nav`, CSS; Shell, SessionPage and hook tests) |
| 3. `✓ Session ended` toast after a confirmed, successful End session, via the existing toast | Task 2 (`onEnd`, SessionPage tests); e2e in Task 3 |
| Animations honor `prefers-reduced-motion`; the state change still shows | Task 2 (reduced-motion rule, `styles/resolved.test.ts`) |
| No Go changes, no new dependencies | All tasks (only `web/` and the rebuilt `webdist`) |

**Type and name consistency:**
- `useJustResolved(threads, live)`, `newlyResolved(prev, threads)` and `JUST_RESOLVED_MS` come from `web/src/shell/useJustResolved.ts` and are imported by `Nav.tsx`, `Shell.test.tsx` and `useJustResolved.test.ts`.
- `Nav`'s `live` prop defaults to `true`, so the existing `Nav` test and any other caller compile unchanged. `SessionPage` passes `connection === 'open'` (`Connection` is `'connecting' | 'open' | 'lost'`).
- The class `is-just-resolved` and the keyframes `tdm-resolved-flash` / `tdm-resolved-pop` are the same in `Nav.tsx`, `app.css`, `Shell.test.tsx`, `SessionPage.test.tsx` and `styles/resolved.test.ts`.
- `✓ Session ended` is the same in `SessionPage.tsx`, `SessionPage.test.tsx` and the e2e.
- The region name `Conclusion` (resolved) and `Proposed conclusion` (proposed) are the same in `ConclusionCard.tsx`, `ThreadView.test.tsx` and the e2e.

**Deliberate choices:**
- "Became resolved" is detected in the nav from snapshot to snapshot, not from the user's action. That gives the same flash for Accept, Resolve, Choose & resolve, and a resolve by the agent, as the spec asks.
- Reconnect is detected by the connection state on the previous render, not by snapshot contents. A thread resolved during an outage therefore shows as resolved without a flash.
- The class is cleared by a timeout, not `animationend`. That clears it the same way under reduced motion and in jsdom. Under reduced motion the ✓ is briefly `--ok` green with no motion. That is a color change, not motion.
- The flash is not asserted in e2e (timing-dependent). The End session toast and the conclusion position are.
- The e2e test and the webdist rebuild are two commits, so the `build(web): …` commit holds only generated files.
