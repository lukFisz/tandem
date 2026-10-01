# Question Message and Option Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two parts of the approved spec:
- **Part A** (Tasks 1–2, shippable on its own): `o_N` in agent text renders as a chip with the option's title, like `t_N`/`st_N`. A click opens the option's thread and scrolls to the option.
- **Part B** (Tasks 3–10): the question message. `tdm ask "<question>" --option A --option B …` posts an AI message with 2–4 answer buttons plus **Other…**. The answer reaches the agent through `tdm wait`, `tdm ask --withdraw q_N` withdraws a question, and `q_N` gets the same chip.

**Architecture:**
- **Part A** reuses the chip tokenizer in `web/src/refs/ids.ts`, which gains `o_N` and a shared `idTitles(state)` list. The chip is still a plain link to `#o_N`. `useCurrentItem` (`web/src/session/nav.ts`) learns anchors: `anchorOf(state, id)` maps an option id to its thread and a CSS selector. The hook shows that thread, rewrites the hash to `#t_N` with `history.replaceState`, and returns a fresh `{ selector }` scroll request. `SessionPage` scrolls that element into view once it renders.
- **Part B**, domain: three new events (`question.asked`, `question.answered`, `question.withdrawn`) and three commands (`ask` and `question.withdraw` from the agent, `question.answer` from the user). There is a private `questionCount`, and `optionCount` is now shared with variants. `Message` gets an optional `question`. `question.answered` also appends the user message `Answered: …`.
- **Part B**, everything else: render adds a `question answered` section to `tdm wait`, the CLI adds `tdm ask`, and the daemon needs only a new fixture and a batching test. The web adds `QuestionMessage` (buttons, Other…, keys 1–4, and the answered, withdrawn and not-answered states), the nav dot, and `q_N` chips/anchors.

**Tech Stack:** Go 1.x (cobra CLI, event-sourced domain, `net/http` daemon), React 19 + TypeScript + Vite, Vitest + Testing Library, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-question-message.md` (committed as d2feba7). Conventions: `docs/superpowers/plans/2026-09-26-resolve-feedback.md` and `docs/superpowers/plans/2026-09-25-demo2-followups.md`. The id-chip mechanism reused by Part A landed in 9daca22.

## Global Constraints

- Module path `github.com/lukaszfiszer/tandem`. Go tests: `go test ./...` from the repo root; `gofmt -l internal e2e` must list nothing. Web tests: `cd web && npm test`. Web typecheck: `cd web && npm run typecheck`. Playwright: `cd web && npm run e2e`.
- No new dependencies (Go or npm).
- Part A (Tasks 1–2) must be complete, tested and committed, with webdist rebuilt, before any Part B task starts.
- Wire names, verbatim from the spec:
  - events `question.asked` (actor ai), `question.answered` (actor user), `question.withdrawn` (actor ai);
  - question ids `q_N` from their own counter;
  - option ids `o_N` from the **global counter shared with variants**.
- Command names: agent `ask` and `question.withdraw`; user `question.answer`. The answer carries exactly one of `optionId` / `other`.
- `message.posted` is unchanged. The asked event appends an AI message whose `text` is the question. `Message.question` is `{id, options, answer?, withdrawn?}`.
- User message on answer, verbatim: `Answered: <title>` or `Answered: "<other>"`. `other` is trimmed.
- Decide rejects, and only these. The one-open-question-per-thread rule is **not** enforced.
  - `ask`: a resolved thread, fewer than 2 or more than 4 options, an empty question, an empty option title;
  - `answer`: an unknown `q_N`, an answered or withdrawn question, a resolved thread, an empty `other`, and both or neither of `optionId`/`other`;
  - `withdraw`: an unknown `q_N`, an answered or withdrawn question.
- Answering never resolves the thread.
- `tdm wait` output, verbatim:
  - option: `## t_N "<thread>" — question answered` then `Answered q_N "<question>": o_N "<title>".`;
  - Other: `Answered q_N "<question>" with their own answer:` followed by the text quoted with `> `.
- `tdm ask` prints `q_N o_N o_N …`, and `tdm ask --withdraw q_N` prints `q_N`. Default thread: the latest open one.
- Web copy, verbatim: buttons are the option titles plus `Other…`; the Other input is labelled `Your answer`, with the button `Send answer`. Status lines: `Answer: <title>` / `Answer: "<other>"` (muted), `Withdrawn`, `Not answered`. The question bubble is `<section aria-label="Question" data-question="q_N">`, and the nav dot is `<span class="badge is-dot" aria-label="question awaiting you">`.
- Chips: `o_N` → the option title; `q_N` → the first line of the question text, and CSS truncates it with an ellipsis. Hover shows `id: <id>`. Unknown ids stay plain text.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 2 and Task 10**, each time as its own `build(web): …` commit. If another build touches it, discard with `git checkout internal/daemon/webdist`.
- Commit messages use conventional style (`feat(domain): …`, `feat(render): …`, `feat(cli): …`, `test(daemon): …`, `feat(web): …`, `docs: …`, `test(e2e): …`, `build(web): …`). They carry **no** `Co-Authored-By` or other co-author trailer (repo convention).
- Run the tasks in order.

## Review Focus

1. **A double answer.** A double click, key repeat, or a click and then a key while the first answer is in flight must send one `question.answer`. A second one would fail with `question_closed` and show an error toast. Pinned in Task 7 (`QuestionMessage.test.tsx` "sends one answer while one is in flight").
2. **Keys 1–4 in the wrong place.** Keys must do nothing when typing in the composer or the Other input, on a resolved thread, in a read-only session, for a number beyond the option count, or for an older open question when a newer one exists. Pinned in Task 7 (`QuestionMessage.test.tsx` keys tests).
3. **Draft comments sent with an answer.** They must arrive first as their own `review.submitted`. A rejected answer (for example `question_closed`) must save neither, because the batch is atomic. Pinned in Task 6 (`server_test.go` `TestQuestionActions`) and Task 10 (`e2e/TestQuestionLoop`).
4. **Whitespace in Other.** `"  x \n"` is stored and shown as `x`, a blank `other` is rejected, and **Send answer** stays disabled for blank text. Pinned in Task 3 (`TestAnswerQuestion`, `TestQuestionRules`) and Task 7 (the Other test).
5. **Shared `o_N` counter across variants and questions, and after a replay.** Interleaved `variants`/`ask` commands, and a log replayed from disk, must keep issuing unique, increasing `o_N`/`q_N`. Pinned in Task 3 (`TestAskSharesTheOptionCounterWithVariants`, `TestReplayQuestionEvents`).

---

### Task 1: Web: option ids as chips that open and scroll to the option (Part A)

**Files:**
- Modify: `web/src/refs/ids.ts` (the `o_N` token, `idTitles`, `titlesOf`)
- Modify: `web/src/refs/IdChip.tsx` (`titleKey` uses `idTitles`)
- Modify: `web/src/session/nav.ts` (`ItemAnchor`, `anchorOf`, `ScrollRequest`, `useCurrentItem` returns a scroll request)
- Modify: `web/src/shell/SessionPage.tsx` (scroll to the anchor)
- Test: `web/src/refs/ids.test.ts`, `web/src/refs/IdChip.test.tsx`, `web/src/markdown/markdown.test.ts`, `web/src/session/nav.test.ts`, `web/src/shell/SessionPage.test.tsx`, `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `splitIds`, `IdChip`, `idChipHtml`, `useTitleOf`, `useCurrentItem`, `prefersReducedMotion` (`web/src/shell/motion.ts`), and the `data-option="o_N"` attribute that `VariantsBlock` already puts on each option card.
- Produces:
  - `idTitles(state: State): [string, string][]` in `web/src/refs/ids.ts`, the id/title pairs for chips (Task 8 extends it);
  - `interface ItemAnchor { threadId: string; selector: string }`;
  - `anchorOf(state: State, id: string): ItemAnchor | undefined` in `web/src/session/nav.ts` (Task 8 extends it);
  - `interface ScrollRequest { selector: string }`;
  - `useCurrentItem(state): [string, (id: string) => void, ScrollRequest | null]`.

- [ ] **Step 1: Write the failing tests**

In `web/src/refs/ids.test.ts`, replace

```ts
const titles: Record<string, string> = { t_1: 'Repository layer', t_2: 'Cache strategy', st_1: 'Data model' }
```

with

```ts
const titles: Record<string, string> = { t_1: 'Repository layer', t_2: 'Cache strategy', st_1: 'Data model', o_2: 'Lazy delegate' }
```

and add inside `describe('splitIds (demo2 follow-up 4)', …)`, after `'turns known thread and stage ids into refs'`:

```ts
  // Question message spec, part A: option ids are chips too, with the same word rules.
  it('turns known option ids into refs, and leaves unknown or partial ones as text', () => {
    expect(splitIds('Went with o_2.', titleOf)).toEqual([
      { kind: 'text', text: 'Went with ' },
      { kind: 'ref', id: 'o_2', title: 'Lazy delegate' },
      { kind: 'text', text: '.' },
    ])
    for (const text of ['o_2x', 'xo_2', 'o_9', 'see `o_2`', 'foo_2']) {
      expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
    }
  })
```

In the same file, in `describe('titlesOf', …)`, add after `expect(f('st_9')).toBeUndefined()`:

```ts
    expect(f('o_1')).toBe('Empty map')
    expect(f('o_2')).toBe('Lazy delegate')
    expect(f('o_9')).toBeUndefined()
```

In `web/src/refs/IdChip.test.tsx`, in `'keeps the same function while the titles stay the same'`, add after `expect(first?.('t_2')).toBe('Cache strategy')`:

```tsx
    expect(first?.('o_1')).toBe('Empty map')
```

and at the end of that test (after `expect(result.current?.('t_2')).toBe('Cache policy')`):

```tsx
    const option = structuredClone(renamed)
    const b3 = option.blocks.b_3
    option.blocks.b_3 = {
      ...b3,
      variants: { ...b3.variants!, options: b3.variants!.options.map((o) => (o.id === 'o_1' ? { ...o, title: 'Empty hash map' } : o)) },
    }
    ctx = { ...ctx, state: option }
    rerender()
    expect(result.current?.('o_1')).toBe('Empty hash map')
```

In `web/src/markdown/markdown.test.ts`, inside `describe('id chips in markdown (demo2 follow-up 4)', …)`, add:

```ts
  it('renders option ids as chips (question message spec, part A)', () => {
    const html = md.render('Chose o_1.', { titleOf: (id: string) => (id === 'o_1' ? 'Empty map' : undefined) })
    expect(html).toContain('<a class="id-chip" href="#o_1" title="id: o_1">Empty map</a>')
  })
```

In `web/src/session/nav.test.ts`, replace the imports

```ts
import { defaultItem, isValidItem, navOrder, nextAfterResolve, statusIcon, useCurrentItem } from './nav'
import { renderHook } from '@testing-library/react'
```

with

```ts
import { anchorOf, defaultItem, isValidItem, navOrder, nextAfterResolve, statusIcon, useCurrentItem } from './nav'
import { act, renderHook } from '@testing-library/react'
```

and add at the end of `describe('nav', …)`:

```ts
  // Question message spec, part A: an option id opens its thread and scrolls to the option.
  it('maps an option id to its thread and card', () => {
    const { state } = fixtureSnapshot()
    expect(anchorOf(state, 'o_2')).toEqual({ threadId: 't_2', selector: '[data-option="o_2"]' })
    expect(anchorOf(state, 'o_9')).toBeUndefined()
    expect(anchorOf(state, 't_1')).toBeUndefined()
    expect(anchorOf(state, '')).toBeUndefined()
  })

  it('opens the thread of an option hash, pins the thread id and asks to scroll, on every visit', () => {
    const { state } = fixtureSnapshot()
    window.location.hash = '#o_1'
    const { result } = renderHook(() => useCurrentItem(state))
    expect(result.current[0]).toBe('t_2')
    expect(window.location.hash).toBe('#t_2')
    const first = result.current[2]
    expect(first).toEqual({ selector: '[data-option="o_1"]' })

    // A second click on the same chip scrolls again: a new request object.
    act(() => {
      window.location.hash = '#o_1'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current[0]).toBe('t_2')
    expect(window.location.hash).toBe('#t_2')
    expect(result.current[2]).toEqual({ selector: '[data-option="o_1"]' })
    expect(result.current[2]).not.toBe(first)
  })

  it('treats an unknown option id like any unknown hash', () => {
    const { state } = fixtureSnapshot()
    window.location.hash = '#o_9'
    const { result } = renderHook(() => useCurrentItem(state))
    expect(result.current[0]).toBe('t_1')
    expect(window.location.hash).toBe('#t_1')
    expect(result.current[2]).toBeNull()
  })
```

In `web/src/thread/ThreadView.test.tsx`, add inside `describe('ThreadView id chips (demo2 follow-up 4)', …)`:

```tsx
  it('shows option ids in AI messages as chips (question message spec, part A)', () => {
    const base = makeCtx()
    const t1 = base.state.threads.t_1
    base.state.threads.t_1 = { ...t1, messages: [{ actor: 'ai', text: 'Compare o_1 with o_9.', seq: 7 }, t1.messages[1]] }
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    const chip = within(container.querySelector('.msg-ai') as HTMLElement).getByRole('link', { name: 'Empty map' })
    expect(chip).toHaveAttribute('href', '#o_1')
    expect(chip).toHaveAttribute('title', 'id: o_1')
    expect(container.querySelector('.msg-ai')).toHaveTextContent('Compare Empty map with o_9.')
  })
```

In `web/src/shell/SessionPage.test.tsx`, add after `'opens the thread an id chip names'`:

```tsx
  // Question message spec, part A: an option chip opens the option's thread and scrolls to it.
  it('opens the thread of an option chip and scrolls to the option', async () => {
    const scrolled: { el: Element; arg: unknown }[] = []
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg })
    }
    try {
      const snap = structuredClone(fixture)
      snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache uses o_2.'
      window.location.hash = '#t_1'
      render(<SessionPage sid="s_fixture" />)
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      const chip = screen.getByRole('link', { name: 'Lazy delegate' })
      expect(chip).toHaveAttribute('title', 'id: o_2')
      await userEvent.click(chip)
      expect(await screen.findByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
      expect(window.location.hash).toBe('#t_2')
      expect(scrolled).toContainEqual({ el: document.querySelector('[data-option="o_2"]'), arg: { block: 'center', behavior: 'smooth' } })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/refs src/markdown/markdown.test.ts src/session/nav.test.ts src/shell/SessionPage.test.tsx src/thread/ThreadView.test.tsx`
Expected: FAIL.
- `o_2` stays text in `splitIds`, `titlesOf` returns `undefined` for `o_1`, and `useTitleOf` has no option titles.
- `anchorOf` is not exported, so `nav.test.ts` fails to import.
- `useCurrentItem` returns only two elements.
- No `Lazy delegate` link is rendered.

- [ ] **Step 3: Tokenize and title option ids**

Replace `web/src/refs/ids.ts` with:

```ts
import type { State } from '../api/types'

// Demo2 follow-up 4: the agent refers to threads and stages by short id (t_3, st_1); the page shows
// each known id as a chip with the item's title. The question message spec (part A) adds variant
// options (o_2). splitIds is the one tokenizer for that: it cuts text into plain runs and known
// ids. An id is a whole word (st_1x, xt_1 and t_1_2 are not ids), ids inside `code spans` stay
// text, and ids the session does not know stay text.
export type IdSegment = { kind: 'text'; text: string } | { kind: 'ref'; id: string; title: string }

export type TitleOf = (id: string) => string | undefined

// A code span or a URL (matched first, so ids inside them are skipped), or a thread/stage/option id.
// An id is a whole word that is not part of a path, file name or hyphenated word: no word char,
// '/', '.' or '-' right before it, and no word char or a '.', '/', '-' plus a word char right
// after it. Sentence punctuation still works: "see t_1." and "(t_1)" match.
const CODE_OR_ID = /(`+)[\s\S]*?\1|([a-zA-Z][\w+.-]*:\/\/\S+)|(?<![\w/.-])(?:st|t|o)_\d+(?![\w]|[./-]\w)/g

export function splitIds(text: string, titleOf: TitleOf): IdSegment[] {
  const out: IdSegment[] = []
  const pushText = (s: string) => {
    if (!s) return
    const prev = out.at(-1)
    if (prev?.kind === 'text') prev.text += s
    else out.push({ kind: 'text', text: s })
  }
  let last = 0
  for (const m of text.matchAll(CODE_OR_ID)) {
    if (m[1] !== undefined || m[2] !== undefined) continue // a code span or URL: stays in the text run
    const title = titleOf(m[0])
    if (title === undefined) continue // an unknown id: stays in the text run
    pushText(text.slice(last, m.index!))
    out.push({ kind: 'ref', id: m[0], title })
    last = m.index! + m[0].length
  }
  pushText(text.slice(last))
  return out
}

// idTitles lists every id a chip can show with its title: stages, threads and variant options.
// useTitleOf keys its memo on this list, so it must stay cheap and deterministic.
export function idTitles(state: State): [string, string][] {
  const pairs: [string, string][] = state.stages.map((s) => [s.id, s.title])
  for (const t of Object.values(state.threads)) pairs.push([t.id, t.title])
  for (const b of Object.values(state.blocks)) for (const o of b.variants?.options ?? []) pairs.push([o.id, o.title])
  return pairs
}

// titlesOf looks ids up in the session state.
export function titlesOf(state: State): TitleOf {
  const titles = new Map(idTitles(state))
  return (id) => titles.get(id)
}
```

In `web/src/refs/IdChip.tsx`, replace

```tsx
import { splitIds, type TitleOf } from './ids'
```

with

```tsx
import { idTitles, splitIds, type TitleOf } from './ids'
```

and replace

```tsx
function titleKey(state: State): string {
  const pairs: [string, string][] = state.stages.map((s) => [s.id, s.title])
  for (const t of Object.values(state.threads)) pairs.push([t.id, t.title])
  return JSON.stringify(pairs)
}

// IdChip shows a thread or stage by its title (demo2 follow-up 4). It is a plain link to #<id>, so
// a click opens the item through the page's hash routing (useCurrentItem), like the stage page's
// thread list. The title attribute shows the id on hover. Its HTML twin for markdown is
// idChipHtml (markdown/markdown.ts); keep the two in sync.
```

with

```tsx
function titleKey(state: State): string {
  return JSON.stringify(idTitles(state))
}

// IdChip shows a thread, stage or option by its title (demo2 follow-up 4, question message spec).
// It is a plain link to #<id>, so a click opens the item through the page's hash routing
// (useCurrentItem, which maps an option to its thread and scrolls to it). The title attribute
// shows the id on hover. Its HTML twin for markdown is idChipHtml (markdown/markdown.ts); keep
// the two in sync.
```

- [ ] **Step 4: Route option hashes to their thread and request a scroll**

In `web/src/session/nav.ts`, after `isValidItem`, add:

```ts
// ItemAnchor is where an id that lives inside a thread points: the thread to open and the element
// to scroll to (question message spec, part A).
export interface ItemAnchor {
  threadId: string
  selector: string
}

// anchorOf maps a variant option id (o_N) to its thread and its card. Other ids, and option ids
// the session does not know, have no anchor.
export function anchorOf(state: State, id: string): ItemAnchor | undefined {
  if (!/^o_\d+$/.test(id)) return undefined
  for (const b of Object.values(state.blocks))
    if (b.variants?.options.some((o) => o.id === id)) return { threadId: b.threadId, selector: `[data-option="${id}"]` }
  return undefined
}

// ScrollRequest asks the page to bring an element into view. Every visit to an anchor makes a
// new object, so a second click on the same chip scrolls again.
export interface ScrollRequest {
  selector: string
}
```

Replace the whole `useCurrentItem` (its comment and body) with:

```ts
// useCurrentItem keeps the selected stage/thread in location.hash (#t_3, #st_1).
// Once an item is shown (because the hash was empty or invalid), it is pinned: the chosen
// default is written to the hash with history.replaceState (no history entry added), so a
// later snapshot change that would move defaultItem elsewhere does not move the view. The
// user's explicit selection and hashchange still take effect. If the pinned item becomes
// invalid (e.g. removed from state), the default is recomputed.
// A hash that names an anchor (#o_2, from an option chip) opens the anchor's thread: the hash
// is rewritten to the thread id the same way, and the third value asks the page to scroll to
// the anchor (question message spec, part A).
export function useCurrentItem(state: State): [string, (id: string) => void, ScrollRequest | null] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1))
  const [scrollTo, setScrollTo] = useState<ScrollRequest | null>(null)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const select = useCallback((id: string) => {
    if (window.location.hash.slice(1) !== id) window.location.hash = id
    setHash(id)
  }, [])
  const valid = isValidItem(state, hash)
  const anchor = valid ? undefined : anchorOf(state, hash)
  const current = valid ? hash : (anchor?.threadId ?? defaultItem(state))
  const anchorSelector = anchor?.selector
  useEffect(() => {
    if (isValidItem(state, hash) || !current) return
    // Pin the shown item (the anchor's thread or the default) to the hash, with no history
    // entry, so a later snapshot change that would move defaultItem elsewhere does not move the
    // view out from under the user, and a second click on the same chip changes the hash again.
    window.history.replaceState(null, '', '#' + current)
    setHash(current)
    if (anchorSelector) setScrollTo({ selector: anchorSelector })
  }, [state, hash, current, anchorSelector])
  return [current, select, scrollTo]
}
```

- [ ] **Step 5: Scroll to the anchor once its thread renders**

In `web/src/shell/SessionPage.tsx`, add the import

```tsx
import { prefersReducedMotion } from './motion'
```

replace

```tsx
  const [current, select] = useCurrentItem(snapshot.state)
```

with

```tsx
  const [current, select, scrollTo] = useCurrentItem(snapshot.state)
```

and after `const follow = useFollowBottom(mainRef, contentKey, landOn)` add:

```tsx
  // Question message spec, part A: an option chip opens the option's thread; once that renders,
  // bring the option into view. Declared after useFollowBottom so its item-switch reset
  // (scrollTop = 0) has already run.
  useEffect(() => {
    if (!scrollTo) return
    const el = mainRef.current?.querySelector(scrollTo.selector)
    if (el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [scrollTo])
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run src/refs src/markdown/markdown.test.ts src/session/nav.test.ts src/shell/SessionPage.test.tsx src/thread/ThreadView.test.tsx`
Expected: PASS, including the existing `'pins the shown item so a later default change does not move the view'` and `'opens the thread an id chip names'`.

- [ ] **Step 7: Run all web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src
git commit -m "feat(web): show option ids in agent text as titled chips

A known o_N becomes a chip with the option's title (id on hover); a click
opens the option's thread and scrolls to the option."
```

---

### Task 2: Guide mentions option ids; rebuild webdist (Part A ships)

**Files:**
- Modify: `internal/guide/guide.md:14-15`
- Test: `internal/guide/guide_test.go`
- Regenerate: `internal/daemon/webdist/`

**Interfaces:**
- Consumes: Task 1's web build.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing guide test**

Append to `internal/guide/guide_test.go`:

```go
// Question message spec, part A: option ids are chips too, so the agent may mention them by id.
func TestGuideMentionsOptionIds(t *testing.T) {
	for _, s := range []string{"variant options", "`o_2`", "chip with its title"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `go test ./internal/guide/ -run TestGuideMentionsOptionIds`
Expected: FAIL, `guide.md does not mention "variant options"`.

- [ ] **Step 3: Update the guide**

In `internal/guide/guide.md`, replace

```markdown
Mention threads and stages by id (`t_3`, `st_1`) in notes, messages, conclusions and summaries. The page shows
each one as a chip with its title and opens it on click, so short ids are all you need to write.
```

with

```markdown
Mention threads, stages and variant options by id (`t_3`, `st_1`, `o_2`) in notes, messages, conclusions and
summaries. The page shows each one as a chip with its title and opens it on click, so short ids are all you need
to write.
```

- [ ] **Step 4: Run the guide tests**

Run: `go test ./internal/guide/ ./internal/cli/`
Expected: PASS.

- [ ] **Step 5: Commit the guide**

```bash
git add internal/guide/guide.md internal/guide/guide_test.go
git commit -m "docs(guide): mention option ids as chips"
```

- [ ] **Step 6: Build the web UI into webdist**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known and fine.

- [ ] **Step 7: Verify everything**

Run: `go test ./... && (cd web && npm test && npx tsc -b)`
Expected: all PASS. `TestPageServesBuiltUI` serves the new build.

Run: `cd web && npm run e2e`
Expected: all three existing tests PASS.

- [ ] **Step 8: Commit the build**

```bash
git status --short   # expect internal/daemon/webdist/ only
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for option id chips"
```

Part A is now shippable.

---

### Task 3: Domain: ask, answer and withdraw a question

**Files:**
- Modify: `internal/domain/events.go` (event names and payloads)
- Modify: `internal/domain/commands.go` (`Ask`, `AnswerQuestion`, `WithdrawQuestion`, factories)
- Modify: `internal/domain/state.go` (`Message.Question`, `MessageQuestion`, `QuestionOption`, `QuestionAnswer`, `questionCount`, `State.Question`, `MessageQuestion.Option`, `AnswerMessage`)
- Modify: `internal/domain/errors.go` (`CodeQuestionNotFound`, `CodeQuestionClosed`)
- Modify: `internal/domain/resolve.go` (`openQuestion`)
- Modify: `internal/domain/decide.go` (`decideAsk`, `decideAnswer`, withdraw)
- Modify: `internal/domain/reducer.go` (the three events)
- Test: `internal/domain/question_test.go` (new)

**Interfaces:**
- Consumes: `activeThread`, `required`, `errorf`, `FormatID`, `one`, `Thread.userMessage`, `s.optionCount`.
- Produces (Tasks 4–10 rely on these exact names):
  - `const EvQuestionAsked = "question.asked"`, `EvQuestionAnswered = "question.answered"`, `EvQuestionWithdrawn = "question.withdrawn"`;
  - `type QuestionOption struct { ID string \`json:"id"\`; Title string \`json:"title"\` }`;
  - `type QuestionAsked struct { ThreadID, QuestionID, Text string; Options []QuestionOption }` (JSON `threadId`, `questionId`, `text`, `options`);
  - `type QuestionAnswered struct { ThreadID, QuestionID, OptionID, Other string }` (JSON `threadId`, `questionId`, `optionId,omitempty`, `other,omitempty`);
  - `type QuestionWithdrawn struct { ThreadID, QuestionID string }`;
  - `type Ask struct { ThreadID string; Text string; Options []string }` (wire `ask`, JSON `threadId,omitempty`, `text`, `options`);
  - `type AnswerQuestion struct { QuestionID, OptionID, Other string }` (wire `question.answer`, user);
  - `type WithdrawQuestion struct { QuestionID string }` (wire `question.withdraw`, ai);
  - `type MessageQuestion struct { ID string; Options []QuestionOption; Answer *QuestionAnswer; Withdrawn bool }` (JSON `id`, `options`, `answer,omitempty`, `withdrawn,omitempty`);
  - `type QuestionAnswer struct { OptionID, Other string }` (JSON `optionId,omitempty`, `other,omitempty`);
  - `Message.Question *MessageQuestion` (JSON `question,omitempty`);
  - `func (s *State) Question(id string) (*Thread, *Message)`;
  - `func (q *MessageQuestion) Option(id string) *QuestionOption`;
  - `func AnswerMessage(q *MessageQuestion, a QuestionAnswer) string`;
  - `CodeQuestionNotFound = "question_not_found"`, `CodeQuestionClosed = "question_closed"`;
  - the `ask` Result is `{ID: "q_N", OptionIDs: ["o_N", …]}`, and the answer and withdraw Results are `{ID: "q_N"}`.

- [ ] **Step 1: Write the failing domain tests**

Create `internal/domain/question_test.go`:

```go
package domain_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	. "github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

var ask = &Ask{Text: "Must old logs stay readable?", Options: []string{"Yes", "No"}}

// Question message spec: option ids come from the o_N counter shared with variants; q_N has its own.
// Review Focus 5: interleaving keeps every id unique and increasing.
func TestAskSharesTheOptionCounterWithVariants(t *testing.T) {
	s, _ := domaintest.Build(t, stage, thread, variants)
	_, res, err := Decide(s, ask)
	if err != nil || res.ID != "q_1" || !reflect.DeepEqual(res.OptionIDs, []string{"o_3", "o_4"}) {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	s, _ = domaintest.Build(t, stage, thread, ask, variants, ask)
	if got := s.Blocks["b_1"].Variants.Options[0].ID; got != "o_3" {
		t.Fatalf("variants after a question start at %s, want o_3", got)
	}
	if _, m := s.Question("q_2"); m == nil || m.Question.Options[0].ID != "o_5" || m.Question.Options[1].ID != "o_6" {
		t.Fatalf("q_2 = %+v", m)
	}
}

func TestAskAppendsAQuestionMessage(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, &Say{Text: "hi"}, ask)
	th := s.Threads["t_1"]
	want := Message{Actor: ActorAI, Text: "Must old logs stay readable?", Seq: 5, Question: &MessageQuestion{ID: "q_1",
		Options: []QuestionOption{{ID: "o_1", Title: "Yes"}, {ID: "o_2", Title: "No"}}}}
	if len(th.Messages) != 2 || !reflect.DeepEqual(th.Messages[1], want) || th.LastAISeq != 5 || th.AwaitingAI() {
		t.Fatalf("thread = %+v", th)
	}
	var p QuestionAsked
	last := events[len(events)-1]
	if last.Type != EvQuestionAsked || last.Actor != ActorAI || last.Decode(&p) != nil || p.ThreadID != "t_1" || p.QuestionID != "q_1" {
		t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
	}
}

func TestAnswerQuestion(t *testing.T) {
	cases := []struct {
		name   string
		answer *AnswerQuestion
		text   string
		want   QuestionAnswer
	}{
		{"option", &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"}, "Answered: No", QuestionAnswer{OptionID: "o_2"}},
		// Review Focus 4: the user's own answer is trimmed.
		{"other", &AnswerQuestion{QuestionID: "q_1", Other: "  Only the last month.\n"}, `Answered: "Only the last month."`,
			QuestionAnswer{Other: "Only the last month."}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, events := domaintest.Build(t, stage, thread, ask, tc.answer)
			th, m := s.Question("q_1")
			if th == nil || th.ID != "t_1" || !reflect.DeepEqual(m.Question.Answer, &tc.want) {
				t.Fatalf("question = %+v", m)
			}
			msg := th.Messages[len(th.Messages)-1]
			if msg.Actor != ActorUser || msg.Text != tc.text || msg.Seq != 5 || msg.Question != nil {
				t.Fatalf("message = %+v", msg)
			}
			// Answering never resolves the thread; the agent picks it up.
			if th.Status != ThreadOpen || !th.AwaitingAI() {
				t.Fatalf("thread = %+v", th)
			}
			var p QuestionAnswered
			last := events[len(events)-1]
			if last.Type != EvQuestionAnswered || last.Actor != ActorUser || last.Decode(&p) != nil ||
				p.ThreadID != "t_1" || p.QuestionID != "q_1" || p.OptionID != tc.want.OptionID || p.Other != tc.want.Other {
				t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
			}
		})
	}
	// The thread still concludes and resolves as usual after an answer.
	s, _ := domaintest.Build(t, stage, thread, ask, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}, conclude, accept)
	if s.Threads["t_1"].Status != ThreadResolved {
		t.Fatalf("thread = %+v", s.Threads["t_1"])
	}
}

func TestWithdrawQuestion(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, ask, &WithdrawQuestion{QuestionID: "q_1"})
	th, m := s.Question("q_1")
	if !m.Question.Withdrawn || m.Question.Answer != nil || th.LastAISeq != 5 || len(th.Messages) != 1 {
		t.Fatalf("thread = %+v, question = %+v", th, m.Question)
	}
	if last := events[len(events)-1]; last.Type != EvQuestionWithdrawn || last.Actor != ActorAI {
		t.Fatalf("event = %s by %s", last.Type, last.Actor)
	}
}

func TestQuestionRules(t *testing.T) {
	ab := []string{"a", "b"}
	with := func(base []Command, c Command) []Command { return append(append([]Command{}, base...), c) }
	asked := []Command{stage, thread, ask}
	answered := with(asked, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"})
	withdrawn := with(asked, &WithdrawQuestion{QuestionID: "q_1"})
	resolved := with(asked, &ResolveThread{ThreadID: "t_1"})

	cases := []struct {
		name string
		cmds []Command
		code string
	}{
		{"ask on a resolved thread", []Command{stage, thread, &ResolveThread{ThreadID: "t_1"}, &Ask{ThreadID: "t_1", Text: "q", Options: ab}}, CodeThreadResolved},
		{"ask with one option", with(asked[:2], &Ask{Text: "q", Options: []string{"a"}}), CodeInvalidInput},
		{"ask with five options", with(asked[:2], &Ask{Text: "q", Options: []string{"a", "b", "c", "d", "e"}}), CodeInvalidInput},
		{"ask without a question", with(asked[:2], &Ask{Text: "  ", Options: ab}), CodeInvalidInput},
		{"ask with an empty option", with(asked[:2], &Ask{Text: "q", Options: []string{"a", " "}}), CodeInvalidInput},
		{"answer without a question id", with(asked, &AnswerQuestion{OptionID: "o_1"}), CodeInvalidInput},
		{"answer an unknown question", with(asked, &AnswerQuestion{QuestionID: "q_9", OptionID: "o_1"}), CodeQuestionNotFound},
		{"answer twice", with(answered, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"}), CodeQuestionClosed},
		{"answer a withdrawn question", with(withdrawn, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}), CodeQuestionClosed},
		{"answer on a resolved thread", with(resolved, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}), CodeThreadResolved},
		{"answer with a blank other", with(asked, &AnswerQuestion{QuestionID: "q_1", Other: " \n"}), CodeInvalidInput},
		{"answer with both", with(asked, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1", Other: "x"}), CodeInvalidInput},
		{"answer with neither", with(asked, &AnswerQuestion{QuestionID: "q_1"}), CodeInvalidInput},
		{"answer with another question's option", with(with(asked, ask), &AnswerQuestion{QuestionID: "q_1", OptionID: "o_3"}), CodeOptionNotFound},
		{"withdraw an unknown question", with(asked[:2], &WithdrawQuestion{QuestionID: "q_1"}), CodeQuestionNotFound},
		{"withdraw an answered question", with(answered, &WithdrawQuestion{QuestionID: "q_1"}), CodeQuestionClosed},
		{"withdraw twice", with(withdrawn, &WithdrawQuestion{QuestionID: "q_1"}), CodeQuestionClosed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := domaintest.Try(t, tc.cmds...)
			var de *Error
			if !errors.As(err, &de) || de.Code != tc.code {
				t.Fatalf("got %v, want code %s", err, tc.code)
			}
		})
	}
	// Not enforced: a second open question in the same thread (the guide asks for one at a time).
	domaintest.Build(t, stage, thread, ask, ask)
}

// Review Focus 5: a replayed log rebuilds both counters and the question state.
func TestReplayQuestionEvents(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, ask, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"})
	replayed, err := Replay(events)
	if err != nil || !reflect.DeepEqual(replayed.Threads["t_1"], s.Threads["t_1"]) {
		t.Fatalf("replayed thread = %+v, err = %v", replayed.Threads["t_1"], err)
	}
	if ids := EventThreadIDs(s, events[len(events)-1]); len(ids) != 1 || ids[0] != "t_1" {
		t.Fatalf("answer thread ids = %v", ids)
	}
	_, res, err := Decide(replayed, ask)
	if err != nil || res.ID != "q_2" || !reflect.DeepEqual(res.OptionIDs, []string{"o_3", "o_4"}) {
		t.Fatalf("next ask after replay = %+v, %v", res, err)
	}
	bad := NewEvent(ActorUser, EvQuestionAnswered, QuestionAnswered{ThreadID: "t_1", QuestionID: "q_9", OptionID: "o_1"})
	bad.Seq = int64(len(events) + 1)
	if _, err := Replay(append(events, bad)); err == nil {
		t.Fatal("want an error for an answer to an unknown question")
	}
}

func TestMessageQuestionJSON(t *testing.T) {
	b, _ := json.Marshal(Message{Actor: ActorAI, Text: "Q?", Seq: 3, Question: &MessageQuestion{ID: "q_1",
		Options: []QuestionOption{{ID: "o_1", Title: "Yes"}, {ID: "o_2", Title: "No"}}, Answer: &QuestionAnswer{Other: "Maybe"}}})
	want := `{"actor":"ai","text":"Q?","seq":3,"question":{"id":"q_1","options":[{"id":"o_1","title":"Yes"},{"id":"o_2","title":"No"}],"answer":{"other":"Maybe"}}}`
	if string(b) != want {
		t.Fatalf("json = %s, want %s", b, want)
	}
}

func TestDecodeQuestionCommands(t *testing.T) {
	cmd, err := DecodeCommand(ActorAI, "ask", json.RawMessage(`{"threadId":"t_2","text":"Q?","options":["Yes","No"]}`))
	if err != nil || !reflect.DeepEqual(cmd, &Ask{ThreadID: "t_2", Text: "Q?", Options: []string{"Yes", "No"}}) {
		t.Fatalf("ask = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorAI, "question.withdraw", json.RawMessage(`{"questionId":"q_1"}`))
	if err != nil || *cmd.(*WithdrawQuestion) != (WithdrawQuestion{QuestionID: "q_1"}) {
		t.Fatalf("question.withdraw = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "question.answer", json.RawMessage(`{"questionId":"q_1","other":"x"}`))
	if err != nil || *cmd.(*AnswerQuestion) != (AnswerQuestion{QuestionID: "q_1", Other: "x"}) {
		t.Fatalf("question.answer = %#v, %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorUser, "ask", nil); err == nil {
		t.Fatal("the user must not be able to ask")
	}
	if _, err := DecodeCommand(ActorAI, "question.answer", nil); err == nil {
		t.Fatal("the agent must not be able to answer")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/domain/`
Expected: compile FAIL, `undefined: Ask`, `undefined: MessageQuestion`, `undefined: CodeQuestionNotFound`, etc.

- [ ] **Step 3: Add the events**

In `internal/domain/events.go`, add to the `const` block after `EvVariantsRejected = "variants.rejected"`:

```go
	EvQuestionAsked                 = "question.asked"
	EvQuestionAnswered              = "question.answered"
	EvQuestionWithdrawn             = "question.withdrawn"
```

and append:

```go
// QuestionAsked is an AI message with 2–4 answer buttons (question message spec). Its option ids
// come from the o_N counter shared with variants.
type QuestionAsked struct {
	ThreadID   string           `json:"threadId"`
	QuestionID string           `json:"questionId"`
	Text       string           `json:"text"`
	Options    []QuestionOption `json:"options"`
}

// QuestionAnswered carries exactly one of OptionID and Other. ThreadID is not in the spec's
// table; it is carried like variant.chosen's, so EventThreadIDs, `tdm wait` and `tdm log --stage`
// place the event without a lookup.
type QuestionAnswered struct {
	ThreadID   string `json:"threadId"`
	QuestionID string `json:"questionId"`
	OptionID   string `json:"optionId,omitempty"`
	Other      string `json:"other,omitempty"`
}

type QuestionWithdrawn struct {
	ThreadID   string `json:"threadId"`
	QuestionID string `json:"questionId"`
}
```

- [ ] **Step 4: Add the commands**

In `internal/domain/commands.go`, after `type CloseSession struct{}` add:

```go
// Ask posts a question with 2–4 answer buttons; the answer arrives through `tdm wait`.
type Ask struct {
	ThreadID string   `json:"threadId,omitempty"`
	Text     string   `json:"text"`
	Options  []string `json:"options"`
}

// WithdrawQuestion withdraws an open question the conversation has made moot.
type WithdrawQuestion struct {
	QuestionID string `json:"questionId"`
}
```

after `type EndSession struct { … }` add:

```go
// AnswerQuestion answers an open question with exactly one of an option or the user's own text.
type AnswerQuestion struct {
	QuestionID string `json:"questionId"`
	OptionID   string `json:"optionId,omitempty"`
	Other      string `json:"other,omitempty"`
}
```

after `func (*EndSession) isCommand()          {}` add:

```go
func (*Ask) isCommand()              {}
func (*WithdrawQuestion) isCommand() {}
func (*AnswerQuestion) isCommand()   {}
```

In `commandFactories`, add to `ActorAI`:

```go
		"ask":               func() Command { return &Ask{} },
		"question.withdraw": func() Command { return &WithdrawQuestion{} },
```

and to `ActorUser`:

```go
		"question.answer":       func() Command { return &AnswerQuestion{} },
```

(`gofmt -w internal/domain` realigns the maps.)

- [ ] **Step 5: Add the state**

In `internal/domain/state.go`, add a field to `State` after `optionCount  int`:

```go
	questionCount int
```

replace `type Message struct { … }` with:

```go
type Message struct {
	Actor    Actor            `json:"actor"`
	Text     string           `json:"text"`
	Seq      int64            `json:"seq"`
	Choice   *MessageChoice   `json:"choice,omitempty"`
	Question *MessageQuestion `json:"question,omitempty"`
}
```

and after `type MessageChoice struct { … }` add:

```go
// MessageQuestion makes an AI message a question with answer buttons (question message spec).
// Answer and Withdrawn are final: at most one of them is ever set.
type MessageQuestion struct {
	ID        string           `json:"id"`
	Options   []QuestionOption `json:"options"`
	Answer    *QuestionAnswer  `json:"answer,omitempty"`
	Withdrawn bool             `json:"withdrawn,omitempty"`
}

type QuestionOption struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// QuestionAnswer holds exactly one of OptionID and Other.
type QuestionAnswer struct {
	OptionID string `json:"optionId,omitempty"`
	Other    string `json:"other,omitempty"`
}

func (q *MessageQuestion) Option(id string) *QuestionOption {
	for i := range q.Options {
		if q.Options[i].ID == id {
			return &q.Options[i]
		}
	}
	return nil
}

// Question returns the thread and the message of question id, or nils when there is none.
func (s *State) Question(id string) (*Thread, *Message) {
	for _, t := range s.Threads {
		for i := range t.Messages {
			if q := t.Messages[i].Question; q != nil && q.ID == id {
				return t, &t.Messages[i]
			}
		}
	}
	return nil, nil
}

// AnswerMessage is the user message an answer adds to the thread, like "Chose:" for a variant.
func AnswerMessage(q *MessageQuestion, a QuestionAnswer) string {
	if a.Other != "" {
		return `Answered: "` + a.Other + `"`
	}
	if o := q.Option(a.OptionID); o != nil {
		return "Answered: " + o.Title
	}
	return "Answered: " + a.OptionID
}
```

- [ ] **Step 6: Add the error codes and the question lookup**

In `internal/domain/errors.go`, add to the `const` block:

```go
	CodeQuestionNotFound     = "question_not_found"
	CodeQuestionClosed       = "question_closed"
```

In `internal/domain/resolve.go`, append:

```go
// openQuestion returns question id with its thread and checks it is neither answered nor
// withdrawn: an answer is final (question message spec).
func (s *State) openQuestion(id string) (*Thread, *Message, error) {
	if err := required("questionId", id); err != nil {
		return nil, nil, err
	}
	t, m := s.Question(id)
	if m == nil {
		return nil, nil, errorf(CodeQuestionNotFound, "question ids are printed by `tdm ask`", "no question %s in session %s", id, s.Session.ID)
	}
	if m.Question.Answer != nil {
		return nil, nil, errorf(CodeQuestionClosed, "the answer is final; ask a new question if you need more", "question %s is already answered", id)
	}
	if m.Question.Withdrawn {
		return nil, nil, errorf(CodeQuestionClosed, "", "question %s was withdrawn", id)
	}
	return t, m, nil
}
```

- [ ] **Step 7: Decide the three commands**

In `internal/domain/decide.go`, in `Decide`'s switch, add before `case *SubmitReview:`:

```go
	case *Ask:
		return decideAsk(s, c)
	case *WithdrawQuestion:
		t, m, err := s.openQuestion(c.QuestionID)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorAI, EvQuestionWithdrawn, QuestionWithdrawn{ThreadID: t.ID, QuestionID: m.Question.ID}), m.Question.ID)
	case *AnswerQuestion:
		return decideAnswer(s, c)
```

and append to the file:

```go
func decideAsk(s *State, c *Ask) ([]Event, Result, error) {
	t, err := s.activeThread(c.ThreadID)
	if err != nil {
		return nil, Result{}, err
	}
	if err := required("question", c.Text); err != nil {
		return nil, Result{}, err
	}
	if n := len(c.Options); n < 2 || n > 4 {
		return nil, Result{}, errorf(CodeInvalidInput, "pass 2 to 4 --option flags", "a question needs 2 to 4 options, got %d", n)
	}
	id := FormatID("q", s.questionCount+1)
	res := Result{ID: id}
	opts := make([]QuestionOption, len(c.Options))
	for i, title := range c.Options {
		if err := required(fmt.Sprintf("option %d", i+1), title); err != nil {
			return nil, Result{}, err
		}
		opts[i] = QuestionOption{ID: FormatID("o", s.optionCount+i+1), Title: title}
		res.OptionIDs = append(res.OptionIDs, opts[i].ID)
	}
	e := NewEvent(ActorAI, EvQuestionAsked, QuestionAsked{ThreadID: t.ID, QuestionID: id, Text: c.Text, Options: opts})
	return []Event{e}, res, nil
}

func decideAnswer(s *State, c *AnswerQuestion) ([]Event, Result, error) {
	t, m, err := s.openQuestion(c.QuestionID)
	if err != nil {
		return nil, Result{}, err
	}
	if _, err := s.activeThread(t.ID); err != nil {
		return nil, Result{}, err
	}
	if (c.OptionID == "") == (c.Other == "") {
		return nil, Result{}, errorf(CodeInvalidInput, "", "answer with exactly one of optionId or other")
	}
	q := m.Question
	p := QuestionAnswered{ThreadID: t.ID, QuestionID: q.ID}
	if c.OptionID != "" {
		if q.Option(c.OptionID) == nil {
			return nil, Result{}, errorf(CodeOptionNotFound, "option ids are listed in question "+q.ID, "no option %s in question %s", c.OptionID, q.ID)
		}
		p.OptionID = c.OptionID
	} else {
		if err := required("other", c.Other); err != nil {
			return nil, Result{}, err
		}
		p.Other = strings.TrimSpace(c.Other)
	}
	return one(NewEvent(ActorUser, EvQuestionAnswered, p), q.ID)
}
```

- [ ] **Step 8: Fold the events**

In `internal/domain/reducer.go`, in `apply`'s switch, add before `case EvSessionEndRequested:`:

```go
	case EvQuestionAsked:
		p, err := decode[QuestionAsked](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Messages = append(t.Messages, Message{Actor: ActorAI, Text: p.Text, Seq: e.Seq,
			Question: &MessageQuestion{ID: p.QuestionID, Options: p.Options}})
		t.LastAISeq = e.Seq
		s.questionCount++
		s.optionCount += len(p.Options)
	case EvQuestionAnswered:
		p, err := decode[QuestionAnswered](e)
		if err != nil {
			return err
		}
		t, m := s.Question(p.QuestionID)
		if m == nil {
			return unknown("question", p.QuestionID, e)
		}
		q := m.Question
		q.Answer = &QuestionAnswer{OptionID: p.OptionID, Other: p.Other}
		t.userMessage(AnswerMessage(q, *q.Answer), e.Seq)
	case EvQuestionWithdrawn:
		p, err := decode[QuestionWithdrawn](e)
		if err != nil {
			return err
		}
		t, m := s.Question(p.QuestionID)
		if m == nil {
			return unknown("question", p.QuestionID, e)
		}
		m.Question.Withdrawn = true
		t.LastAISeq = e.Seq
```

(`q` is a pointer held by the message, so appending the user message afterwards cannot lose the answer.)

- [ ] **Step 9: Run the domain tests**

Run: `gofmt -l internal; go test ./internal/domain/`
Expected: `gofmt` lists no files. PASS, including the existing `TestDecideHappyPath` (variants still get `o_4` for the second block) and `TestMessageChoiceJSON` (no `question` key without a question).

- [ ] **Step 10: Run everything Go**

Run: `go test ./...`
Expected: PASS. `TestSnapshotContractFixture` is unchanged: no fixture command asks a question yet.

- [ ] **Step 11: Commit**

```bash
git add internal/domain
git commit -m "feat(domain): question.asked, question.answered and question.withdrawn

q_N has its own counter; option ids share the o_N counter with variants.
An answer appends the user message Answered: <title> / Answered: \"<other>\"
and never resolves the thread."
```

---

### Task 4: Render: `question answered` in `tdm wait`

**Files:**
- Modify: `internal/render/wait.go` (`eventSections`)
- Test: `internal/render/wait_test.go`

**Interfaces:**
- Consumes: `domain.EvQuestionAnswered`, `domain.QuestionAnswered`, `State.Question`, `MessageQuestion.Option`, `threadSection`, `Quote`.
- Produces: the `tdm wait` text that Tasks 5, 9 and 10 assert on, verbatim:
  - `## t_N "<thread>" — question answered\n\nAnswered q_N "<question>": o_N "<title>".\n`;
  - `…\n\nAnswered q_N "<question>" with their own answer:\n> <text>\n`.

- [ ] **Step 1: Write the failing test**

Append to `internal/render/wait_test.go`:

```go
// Question message spec: both answer forms, in the order the user gave them. The variants block
// first shows that question options continue the shared o_N counter.
func TestWaitQuestionAnswered(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "Storage"},
		&domain.AddThread{Title: "Storage format"},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindVariants},
			Variants: &domain.Variants{Options: []domain.VariantOption{{Title: "JSONL"}, {Title: "SQLite"}}}},
		&domain.Ask{Text: "Must old logs stay readable?", Options: []string{"Yes", "No"}},
		&domain.AnswerQuestion{QuestionID: "q_1", OptionID: "o_4"},
		&domain.Ask{Text: "Which field holds the version?", Options: []string{"v", "version"}},
		&domain.AnswerQuestion{QuestionID: "q_2", Other: "  schemaVersion\n"},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	want := `# Stage st_1 "Storage" — 0/1 threads resolved

## t_1 "Storage format" — question answered

Answered q_1 "Must old logs stay readable?": o_4 "No".

## t_1 "Storage format" — question answered

Answered q_2 "Which field holds the version?" with their own answer:
> schemaVersion
`
	if got != want {
		t.Fatalf("Wait mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `go test ./internal/render/ -run TestWaitQuestionAnswered`
Expected: FAIL. The output is only the stage header, because `eventSections` ignores `question.answered`.

- [ ] **Step 3: Render the answer**

In `internal/render/wait.go`, in `eventSections`, add before `case domain.EvConclusionAccepted:`:

```go
	case domain.EvQuestionAnswered:
		var p domain.QuestionAnswered
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		_, m := s.Question(p.QuestionID)
		if m == nil {
			return nil, fmt.Errorf("answer to unknown question %s", p.QuestionID)
		}
		head := fmt.Sprintf("Answered %s %q", p.QuestionID, m.Text)
		var item string
		if p.Other != "" {
			item = head + " with their own answer:\n" + Quote(p.Other)
		} else {
			o := m.Question.Option(p.OptionID)
			if o == nil {
				return nil, fmt.Errorf("question %s has no option %s", p.QuestionID, p.OptionID)
			}
			item = fmt.Sprintf("%s: %s %q.\n", head, o.ID, o.Title)
		}
		return []section{threadSection(s, p.ThreadID, "question answered", item)}, nil
```

- [ ] **Step 4: Run the render tests**

Run: `go test ./internal/render/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/render
git commit -m "feat(render): show question answers in tdm wait"
```

---

### Task 5: CLI: `tdm ask` and `tdm ask --withdraw`

**Files:**
- Modify: `internal/cli/content.go` (`askCmd`)
- Modify: `internal/cli/app.go` (`commands()` registers `askCmd`)
- Modify: `internal/guide/guide.md` (the two command table rows; `TestGuideCoversEveryCommand` requires every command in the guide)
- Test: `internal/cli/content_test.go`

**Interfaces:**
- Consumes: `domain.Ask`, `domain.WithdrawQuestion`, `a.call`, `a.text`, `a.emit`, `usageError`.
- Produces: the `tdm ask` CLI. Stdout is `q_N o_N o_N…\n` for an ask and `q_N\n` for a withdraw. `--json` prints the `Result` (`{"id","optionIds"}`).

- [ ] **Step 1: Write the failing CLI tests**

Append to `internal/cli/content_test.go`:

```go
// Question message spec: tdm ask prints q_N and the option ids (shared o_N counter), --option is
// repeatable and never split on commas, --withdraw withdraws, and the answer arrives via tdm wait.
func TestAskCommand(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "Storage")
	must(t, "", "thread", "add", "Storage format")
	must(t, `{"options":[{"title":"JSONL"},{"title":"SQLite"}]}`, "block", "add", "variants", "--input", "-")
	if out := must(t, "", "ask", "Must old logs stay readable?", "--option", "Yes, always", "--option", "No"); out != "q_1 o_3 o_4\n" {
		t.Fatalf("ask = %q", out)
	}
	var st struct {
		Threads map[string]struct {
			Messages []struct {
				Text     string
				Question struct {
					ID      string
					Options []struct{ ID, Title string }
				}
			}
		}
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &st); err != nil {
		t.Fatalf("unmarshal session show: %v", err)
	}
	m := st.Threads["t_1"].Messages[0]
	if m.Text != "Must old logs stay readable?" || m.Question.ID != "q_1" || len(m.Question.Options) != 2 || m.Question.Options[0].Title != "Yes, always" {
		t.Fatalf("question message = %+v", m)
	}

	if out := must(t, "", "ask", "--withdraw", "q_1"); out != "q_1\n" {
		t.Fatalf("withdraw = %q", out)
	}
	if out := must(t, "", "ask", "Keep JSONL?", "--option", "Yes", "--option", "No", "--thread", "t_1"); out != "q_2 o_5 o_6\n" {
		t.Fatalf("second ask = %q", out)
	}
	userAction(t, home, sid, "question.answer", `{"questionId":"q_2","optionId":"o_6"}`)
	if out := must(t, "", "wait", "--timeout", "5s"); !strings.Contains(out, "## t_1 \"Storage format\" — question answered\n\nAnswered q_2 \"Keep JSONL?\": o_6 \"No\".\n") {
		t.Fatalf("wait = %q", out)
	}
}

func TestAskErrors(t *testing.T) {
	startDaemon(t)
	newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	must(t, "", "ask", "Q?", "--option", "A", "--option", "B")
	must(t, "", "ask", "--withdraw", "q_1")
	cases := []struct {
		args []string
		exit int
		want []string
	}{
		{[]string{"ask", "Q?", "--option", "A"}, 1, []string{"error: invalid_input:", "hint: pass 2 to 4 --option flags"}},
		{[]string{"ask", "--option", "A", "--option", "B"}, 2, []string{"text is required"}},
		{[]string{"ask", "--withdraw", "q_1", "--option", "A"}, 2, []string{"--withdraw takes only the question id"}},
		{[]string{"ask", "Q?", "--withdraw", "q_1"}, 2, []string{"--withdraw takes only the question id"}},
		{[]string{"ask", "--withdraw", "q_9"}, 1, []string{"error: question_not_found:", "hint: question ids are printed by `tdm ask`"}},
		{[]string{"ask", "--withdraw", "q_1"}, 1, []string{"error: question_closed:", "question q_1 was withdrawn"}},
	}
	for _, tc := range cases {
		_, errOut, code := run(t, "", tc.args...)
		if code != tc.exit {
			t.Fatalf("%v: exit %d, want %d (%q)", tc.args, code, tc.exit, errOut)
		}
		for _, w := range tc.want {
			if !strings.Contains(errOut, w) {
				t.Fatalf("%v: stderr %q lacks %q", tc.args, errOut, w)
			}
		}
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/cli/ -run 'TestAsk'`
Expected: FAIL, `tdm ask …: exit 2` with `unknown command "ask"`.

- [ ] **Step 3: Add the command**

In `internal/cli/content.go`, append:

```go
func (a *app) askCmd() *cobra.Command {
	var thread, withdraw string
	var options []string
	cmd := &cobra.Command{
		Use: "ask [question]", Short: "Ask the user a quick question with 2–4 answer buttons (or --withdraw q_N)", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if withdraw != "" {
				if len(args) > 0 || len(options) > 0 || thread != "" {
					return &usageError{"--withdraw takes only the question id"}
				}
				res, err := a.call(cmd.Context(), "question.withdraw", domain.WithdrawQuestion{QuestionID: withdraw})
				if err != nil {
					return err
				}
				return a.emit(res.ID, res)
			}
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "ask", domain.Ask{ThreadID: thread, Text: text, Options: options})
			if err != nil {
				return err
			}
			return a.emit(strings.Join(append([]string{res.ID}, res.OptionIDs...), " "), res)
		},
	}
	// StringArray, not StringSlice: an answer may contain commas.
	cmd.Flags().StringArrayVar(&options, "option", nil, "an answer button; repeat 2 to 4 times")
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	cmd.Flags().StringVar(&withdraw, "withdraw", "", "withdraw the open question q_N")
	return cmd
}
```

In `internal/cli/app.go`, replace

```go
		a.sayCmd(), a.concludeCmd(),
```

with

```go
		a.sayCmd(), a.askCmd(), a.concludeCmd(),
```

- [ ] **Step 4: Add the command table rows to the guide**

In `internal/guide/guide.md`, replace

```markdown
| `tdm say ["<text>"] [--thread t_N]` | chat message in a thread |
```

with

```markdown
| `tdm say ["<text>"] [--thread t_N]` | chat message in a thread |
| `tdm ask "<question>" --option A --option B [--option C --option D] [--thread t_N]` | quick question with 2–4 answer buttons → `q_N o_N o_N …` |
| `tdm ask --withdraw q_N` | withdraw an open question the conversation made moot |
```

- [ ] **Step 5: Run the CLI tests**

Run: `go test ./internal/cli/`
Expected: PASS, including `TestGuideCoversEveryCommand` (the guide mentions `tdm ask`).

- [ ] **Step 6: Commit**

```bash
git add internal/cli internal/guide/guide.md
git commit -m "feat(cli): tdm ask and tdm ask --withdraw"
```

---

### Task 6: Daemon: contract fixture and question actions

**Files:**
- Modify: `internal/daemon/contract_test.go` (the fixture asks and withdraws a question in `t_3`)
- Regenerate: `web/src/test/fixtures/snapshot.json`
- Test: `internal/daemon/server_test.go` (`TestQuestionActions`)

**Interfaces:**
- Consumes: Task 3's commands. No daemon code changes: `execute` already decodes any registered command and batches a user action's draft first.
- Produces: fixture state that Tasks 7–8 build on. `t_3` "Docs" holds one AI message, seq 18, text `Should the docs cover the blob layout?`, with `question: {id: "q_1", options: [{id: "o_3", title: "Yes"}, {id: "o_4", title: "No"}], withdrawn: true}`. `t_3.lastAiSeq` is 19, and `state.lastSeq`/`lastAiSeq` are 19. The question is withdrawn so the fixture shows no nav dot and no buttons, which keeps every existing web test's expectations. Tests reopen it with `withQuestion` (Task 7).

- [ ] **Step 1: Write the failing server test**

Append to `internal/daemon/server_test.go`:

```go
// Question message spec: ask/withdraw are agent commands, question.answer a user action. A draft
// sent with an answer lands first as its own review.submitted, in one atomic batch (Review Focus 3).
func TestQuestionActions(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	e.command(sid, "block.add", `{"type":"code","lang":"go","text":"a\nb\n"}`)
	if code, out := e.command(sid, "ask", `{"text":"Keep it?","options":["Yes","No"]}`); code != 200 || out != "{\"id\":\"q_1\",\"optionIds\":[\"o_1\",\"o_2\"]}\n" {
		t.Fatalf("ask: %d %q", code, out)
	}
	action := func(body string) (int, string) {
		return e.do("POST", "/api/sessions/"+sid+"/actions", body, "Origin", e.hs.URL)
	}
	draft := `"draft":{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":2,"end":2},"text":"hm"}]}]}`
	if code, out := action(`{"type":"question.answer","data":{"questionId":"q_1","optionId":"o_2"},` + draft + `}`); code != 200 {
		t.Fatalf("answer: %d %s", code, out)
	}
	_, events := e.do("GET", "/api/sessions/"+sid+"/events?since=5", "")
	lines := strings.Split(strings.TrimSpace(events), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"review.submitted"`) || !strings.Contains(lines[1], `"question.answered"`) {
		t.Fatalf("events after 5:\n%s", events)
	}
	// A rejected answer saves nothing, not even its draft.
	code, out := action(`{"type":"question.answer","data":{"questionId":"q_1","optionId":"o_1"},` + draft + `}`)
	if code != 400 || !strings.Contains(out, `"code":"question_closed"`) {
		t.Fatalf("second answer: %d %s", code, out)
	}
	if _, after := e.do("GET", "/api/sessions/"+sid+"/events?since=7", ""); strings.TrimSpace(after) != "" {
		t.Fatalf("a rejected answer wrote events:\n%s", after)
	}
	if code, out := e.command(sid, "question.withdraw", `{"questionId":"q_9"}`); code != 404 || !strings.Contains(out, `"code":"question_not_found"`) {
		t.Fatalf("withdraw unknown: %d %s", code, out)
	}
	if code, _ := e.command(sid, "question.answer", `{"questionId":"q_1","optionId":"o_1"}`); code != 400 {
		t.Fatalf("agent sending a user command: %d", code)
	}
}
```

- [ ] **Step 2: Extend the contract fixture**

In `internal/daemon/contract_test.go`, after

```go
	run(&domain.Conclude{ThreadID: "t_2", Text: "Use a lazy delegate for the cache."})
```

add:

```go
	run(&domain.Ask{ThreadID: "t_3", Text: "Should the docs cover the blob layout?", Options: []string{"Yes", "No"}})
	run(&domain.WithdrawQuestion{QuestionID: "q_1"})
```

- [ ] **Step 3: Run the daemon tests to see the fixture differ**

Run: `go test ./internal/daemon/`
Expected: `TestQuestionActions` PASS. `TestSnapshotContractFixture` FAILs with `snapshot JSON differs from ../../web/src/test/fixtures/snapshot.json`.

- [ ] **Step 4: Regenerate the fixture**

Run: `go test ./internal/daemon -run TestSnapshotContractFixture -update && git diff --stat web/src/test/fixtures/snapshot.json`
Expected: only `snapshot.json` changes. In `git diff`:
- `t_3.messages` goes from `null` to one message with `"question": {"id": "q_1", "options": [{"id": "o_3", "title": "Yes"}, {"id": "o_4", "title": "No"}], "withdrawn": true}`;
- `t_3.lastAiSeq` is `19`;
- `lastSeq` and `lastAiSeq` are `19`.

- [ ] **Step 5: Run the Go and web suites**

Run: `go test ./... && (cd web && npm test && npm run typecheck)`
Expected: all PASS. The web UI does not know `question` yet, so `t_3` just shows the question text as a plain AI message. No existing web test counts `t_3`'s messages.

- [ ] **Step 6: Commit**

```bash
git add internal/daemon/contract_test.go internal/daemon/server_test.go web/src/test/fixtures/snapshot.json
git commit -m "test(daemon): question actions and a withdrawn question in the contract fixture"
```

---

### Task 7: Web: the question message (buttons, Other…, keys, answered, withdrawn, not answered)

**Files:**
- Modify: `web/src/api/types.ts` (`QuestionOption`, `QuestionAnswer`, `MessageQuestion`, `Message.question`, the `question.answer` action, `openQuestion`)
- Modify: `web/src/session/shortcuts.ts` (export `isTyping`)
- Create: `web/src/thread/QuestionMessage.tsx` (`QuestionMessage`, `answerLabel`)
- Modify: `web/src/thread/ThreadView.tsx` (render question messages; keys go to the latest open question)
- Modify: `web/src/styles/app.css` (the question bubble)
- Modify: `web/src/test/session.tsx` (`withQuestion`)
- Test: `web/src/api/types.test.ts`, `web/src/thread/QuestionMessage.test.tsx` (new)

**Interfaces:**
- Consumes: the Task 6 fixture (`t_3`, `q_1`, `o_3` "Yes", `o_4` "No", withdrawn), `SessionCtx.run` (sends the draft along and resolves `true` on success), `Prose`, and `MessageView` for the plain `Answered: …` user message.
- Produces:
  - `interface MessageQuestion { id: string; options: QuestionOption[]; answer?: QuestionAnswer; withdrawn?: boolean }`;
  - `openQuestion(t: Thread): MessageQuestion | undefined` in `web/src/api/types.ts` (Task 8's nav dot uses it);
  - `withQuestion(state: State, over?: Partial<MessageQuestion>, thread?: Partial<Thread>): State` in `web/src/test/session.tsx` (Task 8 tests use it);
  - `isTyping(target: EventTarget | null): boolean` exported from `web/src/session/shortcuts.ts`;
  - the DOM `section[aria-label="Question"][data-question="q_N"]` (Task 8 scrolls to it; Task 10 locates it).

- [ ] **Step 1: Write the failing tests**

In `web/src/api/types.test.ts`, replace

```ts
import { awaitingAI, normalizeSnapshot } from './types'
```

with

```ts
import { awaitingAI, normalizeSnapshot, openQuestion } from './types'
```

and append:

```ts
describe('question messages (question message spec)', () => {
  it('reads the question from the contract fixture', () => {
    const t3 = normalizeSnapshot(fixture).state.threads.t_3
    expect(t3.messages[0]).toEqual({
      actor: 'ai',
      text: 'Should the docs cover the blob layout?',
      seq: 18,
      question: { id: 'q_1', options: [{ id: 'o_3', title: 'Yes' }, { id: 'o_4', title: 'No' }], withdrawn: true },
    })
  })

  it('finds the latest question that is neither answered nor withdrawn', () => {
    const t3 = normalizeSnapshot(fixture).state.threads.t_3
    expect(openQuestion(t3)).toBeUndefined() // the fixture's q_1 is withdrawn
    const asked = t3.messages[0]
    const open = { id: 'q_1', options: asked.question!.options }
    const second = { actor: 'ai' as const, text: 'Second?', seq: 20, question: { id: 'q_2', options: open.options } }
    expect(openQuestion({ ...t3, messages: [{ ...asked, question: open }] })?.id).toBe('q_1')
    expect(openQuestion({ ...t3, messages: [{ ...asked, question: open }, second] })?.id).toBe('q_2')
    expect(openQuestion({ ...t3, messages: [{ ...asked, question: { ...open, answer: { optionId: 'o_3' } } }] })).toBeUndefined()
  })
})
```

In `web/src/test/session.tsx`, replace

```tsx
import { normalizeSnapshot, type Snapshot } from '../api/types'
```

with

```tsx
import { normalizeSnapshot, type MessageQuestion, type Snapshot, type State, type Thread } from '../api/types'
```

and append:

```tsx
// withQuestion returns a copy of state whose t_3 question q_1 ("Should the docs cover the blob
// layout?", o_3 Yes / o_4 No; withdrawn in the fixture) is open again, then applies `over` (an
// answer, withdrawn) to the question and `thread` (status, extra messages) to t_3.
export function withQuestion(state: State, over: Partial<MessageQuestion> = {}, thread: Partial<Thread> = {}): State {
  const t3 = state.threads.t_3
  const [asked, ...rest] = t3.messages
  const question: MessageQuestion = { id: asked.question!.id, options: asked.question!.options, ...over }
  return { ...state, threads: { ...state.threads, t_3: { ...t3, messages: [{ ...asked, question }, ...rest], ...thread } } }
}
```

Create `web/src/thread/QuestionMessage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message, State } from '../api/types'
import { makeCtx, renderStateful, withQuestion } from '../test/session'
import { ThreadView } from './ThreadView'

const openState = (): State => withQuestion(makeCtx().state)
const question = () => screen.getByRole('region', { name: 'Question' })

describe('QuestionMessage (question message spec)', () => {
  it('shows an open question with its buttons and Other…, and answers with a click', async () => {
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    const q = question()
    expect(q).toHaveAttribute('data-question', 'q_1')
    expect(q).toHaveTextContent('Should the docs cover the blob layout?')
    expect(within(q).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yes', 'No', 'Other…'])
    await userEvent.click(within(q).getByRole('button', { name: 'No' }))
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', optionId: 'o_4' } })
  })

  it('swaps the buttons for a one-line input on Other…; Enter sends the trimmed text, Esc cancels', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    const input = within(question()).getByRole('textbox', { name: 'Your answer' })
    expect(input).toHaveFocus()
    expect(within(question()).queryByRole('button', { name: 'Yes' })).toBeNull()
    // Review Focus 4: blank text cannot be sent.
    expect(within(question()).getByRole('button', { name: 'Send answer' })).toBeDisabled()
    await user.type(input, '   {Enter}')
    expect(ctx.run).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(within(question()).queryByRole('textbox', { name: 'Your answer' })).toBeNull()
    expect(within(question()).getByRole('button', { name: 'Yes' })).toBeInTheDocument()

    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    await user.type(within(question()).getByRole('textbox', { name: 'Your answer' }), '  Only the API part {Enter}')
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', other: 'Only the API part' } })
  })

  it('sends with the Send answer button too', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    await user.type(within(question()).getByRole('textbox', { name: 'Your answer' }), 'Later')
    await user.click(within(question()).getByRole('button', { name: 'Send answer' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', other: 'Later' } })
  })

  // Review Focus 1.
  it('sends one answer while one is in flight', async () => {
    const user = userEvent.setup()
    const run = vi.fn(() => new Promise<boolean>(() => {}))
    renderStateful(<ThreadView threadId="t_3" />, { state: openState(), run })
    await user.click(within(question()).getByRole('button', { name: 'Yes' }))
    expect(within(question()).getByRole('button', { name: 'No' })).toBeDisabled()
    await user.keyboard('2')
    expect(run).toHaveBeenCalledTimes(1)
  })

  // Review Focus 2.
  it('picks a button with keys 1–4 when focus is not in a text field', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.keyboard('3') // only two options
    expect(ctx.run).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '1')
    expect(ctx.run).not.toHaveBeenCalled()
    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('2')
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', optionId: 'o_4' } })
  })

  it('gives the keys to the latest open question only', async () => {
    const user = userEvent.setup()
    const base = openState()
    const second: Message = { actor: 'ai', text: 'Second?', seq: 20, question: { id: 'q_2', options: [{ id: 'o_5', title: 'A' }, { id: 'o_6', title: 'B' }] } }
    const state = withQuestion(base, {}, { messages: [...base.threads.t_3.messages, second], lastAiSeq: 20 })
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state })
    expect(screen.getAllByRole('region', { name: 'Question' })).toHaveLength(2)
    await user.keyboard('1')
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_2', optionId: 'o_5' } })
  })

  it('shows the answer as a muted line, followed by the Answered user message', () => {
    const base = withQuestion(makeCtx().state, { answer: { optionId: 'o_4' } })
    const t3 = base.threads.t_3
    const state: State = {
      ...base,
      threads: { ...base.threads, t_3: { ...t3, messages: [...t3.messages, { actor: 'user', text: 'Answered: No', seq: 20 }], lastUserSeq: 20 } },
    }
    const { container } = renderStateful(<ThreadView threadId="t_3" />, { state })
    expect(within(question()).queryAllByRole('button')).toHaveLength(0)
    expect(question()).toHaveTextContent('Answer: No')
    expect(container.querySelector('.msg-user')).toHaveTextContent('Answered: No')
  })

  it('quotes an Other answer', () => {
    renderStateful(<ThreadView threadId="t_3" />, { state: withQuestion(makeCtx().state, { answer: { other: 'Only the API part' } }) })
    expect(question()).toHaveTextContent('Answer: "Only the API part"')
  })

  it('shows Withdrawn and no buttons for a withdrawn question', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />) // the fixture's q_1 is withdrawn
    expect(question()).toHaveTextContent('Withdrawn')
    expect(within(question()).queryAllByRole('button')).toHaveLength(0)
    await user.keyboard('1')
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it('shows Not answered and takes no keys on a resolved thread or in a read-only session', async () => {
    const user = userEvent.setup()
    for (const over of [
      { state: withQuestion(makeCtx().state, {}, { status: 'resolved', conclusion: 'Done.' }) },
      { state: openState(), readOnly: true },
    ]) {
      const { ctx, unmount } = renderStateful(<ThreadView threadId="t_3" />, over)
      expect(question()).toHaveTextContent('Not answered')
      expect(within(question()).queryAllByRole('button')).toHaveLength(0)
      await user.keyboard('1')
      expect(ctx.run).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('keeps the question open while the user sends a normal message', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Why do you ask?{Meta>}{Enter}{/Meta}')
    expect(ctx.sendReview).toHaveBeenCalledWith({ threadId: 't_3', message: 'Why do you ask?' })
    expect(within(question()).getByRole('button', { name: 'Yes' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/api/types.test.ts src/thread/QuestionMessage.test.tsx`
Expected: FAIL. `openQuestion` and `withQuestion` do not exist, and there is no region named `Question`.

- [ ] **Step 3: Add the types**

In `web/src/api/types.ts`, replace

```ts
export interface Message {
  actor: Actor
  text: string
  seq: number
  /** Set on a user message sent with a variant choice (its text may be empty). */
  choice?: MessageChoice
}
```

with

```ts
export interface QuestionOption {
  id: string
  title: string
}

/** Exactly one of the two is set. */
export interface QuestionAnswer {
  optionId?: string
  other?: string
}

/** Mirrors domain.MessageQuestion: an AI message with answer buttons (question message spec). */
export interface MessageQuestion {
  id: string
  options: QuestionOption[]
  answer?: QuestionAnswer
  withdrawn?: boolean
}

export interface Message {
  actor: Actor
  text: string
  seq: number
  /** Set on a user message sent with a variant choice (its text may be empty). */
  choice?: MessageChoice
  /** Set on an AI message that asks a question; its text is the question. */
  question?: MessageQuestion
}
```

add to `Action`, after the `variants.reject` member:

```ts
  | { type: 'question.answer'; data: { questionId: string; optionId?: string; other?: string } }
```

and append after `awaitingAI`:

```ts
// openQuestion is the thread's latest question that is neither answered nor withdrawn.
export function openQuestion(t: Thread): MessageQuestion | undefined {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const q = t.messages[i].question
    if (q && !q.answer && !q.withdrawn) return q
  }
  return undefined
}
```

In `web/src/session/shortcuts.ts`, replace

```ts
function isTyping(target: EventTarget | null): boolean {
```

with

```ts
export function isTyping(target: EventTarget | null): boolean {
```

- [ ] **Step 4: Write the component**

Create `web/src/thread/QuestionMessage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Message, MessageQuestion, Thread } from '../api/types'
import { Prose } from '../markdown/Prose'
import { useSessionCtx } from '../session/context'
import { isTyping } from '../session/shortcuts'

type AnswerData = { optionId: string } | { other: string }

// answerLabel is how an answer reads in the question bubble: the option title, or the user's own
// text in quotes. The user message the answer adds reads the same after "Answered: "
// (domain.AnswerMessage).
export function answerLabel(q: MessageQuestion): string | undefined {
  const a = q.answer
  if (!a) return undefined
  if (a.other !== undefined) return `"${a.other}"`
  return q.options.find((o) => o.id === a.optionId)?.title ?? a.optionId
}

// QuestionMessage is an AI message with answer buttons (question message spec). A button answers
// at once; Other… swaps the row for a one-line input (Enter sends, Esc cancels). withKeys lets 1–4
// pick a button while focus is not in a text field; ThreadView gives it to the thread's latest
// open question only. The answer is final, so an answered, withdrawn, resolved or read-only
// question shows a status line instead of buttons.
export function QuestionMessage({ message, thread, withKeys = false }: { message: Message; thread: Thread; withKeys?: boolean }) {
  const { run, readOnly } = useSessionCtx()
  const q = message.question!
  const [other, setOther] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Review Focus 1: a ref, not the state, guards against a second answer: two key presses in one
  // tick both see pending === false.
  const inFlight = useRef(false)
  const open = !q.answer && !q.withdrawn
  const interactive = open && !readOnly && thread.status !== 'resolved'

  const answer = async (data: AnswerData) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    const ok = await run({ type: 'question.answer', data: { questionId: q.id, ...data } })
    inFlight.current = false
    setPending(false)
    if (ok) setOther(null)
  }
  const answerRef = useRef(answer)
  answerRef.current = answer

  const keys = interactive && withKeys && other === null
  const options = q.options
  useEffect(() => {
    if (!keys) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !/^[1-4]$/.test(e.key)) return
      const option = options[Number(e.key) - 1]
      if (!option) return
      e.preventDefault()
      void answerRef.current({ optionId: option.id })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [keys, options])

  const sendOther = () => {
    const text = (other ?? '').trim()
    if (text) void answer({ other: text })
  }

  return (
    <section className="msg-question" data-question={q.id} aria-label="Question">
      <Prose className="msg-ai" text={message.text} />
      {interactive &&
        (other === null ? (
          <div className="question-options">
            {q.options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className="btn"
                disabled={pending}
                aria-keyshortcuts={withKeys ? String(i + 1) : undefined}
                onClick={() => void answer({ optionId: o.id })}
              >
                {o.title}
              </button>
            ))}
            <button type="button" className="btn link" disabled={pending} onClick={() => setOther('')}>
              Other…
            </button>
          </div>
        ) : (
          <div className="question-other">
            <input
              type="text"
              aria-label="Your answer"
              autoFocus
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  sendOther()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOther(null)
                }
              }}
            />
            <button type="button" className="btn primary small" disabled={pending || !other.trim()} onClick={sendOther}>
              Send answer
            </button>
          </div>
        ))}
      {q.answer && <p className="question-status">Answer: {answerLabel(q)}</p>}
      {q.withdrawn && <p className="question-status">Withdrawn</p>}
      {open && !interactive && <p className="question-status">Not answered</p>}
    </section>
  )
}
```

- [ ] **Step 5: Render question messages in the thread**

In `web/src/thread/ThreadView.tsx`, replace

```tsx
import type { State } from '../api/types'
```

with

```tsx
import { openQuestion, type State } from '../api/types'
```

add the import

```tsx
import { QuestionMessage } from './QuestionMessage'
```

After `const resolved = thread.status === 'resolved'` add:

```tsx
  // Keys 1–4 answer the latest open question only (question message spec).
  const keyQuestion = openQuestion(thread)?.id
```

and replace

```tsx
        ) : (
          <MessageView
            key={`m${item.seq}`}
```

with

```tsx
        ) : item.message.question ? (
          <QuestionMessage
            key={`m${item.seq}`}
            message={item.message}
            thread={thread}
            withKeys={item.message.question.id === keyQuestion}
          />
        ) : (
          <MessageView
            key={`m${item.seq}`}
```

- [ ] **Step 6: Style the bubble**

In `web/src/styles/app.css`, after the `.msg-comments { … }` rule add:

```css
/* Question message spec: an AI bubble with answer buttons, or a muted status line once closed. */
.msg-question {
  align-self: flex-start;
  max-width: var(--prose-width);
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 12px 12px 12px 2px;
}
.question-options, .question-other { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; font-family: var(--font-ui); }
.question-other input {
  flex: 1;
  min-width: 12rem;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: 0.84375rem var(--font-ui);
}
.question-status { margin: 8px 0 0; color: var(--muted); font: 0.78125rem var(--font-ui); }
```

- [ ] **Step 7: Run the tests**

Run: `cd web && npx vitest run src/api/types.test.ts src/thread`
Expected: PASS, including the existing ThreadView tests: `t_3`'s withdrawn question renders as a bubble with `Withdrawn`.

- [ ] **Step 8: Run all web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. `scale.test.ts` accepts the rem font sizes.

- [ ] **Step 9: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src
git commit -m "feat(web): question message with answer buttons, Other… and keys 1–4

Answered, withdrawn and not-answered questions show a status line instead
of buttons; the answer's user message follows as a plain message."
```

---

### Task 8: Web: nav dot for an open question; `q_N` chips; question anchors

**Files:**
- Modify: `web/src/shell/Nav.tsx` (the dot)
- Modify: `web/src/styles/app.css` (the dot size)
- Modify: `web/src/refs/ids.ts` (`q_N` token; question and question-option titles)
- Modify: `web/src/session/nav.ts` (`anchorOf` for `q_N` and question options)
- Test: `web/src/shell/Shell.test.tsx`, `web/src/refs/ids.test.ts`, `web/src/session/nav.test.ts`, `web/src/shell/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `openQuestion`, `withQuestion` (Task 7), `idTitles`, `anchorOf`, `useCurrentItem`'s scroll request (Task 1), and `data-question` (Task 7).
- Produces:
  - the nav dot `<span class="badge is-dot" aria-label="question awaiting you">` (Task 10 asserts on it);
  - the chip `q_N` → the first line of the question;
  - `anchorOf(state, 'q_N' | question option id)` → `{ threadId, selector: '[data-question="q_N"]' }`.

- [ ] **Step 1: Write the failing tests**

In `web/src/shell/Shell.test.tsx`, replace

```tsx
import { act, render, screen } from '@testing-library/react'
```

with

```tsx
import { act, render, screen, within } from '@testing-library/react'
```

and

```tsx
import { makeCtx, renderWithCtx } from '../test/session'
```

with

```tsx
import { makeCtx, renderWithCtx, withQuestion } from '../test/session'
```

and add inside `describe('Nav', …)`, after the first test:

```tsx
  // Question message spec: an open question gets the "awaiting you" dot; nothing else does.
  it('marks a thread with an open question as awaiting you', () => {
    const ctx = makeCtx()
    renderWithCtx(<Nav current="t_1" onSelect={vi.fn()} />, { ...ctx, state: withQuestion(ctx.state) })
    const dot = within(screen.getByRole('button', { name: /Docs/ })).getByLabelText('question awaiting you')
    expect(dot).toHaveClass('badge', 'is-dot')
    expect(screen.getAllByLabelText('question awaiting you')).toHaveLength(1)
  })

  it('shows no question dot for a withdrawn or answered question, or on a resolved thread', () => {
    const base = makeCtx().state
    for (const state of [
      base, // the fixture's q_1 is withdrawn
      withQuestion(base, { answer: { optionId: 'o_3' } }),
      withQuestion(base, {}, { status: 'resolved', conclusion: 'Done.' }),
    ]) {
      const { unmount } = renderWithCtx(<Nav current="t_1" onSelect={vi.fn()} />, makeCtx({ state }))
      expect(screen.queryByLabelText('question awaiting you')).toBeNull()
      unmount()
    }
  })
```

In `web/src/refs/ids.test.ts`, replace

```ts
import { fixtureSnapshot } from '../test/session'
```

with

```ts
import { fixtureSnapshot, withQuestion } from '../test/session'
```

add to the `titles` map `q_1: 'Keep old logs?'`, and add inside `describe('splitIds (demo2 follow-up 4)', …)`:

```ts
  it('turns known question ids into refs (question message spec)', () => {
    expect(splitIds('See q_1.', titleOf)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'ref', id: 'q_1', title: 'Keep old logs?' },
      { kind: 'text', text: '.' },
    ])
    for (const text of ['q_1x', 'faq_1', 'q_9']) expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
  })
```

and inside `describe('titlesOf', …)` add:

```ts
  it('titles questions by their first line and their options by title', () => {
    const state = fixtureSnapshot().state
    const f = titlesOf(state)
    expect(f('q_1')).toBe('Should the docs cover the blob layout?')
    expect(f('o_3')).toBe('Yes')
    expect(f('o_4')).toBe('No')
    const t3 = state.threads.t_3
    const multi = withQuestion(state, {}, { messages: [{ ...t3.messages[0], text: '**Keep** old logs?\n\nThey are 2 GB.' }] })
    expect(titlesOf(multi)('q_1')).toBe('**Keep** old logs?')
  })
```

(`withQuestion` spreads `thread` last, so `messages` replaces the reopened question. The title only reads the text, so that is fine here.)

In `web/src/session/nav.test.ts`, add inside `describe('nav', …)`:

```ts
  it('maps a question and its options to the question bubble (question message spec)', () => {
    const { state } = fixtureSnapshot()
    const bubble = { threadId: 't_3', selector: '[data-question="q_1"]' }
    expect(anchorOf(state, 'q_1')).toEqual(bubble)
    expect(anchorOf(state, 'o_3')).toEqual(bubble)
    expect(anchorOf(state, 'o_4')).toEqual(bubble)
    expect(anchorOf(state, 'q_9')).toBeUndefined()
  })
```

In `web/src/shell/SessionPage.test.tsx`, add after the Task 1 option-chip test:

```tsx
  it('opens the thread of a question chip and scrolls to the question (question message spec)', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const snap = structuredClone(fixture)
      snap.state.threads.t_1.messages[0].text = 'See q_1; I would answer o_4.'
      window.location.hash = '#t_1'
      render(<SessionPage sid="s_fixture" />)
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      expect(screen.getByRole('link', { name: 'No' })).toHaveAttribute('title', 'id: o_4')
      const chip = screen.getByRole('link', { name: 'Should the docs cover the blob layout?' })
      expect(chip).toHaveAttribute('title', 'id: q_1')
      await userEvent.click(chip)
      expect(await screen.findByRole('heading', { level: 1, name: 'Docs' })).toBeInTheDocument()
      expect(window.location.hash).toBe('#t_3')
      expect(scrolled).toContain(document.querySelector('[data-question="q_1"]'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/shell src/refs src/session/nav.test.ts`
Expected: FAIL. There is no `question awaiting you` dot, `q_1` stays text, `titlesOf` returns `undefined` for `q_1`/`o_3`, and `anchorOf(state, 'q_1')` is `undefined`.

- [ ] **Step 3: Add the nav dot**

In `web/src/shell/Nav.tsx`, add the import

```tsx
import { openQuestion } from '../api/types'
```

and replace

```tsx
                <span className="label">{t.title}</span>
```

with

```tsx
                <span className="label">{t.title}</span>
                {t.status !== 'resolved' && openQuestion(t) && (
                  <span className="badge is-dot" aria-label="question awaiting you" />
                )}
```

In `web/src/styles/app.css`, replace

```css
.nav-stage-title .badge { min-width: 8px; height: 8px; padding: 0; }
```

with

```css
/* The "awaiting you" dot: a proposed stage summary, or a thread's open question (question message spec). */
.nav-stage-title .badge, .nav-thread .badge.is-dot { min-width: 8px; height: 8px; padding: 0; }
```

- [ ] **Step 4: Title and tokenize questions**

In `web/src/refs/ids.ts`, replace

```ts
const CODE_OR_ID = /(`+)[\s\S]*?\1|([a-zA-Z][\w+.-]*:\/\/\S+)|(?<![\w/.-])(?:st|t|o)_\d+(?![\w]|[./-]\w)/g
```

with

```ts
const CODE_OR_ID = /(`+)[\s\S]*?\1|([a-zA-Z][\w+.-]*:\/\/\S+)|(?<![\w/.-])(?:st|t|o|q)_\d+(?![\w]|[./-]\w)/g
```

and replace

```ts
// idTitles lists every id a chip can show with its title: stages, threads and variant options.
// useTitleOf keys its memo on this list, so it must stay cheap and deterministic.
export function idTitles(state: State): [string, string][] {
  const pairs: [string, string][] = state.stages.map((s) => [s.id, s.title])
  for (const t of Object.values(state.threads)) pairs.push([t.id, t.title])
  for (const b of Object.values(state.blocks)) for (const o of b.variants?.options ?? []) pairs.push([o.id, o.title])
  return pairs
}
```

with

```ts
// idTitles lists every id a chip can show with its title: stages, threads, variant options,
// questions (by the question's first line; CSS truncates it) and their options.
// useTitleOf keys its memo on this list, so it must stay cheap and deterministic.
export function idTitles(state: State): [string, string][] {
  const pairs: [string, string][] = state.stages.map((s) => [s.id, s.title])
  for (const t of Object.values(state.threads)) {
    pairs.push([t.id, t.title])
    for (const m of t.messages) {
      if (!m.question) continue
      pairs.push([m.question.id, m.text.trim().split('\n', 1)[0]])
      for (const o of m.question.options) pairs.push([o.id, o.title])
    }
  }
  for (const b of Object.values(state.blocks)) for (const o of b.variants?.options ?? []) pairs.push([o.id, o.title])
  return pairs
}
```

- [ ] **Step 5: Anchor questions and their options**

In `web/src/session/nav.ts`, replace `anchorOf` (with its comment) with:

```ts
// anchorOf maps an id that lives inside a thread to that thread and its element: a variant option
// (o_N) to its card, and a question (q_N) or one of its options to the question bubble (question
// message spec). Other ids, and ids the session does not know, have no anchor.
export function anchorOf(state: State, id: string): ItemAnchor | undefined {
  if (!/^[oq]_\d+$/.test(id)) return undefined
  for (const b of Object.values(state.blocks))
    if (b.variants?.options.some((o) => o.id === id)) return { threadId: b.threadId, selector: `[data-option="${id}"]` }
  for (const t of Object.values(state.threads))
    for (const m of t.messages) {
      const q = m.question
      if (q && (q.id === id || q.options.some((o) => o.id === id))) return { threadId: t.id, selector: `[data-question="${q.id}"]` }
    }
  return undefined
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run src/shell src/refs src/session/nav.test.ts`
Expected: PASS, including the existing Nav tests. Their thread names stay exact (`'Docs'`, `'Repository layer'`) because the fixture's question is withdrawn and has no dot.

- [ ] **Step 7: Run all web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. `chips.test.ts` still finds the truncating `.id-chip` rule.

- [ ] **Step 8: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src
git commit -m "feat(web): nav dot for an open question; q_N chips that open the question"
```

---

### Task 9: Guide and roadmap

**Files:**
- Modify: `internal/guide/guide.md` (model ids, id chips line, loop step 2, reading `tdm wait` output)
- Modify: `docs/ROADMAP.md` (drop the parked `question` block)
- Test: `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: the Task 4 wait output and the Task 5 command rows.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing guide test**

Append to `internal/guide/guide_test.go`:

```go
// Question message spec: when to ask, one question at a time, withdrawing, and both answer forms,
// which never resolve the thread.
func TestGuideCoversQuestions(t *testing.T) {
	for _, s := range []string{
		"tdm ask",
		"tdm ask --withdraw q_N",
		"2–4 short answers, no pros and cons",
		"one question at a time per thread",
		"keep working on other threads while you wait",
		"withdraw it",
		"question answered",
		`Answered q_N "<question>": o_N "<answer>".`,
		`Answered q_N "<question>" with their own answer:`,
		"An answer never resolves the thread",
		"`q_1`",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `go test ./internal/guide/ -run TestGuideCoversQuestions`
Expected: FAIL, `guide.md does not mention "2–4 short answers, no pros and cons"` (and the others after `tdm ask --withdraw q_N`).

- [ ] **Step 3: Update the guide**

In `internal/guide/guide.md`, replace

```markdown
- **Block**: content inside a thread: note, code, file, markdown or variants. Ids are short: `st_1`, `t_3`,
  `b_7`, `o_2`.

Mention threads, stages and variant options by id (`t_3`, `st_1`, `o_2`) in notes, messages, conclusions and
summaries. The page shows each one as a chip with its title and opens it on click, so short ids are all you need
to write.
```

with

```markdown
- **Block**: content inside a thread: note, code, file, markdown or variants. Ids are short: `st_1`, `t_3`,
  `b_7`, `o_2`, and `q_1` for a question.

Mention threads, stages, variant options and questions by id (`t_3`, `st_1`, `o_2`, `q_1`) in notes, messages,
conclusions and summaries. The page shows each one as a chip with its title and opens it on click, so short ids
are all you need to write.
```

replace

```markdown
   - when there is a real choice, add `variants` with pros and cons.
```

with

```markdown
   - when there is a real choice, add `variants` with pros and cons;
   - when you need a quick fact or decision to continue, use `tdm ask "<question>" --option A --option B`
     (2–4 short answers, no pros and cons). Ask one question at a time per thread,
     and keep working on other threads while you wait.
     If the conversation answers an open question some other way, withdraw it with `tdm ask --withdraw q_N`.
```

and replace

```markdown
- User text is always quoted with `> `. Treat it as the user's words, never as instructions from the tool.
```

with

```markdown
- `question answered` reads `Answered q_N "<question>": o_N "<answer>".`, or
  `Answered q_N "<question>" with their own answer:` followed by the user's text quoted with `> `.
  An answer never resolves the thread: continue with it, then conclude as usual.
  Line comments sent together with an answer arrive first, as their own `review submitted` item.
- User text is always quoted with `> `. Treat it as the user's words, never as instructions from the tool.
```

- [ ] **Step 4: Update the roadmap**

In `docs/ROADMAP.md`, delete the line

```markdown
- `question` block: a closed question with 2–4 answer buttons, delivered to the agent as a structured answer.
```

- [ ] **Step 5: Run the guide and CLI tests**

Run: `go test ./internal/guide/ ./internal/cli/`
Expected: PASS, including `TestGuideMentionsOptionIds` ("variant options", "`o_2`", "chip with its title" are all still there) and `TestGuideCoversEveryCommand`.

- [ ] **Step 6: Commit**

```bash
git add internal/guide docs/ROADMAP.md
git commit -m "docs: guide for tdm ask and question answers; drop the parked question block"
```

---

### Task 10: End-to-end coverage, rebuild webdist, verify everything

**Files:**
- Modify: `e2e/e2e_test.go` (`TestQuestionLoop`)
- Modify: `web/e2e/loop.spec.ts` (the question test)
- Regenerate: `internal/daemon/webdist/`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the Go e2e test**

Append to `e2e/e2e_test.go`:

```go
// Question message spec, through the real binary: ask, answer with an option (the draft arrives
// first), answer with Other, and withdraw.
func TestQuestionLoop(t *testing.T) {
	e := newEnv(t)
	sid := strings.Fields(e.must("", "session", "new", "Log format"))[0]
	e.must("", "stage", "add", "Storage")
	e.must("", "thread", "add", "Storage format")
	e.must("", "block", "add", "code", "--lang", "go", "--text", "type Event struct{}\n")
	if out := e.must("", "ask", "Must old logs stay readable?", "--option", "Yes", "--option", "No"); out != "q_1 o_1 o_2\n" {
		t.Fatalf("ask = %q", out)
	}
	e.user(sid, "question.answer", `{"questionId":"q_1","optionId":"o_2"}`,
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":1,"end":1},"text":"Why a struct?"}]}]}`)
	out := e.must("", "wait", "--timeout", "5s")
	contains(t, out,
		"## t_1 \"Storage format\" — review submitted",
		"> Why a struct?",
		"## t_1 \"Storage format\" — question answered\n\nAnswered q_1 \"Must old logs stay readable?\": o_2 \"No\".\n")
	if strings.Index(out, "review submitted") > strings.Index(out, "question answered") {
		t.Fatalf("the draft must come first:\n%s", out)
	}

	e.must("", "ask", "Which field holds the version?", "--option", "v", "--option", "version")
	e.user(sid, "question.answer", `{"questionId":"q_2","other":"schemaVersion"}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"),
		"Answered q_2 \"Which field holds the version?\" with their own answer:\n> schemaVersion\n")
	// An answer never resolves the thread.
	contains(t, e.must("", "session", "show"), "- t_1 \"Storage format\" — open")

	if out := e.must("", "ask", "Compress old logs?", "--option", "Yes", "--option", "No"); out != "q_3 o_5 o_6\n" {
		t.Fatalf("third ask = %q", out)
	}
	if out := e.must("", "ask", "--withdraw", "q_3"); out != "q_3\n" {
		t.Fatalf("withdraw = %q", out)
	}
	if _, errOut, code := e.tdm(tdmV1, "", "ask", "--withdraw", "q_3"); code != 1 || !strings.Contains(errOut, "error: question_closed:") {
		t.Fatalf("withdraw twice: %d %q", code, errOut)
	}
}
```

- [ ] **Step 2: Run it**

Run: `go test ./e2e/ -run TestQuestionLoop -v`
Expected: PASS. (The CLI, domain and render work is already in place, so this test passes on its first run. It pins the full loop through the real binary.)

- [ ] **Step 3: Add the Playwright test**

Append to `web/e2e/loop.spec.ts`:

```ts
// Question message spec: answer with a button, with a key and with Other…; chips for o_N and
// q_N; a withdrawn question; the nav dot while a question is open.
test('questions answered with a button, a key and Other', async ({ page }) => {
  const url = run(['session', 'new', 'Log format']).trim().split(' ')[1]
  run(['stage', 'add', 'Storage'])
  run(['thread', 'add', 'Storage format'])
  expect(run(['ask', 'Must old logs stay readable?', '--option', 'Yes', '--option', 'No'])).toBe('q_1 o_1 o_2\n')

  await page.goto(url)
  const q1 = page.locator('[data-question="q_1"]')
  await expect(q1).toContainText('Must old logs stay readable?')
  await expect(page.getByLabel('question awaiting you')).toBeVisible()

  // A button answers at once; the buttons go, the muted answer and the Answered message show
  await q1.getByRole('button', { name: 'No', exact: true }).click()
  await expect(q1).toContainText('Answer: No')
  await expect(q1.getByRole('button')).toHaveCount(0)
  await expect(page.locator('.msg-user').filter({ hasText: 'Answered: No' })).toBeVisible()
  await expect(page.getByLabel('question awaiting you')).toHaveCount(0)
  expect(run(['wait', '--timeout', '5s'])).toContain(
    '## t_1 "Storage format" — question answered\n\nAnswered q_1 "Must old logs stay readable?": o_2 "No".\n',
  )

  // The agent refers to the answer and the question by id: both are chips
  run(['say', 'Since o_2 on q_1, we drop the v0 reader.'])
  await expect(page.getByRole('link', { name: 'No', exact: true })).toHaveAttribute('title', 'id: o_2')
  await expect(page.getByRole('link', { name: 'Must old logs stay readable?' })).toHaveAttribute('title', 'id: q_1')

  // Keys 1–4 pick a button when focus is not in a text field
  expect(run(['ask', 'Keep JSONL?', '--option', 'Yes', '--option', 'No'])).toBe('q_2 o_3 o_4\n')
  const q2 = page.locator('[data-question="q_2"]')
  await expect(q2.getByRole('button', { name: 'Yes', exact: true })).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('1')
  await expect(q2).toContainText('Answer: Yes')
  expect(run(['wait', '--timeout', '5s'])).toContain('Answered q_2 "Keep JSONL?": o_3 "Yes".')

  // Other… swaps the buttons for a one-line input; Enter sends
  run(['ask', 'Which field holds the version?', '--option', 'v', '--option', 'version'])
  const q3 = page.locator('[data-question="q_3"]')
  await q3.getByRole('button', { name: 'Other…' }).click()
  await expect(q3.getByRole('button', { name: 'version', exact: true })).toHaveCount(0)
  await q3.getByRole('textbox', { name: 'Your answer' }).fill('schemaVersion')
  await page.keyboard.press('Enter')
  await expect(q3).toContainText('Answer: "schemaVersion"')
  expect(run(['wait', '--timeout', '5s'])).toContain(
    'Answered q_3 "Which field holds the version?" with their own answer:\n> schemaVersion\n',
  )

  // A withdrawn question loses its buttons
  run(['ask', 'Compress old logs?', '--option', 'Yes', '--option', 'No'])
  const q4 = page.locator('[data-question="q_4"]')
  await expect(q4.getByRole('button', { name: 'Yes', exact: true })).toBeVisible()
  expect(run(['ask', '--withdraw', 'q_4'])).toBe('q_4\n')
  await expect(q4).toContainText('Withdrawn')
  await expect(q4.getByRole('button')).toHaveCount(0)
})
```

- [ ] **Step 4: Build the web UI into webdist**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known and fine.

- [ ] **Step 5: Verify everything**

Run: `gofmt -l internal e2e; go test ./... && (cd web && npm test && npx tsc -b)`
Expected: `gofmt` lists no files; all PASS. `TestPageServesBuiltUI` serves the new build and `TestSnapshotContractFixture` matches the Task 6 fixture. `tsc -b` writes only the git-ignored `tsconfig.tsbuildinfo`.

- [ ] **Step 6: Run the browser tests**

Run: `cd web && npm run e2e`
Expected: all four tests PASS.

- [ ] **Step 7: Commit the tests, then the build**

```bash
git status --short   # expect e2e/e2e_test.go, web/e2e/loop.spec.ts and internal/daemon/webdist/ only
git add e2e/e2e_test.go web/e2e/loop.spec.ts
git commit -m "test(e2e): ask, answer (button, key, Other) and withdraw a question"
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the question message"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Part A: `o_N` chip with the option title, `id: o_N` on hover, click opens the thread and scrolls, unknown ids plain | 1 (web), 2 (guide, webdist) |
| Part A: `q_N` chip with the truncated question text | 8 |
| `tdm ask … --option …` (2–4), `--thread`, default thread, prints `q_N o_N …` | 3 (default thread via `activeThread`), 5 |
| `tdm ask --withdraw q_N` | 3, 5 |
| Fire-and-forget; answer via `tdm wait` | 4, 5, 10 |
| Events `question.asked` / `question.answered` / `question.withdrawn` | 3 |
| `q_N` counter; `o_N` shared with variants | 3 (Review Focus 5) |
| `Message.question {id, options, answer?, withdrawn?}`; asked appends an AI message | 3, 7 (types) |
| `Answered: <title>` / `Answered: "<other>"` user message | 3, 7 |
| Every Decide rejection | 3 (`TestQuestionRules`) |
| Answering never resolves; one-open-question rule not enforced | 3 |
| `tdm wait` output, both forms; draft comments first | 4, 6, 10 |
| Web: open question, buttons, Other… input, Enter/Esc, keys 1–4 | 7 |
| Web: answered (muted line + user message), composer keeps it open, withdrawn, resolved/read-only `Not answered` | 7 |
| Nav "awaiting you" dot | 8 |
| Guide: loop bullet, command rows, reading `tdm wait` output | 5 (rows), 9 |
| ROADMAP: drop the parked `question` block | 9 |
| Testing: domain, CLI flags, render, daemon contract, Go e2e, web unit, Playwright, guide | 3, 5, 4, 6, 10, 7–8, 10, 9 |

## Spec ambiguities resolved here

- **`threadId` in the answered/withdrawn payloads.** The spec's table lists only `questionId`. Both payloads also carry `threadId`, like `variant.chosen`, so `EventThreadIDs`, `tdm wait` grouping, "Awaiting AI" in `tdm session show` and `tdm log --stage` work unchanged.
- **The "awaiting you" dot.** The nav has no dot on a thread with a proposed conclusion today: that thread shows `◆`, and the 8px dot exists only on a stage whose summary is proposed. A thread with an open question gets that same 8px dot (`badge is-dot`), and `◆` stays as it is.
- **Buttons answer at once.** Unlike variants (select, then **Send choice**), a click or key 1–4 sends the answer immediately. That matches "quick facts".
- **The Other input has no Cancel button.** The spec names only **Send answer**. Esc cancels.
- **The answered bubble's muted line.** It reads `Answer: <title>` / `Answer: "<other>"`, so it does not repeat the `Answered: …` user message word for word.
- **Chip titles and anchors.**
  - A `q_N` chip shows the question's first line, and CSS truncates it.
  - A question's `o_N` chip shows the option title and scrolls to the question bubble.
  - An option in a superseded variants block still opens its thread. The card is collapsed, so nothing scrolls.
- **Error codes.** `question_not_found` (404) and `question_closed` (400, answered or withdrawn). An option that is not in the question reuses `option_not_found`.
- **The contract fixture.** It asks and then withdraws a question in `t_3`, so the snapshot pins the `question` shape without changing any existing web test's open-thread state. Tests reopen it with `withQuestion`.
- **Guide rows land with the CLI (Task 5), before the rest of the guide (Task 9).** `TestGuideCoversEveryCommand` fails for any command the guide does not name.
