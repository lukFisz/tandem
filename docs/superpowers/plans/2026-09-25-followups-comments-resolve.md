# Follow-ups: Line-Comment Header and One-Click Resolve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two follow-ups from the Tandem demo session. First, a user message sent with line comments gets a clickable `N line comments` header that jumps to those comments. Second, **Resolve** on an open thread resolves in one click; **Add note** (or `c`) opens the optional note editor.

**Architecture:** Go first. Each sent comment in the snapshot carries the `seq` of the review event that sent it, and a comment-only review now adds a textless user message. A message and its comments are linked by that shared seq. The web UI derives the header count from `thread.comments`, tags each sent note with `data-comment-seq`, and a small DOM helper scrolls to and flashes those notes. Resolve reuses the existing `thread.resolve` action. The `c` shortcut reaches the `ResolveThread` component through a document `CustomEvent`, so all key handling stays in `session/shortcuts.ts`.

**Tech Stack:** Go 1.x (stdlib, `encoding/json`), React 19 + TypeScript + Vite, Vitest + Testing Library, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-25-followups-comments-resolve.md`. Conventions: `docs/superpowers/plans/2026-09-25-feature-review-changes.md` (the previous plan), `docs/superpowers/specs/2026-09-25-tandem-design.md`.

## Global Constraints

- Module path: `github.com/lukaszfiszer/tandem`. Go tests: `go test ./...` from the repo root. Web tests: `cd web && npm test`.
- No new dependencies (Go or npm).
- No new event types. Old `events.jsonl` logs must replay unchanged. New snapshot fields are additive.
- UI copy, verbatim:
  - Comment header: `1 line comment`, `2 line comments` (`<N> line comments` for N ≠ 1).
  - Buttons on an open thread: `Resolve`, `Add note`.
  - Hint next to them: `or press c to add a note`, with `c` in a `<kbd>` (same style as `Accept <kbd>a</kbd>`).
  - Note editor (unchanged): label `Conclusion (optional)`, submit `Resolve`, `Cancel`.
- Default conclusion for a Resolve without a note: `Resolved by user` (`domain.UserResolvedText`, already filled in by the daemon).
- Wire contract: every entry of `thread.comments` gains `seq: number`, the seq of the `review.submitted` event that sent it. The user message of that review has the same `seq`. A review with comments but no text for a thread now adds a user message with `text: ""` to that thread.
- The `c` key: with a line selection it comments on the selection (unchanged). Without a selection, on an open thread of a live session, it opens the Resolve note editor. Otherwise it does nothing.
- After the Go change to the snapshot JSON, regenerate the fixture with `go test ./internal/daemon -run TestSnapshotContractFixture -update` and commit `web/src/test/fixtures/snapshot.json`.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 5**. UI tasks do not commit it (discard it with `git checkout internal/daemon/webdist` if a build touched it).
- `docs/ROADMAP.md` stays unchanged.
- Every commit message uses conventional style and ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run the tasks in order. Tasks 3 and 4 both touch `web/src/thread/ThreadView.test.tsx` and `web/src/styles/app.css`.

## Review Focus

1. **Old logs with a draft-only send.** Before this change such a review added no message. Replaying it must now give a header-only entry (`1 line comment`, no empty text). Delivery status and the typing bubble keep working off `lastUserSeq`. Pinned by the Task 2 reducer test and the Task 3 ThreadView test.
2. **One send with comments on several threads.** Each thread's message counts only the comments on that thread. A thread that got only comments shows a header-only entry at the send's seq. Pinned in Task 2.
3. **Comments on a block that was later superseded.** Their notes sit inside a closed `<details>`. Clicking the header must expand it, then scroll. If the notes are not on the page at all, the click does nothing and nothing throws. Pinned in Task 3 (`showSentComments` tests).
4. **`c` with and without a line selection.** With a selection, `c` must still open the line-comment editor and must not open the note. Without one, it opens the note only on an open thread: not on a proposed conclusion, a stage, or a read-only session, and never while typing. Pinned in Task 4 (shortcut tests).
5. **Double-clicking one-click Resolve.** The second click must not send a second `thread.resolve`. Both buttons are disabled while in flight. A failed Resolve re-enables them and does not call `onResolved`. Pinned in Task 4.

---

### Task 1: Commit the spec and this plan

**Files:**
- Add: `docs/superpowers/specs/2026-09-25-followups-comments-resolve.md` (already on disk, untracked)
- Add: `docs/superpowers/plans/2026-09-25-followups-comments-resolve.md` (this file)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Commit both docs**

```bash
git add docs/superpowers/specs/2026-09-25-followups-comments-resolve.md docs/superpowers/plans/2026-09-25-followups-comments-resolve.md
git commit -m "docs: follow-ups spec and plan (line-comment header, one-click Resolve)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain — sent comments carry their review's seq; comment-only reviews are messages

Today `Thread.Comments` is a flat `[]LineComment` with no seq, and `userMessage` adds no message for an empty text. So the snapshot cannot say which message a comment went with, and a draft-only send has no timeline entry. This task wraps each sent comment in a `ThreadComment` that embeds `LineComment` plus the event seq. JSON flattens the embedded fields, so each comment only gains `"seq"`. A review part with comments now always adds a user message.

**Files:**
- Modify: `internal/domain/state.go` (`Thread.Comments` type, new `ThreadComment`)
- Modify: `internal/domain/reducer.go` (the `EvReviewSubmitted` case, new `userReview` helper next to `userMessage`)
- Test: `internal/domain/lifecycle_test.go`
- Regenerate: `web/src/test/fixtures/snapshot.json`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `domain.ThreadComment{LineComment; Seq int64 "seq"}`. JSON: `{"blockId","lines","text","seq"}`;
  - `domain.Thread.Comments []ThreadComment` (JSON key `comments`, unchanged);
  - `(*Thread).userReview(rt ReviewThread, seq int64)`, unexported.

- [ ] **Step 1: Write the failing tests**

Append to `internal/domain/lifecycle_test.go` (`encoding/json` and `reflect` are already imported):

```go
// Follow-ups A: a message and the line comments sent with it share the review's seq, per thread.
// A thread that only got comments gets a textless user message, so the UI can show
// "N line comments" (old logs with draft-only sends replay the same way).
func TestReviewCommentsLinkToTheirMessage(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvThreadCreated, ThreadCreated{ID: "t_2", StageID: "st_1", Title: "Cache"}),
		NewEvent(ActorAI, EvBlockAdded, BlockAdded{ID: "b_4", ThreadID: "t_2",
			BlockContent: BlockContent{Kind: KindCode, Lang: "go", Text: "x\n", FirstLine: 1, LineCount: 1}}),
		NewEvent(ActorUser, EvReviewSubmitted, ReviewSubmitted{Threads: []ReviewThread{
			{ThreadID: "t_1", Comments: []LineComment{{BlockID: "b_2", Lines: LineRange{1, 1}, Text: "why?"}}, Message: "overall ok"},
			{ThreadID: "t_2", Comments: []LineComment{
				{BlockID: "b_4", Lines: LineRange{1, 1}, Text: "a"},
				{BlockID: "b_4", Lines: LineRange{1, 1}, Text: "b"},
			}},
		}}),
		NewEvent(ActorUser, EvReviewSubmitted, ReviewSubmitted{Threads: []ReviewThread{{ThreadID: "t_1", Message: "just text"}}}),
	)
	s := replay(t, evs...)
	t1, t2 := s.Threads["t_1"], s.Threads["t_2"]

	wantT1 := []Message{
		{Actor: ActorAI, Text: "hi", Seq: 8},
		{Actor: ActorUser, Text: "overall ok", Seq: 11},
		{Actor: ActorUser, Text: "just text", Seq: 12},
	}
	if !reflect.DeepEqual(t1.Messages, wantT1) {
		t.Fatalf("t_1 messages = %+v", t1.Messages)
	}
	if want := []ThreadComment{{LineComment: LineComment{BlockID: "b_2", Lines: LineRange{1, 1}, Text: "why?"}, Seq: 11}}; !reflect.DeepEqual(t1.Comments, want) {
		t.Fatalf("t_1 comments = %+v", t1.Comments)
	}

	if want := []Message{{Actor: ActorUser, Text: "", Seq: 11}}; !reflect.DeepEqual(t2.Messages, want) {
		t.Fatalf("t_2 messages = %+v", t2.Messages)
	}
	if len(t2.Comments) != 2 || t2.Comments[0].Seq != 11 || t2.Comments[1].Seq != 11 || t2.Comments[1].Text != "b" {
		t.Fatalf("t_2 comments = %+v", t2.Comments)
	}
	if t2.LastUserSeq != 11 || !t2.AwaitingAI() {
		t.Fatalf("t_2 = %+v", t2)
	}
}

func TestThreadCommentJSON(t *testing.T) {
	b, err := json.Marshal(ThreadComment{LineComment: LineComment{BlockID: "b_2", Lines: LineRange{1, 1}, Text: "why?"}, Seq: 11})
	if want := `{"blockId":"b_2","lines":{"start":1,"end":1},"text":"why?","seq":11}`; err != nil || string(b) != want {
		t.Fatalf("json = %s (%v), want %s", b, err, want)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/domain/ -run 'TestReviewCommentsLinkToTheirMessage|TestThreadCommentJSON' -v`
Expected: compile FAIL, `undefined: ThreadComment`.

- [ ] **Step 3: Implement**

In `internal/domain/state.go`, change the `Comments` field of `Thread` to:

```go
	Comments           []ThreadComment `json:"comments"`
```

(re-align the neighbouring struct tags with `gofmt`), and add below the `Thread` type:

```go
// ThreadComment is a line comment the user sent, with the seq of the review that sent it. The
// user message of that review has the same seq, which is how the UI links the two.
type ThreadComment struct {
	LineComment
	Seq int64 `json:"seq"`
}
```

In `internal/domain/reducer.go`, replace the loop body of `case EvReviewSubmitted:`:

```go
		for _, rt := range p.Threads {
			t := s.Threads[rt.ThreadID]
			if t == nil {
				return unknown("thread", rt.ThreadID, e)
			}
			t.userReview(rt, e.Seq)
		}
```

Add below `userMessage`:

```go
// userReview records one thread's part of a review. Each comment keeps the review's seq, and a
// part with comments is a user message even without text, so the UI can head it "N line comments".
func (t *Thread) userReview(rt ReviewThread, seq int64) {
	for _, c := range rt.Comments {
		t.Comments = append(t.Comments, ThreadComment{LineComment: c, Seq: seq})
	}
	if len(rt.Comments) == 0 {
		t.userMessage(rt.Message, seq)
		return
	}
	t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: rt.Message, Seq: seq})
	t.LastUserSeq = seq
}
```

- [ ] **Step 4: Run the domain tests**

Run: `gofmt -l internal/domain; go test ./internal/domain/ -v`
Expected: no files listed by `gofmt`; PASS (the existing `TestUserEvents` only checks `len(th.Comments)`).

- [ ] **Step 5: Regenerate the contract fixture and run everything**

Run: `go test ./internal/daemon -run TestSnapshotContractFixture -update && git diff web/src/test/fixtures/snapshot.json`
Expected: the only change is `"seq": 15` on t_1's comment `Why not an empty map?`. The fixture's review has a message, so t_1's messages do not change.

Run: `go test ./... && (cd web && npm test)`
Expected: PASS. The web types ignore the extra field until Task 3.

- [ ] **Step 6: Commit**

```bash
git add internal/domain/state.go internal/domain/reducer.go internal/domain/lifecycle_test.go web/src/test/fixtures/snapshot.json
git commit -m "feat(domain): link sent line comments to their message by the review's seq

A review part with comments now always adds a user message, so a
draft-only send shows up in the thread timeline.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web — "N line comments" header that jumps to the comments

**Files:**
- Modify: `web/src/api/types.ts` (`ThreadComment`, `Thread.comments`)
- Modify: `web/src/thread/timeline.ts` (add `sentComments`, `lineCommentsLabel`)
- Create: `web/src/thread/showSentComments.ts`, `web/src/thread/showSentComments.test.ts`
- Modify: `web/src/blocks/LineNotes.tsx` (`data-comment-seq` on sent notes)
- Modify: `web/src/thread/MessageView.tsx` (the `comments` and `onShowComments` props)
- Modify: `web/src/thread/ThreadView.tsx` (article ref, pass the new props)
- Modify: `web/src/thread/delivery.ts` (fix the now-stale M2 comment)
- Modify: `web/src/styles/app.css` (`.msg-comments`, `.line-note.is-flash`)
- Modify: `web/e2e/loop.spec.ts` (one assertion; it runs in Task 5)
- Test: `web/src/thread/timeline.test.ts`, `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `thread.comments[].seq` (Task 2).
- Produces:
  - `interface ThreadComment extends LineComment { seq: number }`, and `Thread.comments: ThreadComment[]`;
  - `sentComments(thread: Thread, message: Message): ThreadComment[]`. It returns `[]` for AI messages;
  - `lineCommentsLabel(n: number): string`, giving `1 line comment` or `<n> line comments`;
  - `showSentComments(root: ParentNode, seq: number): boolean`. It returns false when no note with that seq is on the page;
  - `MessageView({ message, status, choice, comments, onShowComments }: { message: Message; status?: string | null; choice?: string; comments?: number; onShowComments?: () => void })`;
  - sent notes render `data-comment-seq="<seq>"` on their `.line-note` element.

- [ ] **Step 1: Write the failing unit tests**

In `web/src/thread/timeline.test.ts`, change the import to `import { choiceTitle, lineCommentsLabel, sentComments, timeline } from './timeline'` and append:

```ts
describe('sentComments', () => {
  it('lists the line comments sent with a user message (same seq)', () => {
    const { state } = fixtureSnapshot()
    const t1 = state.threads.t_1
    expect(sentComments(t1, t1.messages[1]).map((c) => c.text)).toEqual(['Why not an empty map?'])
    expect(sentComments(t1, t1.messages[0])).toEqual([]) // the AI's message
    expect(sentComments(state.threads.t_2, state.threads.t_2.messages[0])).toEqual([])
  })

  it('labels the count', () => {
    expect(lineCommentsLabel(1)).toBe('1 line comment')
    expect(lineCommentsLabel(2)).toBe('2 line comments')
  })
})
```

Create `web/src/thread/showSentComments.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { showSentComments } from './showSentComments'

function page(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  for (const n of root.querySelectorAll<HTMLElement>('.line-note')) n.scrollIntoView = vi.fn()
  return root
}

describe('showSentComments', () => {
  it('scrolls to the first note of a send and flashes all of them', () => {
    const root = page(
      '<div class="line-note" data-comment-seq="15"></div>' +
        '<div class="line-note" data-comment-seq="18"></div>' +
        '<div class="line-note" data-comment-seq="18"></div>',
    )
    const notes = [...root.querySelectorAll<HTMLElement>('.line-note')]
    expect(showSentComments(root, 18)).toBe(true)
    expect(notes[1].scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(notes[2].scrollIntoView).not.toHaveBeenCalled()
    expect(notes.map((n) => n.classList.contains('is-flash'))).toEqual([false, true, true])
    notes[1].dispatchEvent(new Event('animationend'))
    expect(notes[1]).not.toHaveClass('is-flash')
  })

  // Review Focus 3: a comment on a superseded block sits inside the collapsed <details>.
  it('expands a collapsed superseded block first', () => {
    const root = page('<details><summary>b_5 superseded by b_6</summary><div class="line-note" data-comment-seq="9"></div></details>')
    expect(showSentComments(root, 9)).toBe(true)
    expect(root.querySelector('details')!.open).toBe(true)
  })

  it('does nothing when the notes are not on the page', () => {
    expect(showSentComments(page('<div class="line-note" data-comment-seq="15"></div>'), 99)).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing ThreadView tests**

In `web/src/thread/ThreadView.test.tsx`, change the vitest import to `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'`. Append a new top-level `describe` at the end of the file:

```ts
describe('ThreadView line comment header (follow-ups A)', () => {
  // jsdom has no scrollIntoView: record which element it was called on.
  const scrolled: Element[] = []
  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
  })
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('heads a message sent with line comments and jumps to them on click', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<ThreadView threadId="t_1" />)
    const note = (await screen.findByText('Why not an empty map?')).closest('.line-note')
    expect(container.querySelector('.msg-user')).toHaveTextContent(/^1 line commentOverall fine\.$/)
    await user.click(screen.getByRole('button', { name: '1 line comment' }))
    expect(scrolled).toEqual([note])
    expect(note).toHaveClass('is-flash')
  })

  // Review Focus 1: a draft-only send is a header-only entry, with no empty text.
  it('shows a draft-only send as a header-only entry', () => {
    const base = makeCtx()
    const t1 = base.state.threads.t_1
    base.state.threads.t_1 = {
      ...t1,
      messages: [...t1.messages, { actor: 'user', text: '', seq: 18 }],
      comments: [
        ...t1.comments,
        { blockId: 'b_2', lines: { start: 12, end: 12 }, text: 'Rename?', seq: 18 },
        { blockId: 'b_2', lines: { start: 13, end: 13 }, text: 'Why a val?', seq: 18 },
      ],
      lastUserSeq: 18,
    }
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    const msgs = container.querySelectorAll('.msg-user')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toHaveTextContent(/^2 line comments$/)
  })

  it('shows no header on messages sent without comments', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    expect(screen.queryByRole('button', { name: /line comment/ })).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/timeline.test.ts src/thread/showSentComments.test.ts src/thread/ThreadView.test.tsx`
Expected: FAIL. `sentComments`/`lineCommentsLabel` are not exported, `./showSentComments` does not resolve, and the `1 line comment` button is not found.

- [ ] **Step 4: Implement the types and helpers**

In `web/src/api/types.ts`, add after `LineComment`:

```ts
/** A line comment the user sent. `seq` is the review's seq; the user message of that review has the same seq. */
export interface ThreadComment extends LineComment {
  seq: number
}
```

and change `Thread.comments` to `comments: ThreadComment[]`.

In `web/src/thread/timeline.ts`, change the type import to `import type { Block, Message, State, Thread, ThreadComment } from '../api/types'` and append:

```ts
// sentComments lists the line comments sent together with a user message: they share its seq.
export function sentComments(thread: Thread, message: Message): ThreadComment[] {
  return message.actor === 'user' ? thread.comments.filter((c) => c.seq === message.seq) : []
}

export function lineCommentsLabel(n: number): string {
  return `${n} line comment${n === 1 ? '' : 's'}`
}
```

Create `web/src/thread/showSentComments.ts`:

```ts
// showSentComments scrolls to the first sent note of one send (its review seq) and briefly
// flashes all of them. A note inside a collapsed superseded block is expanded first. Returns
// false when none of the notes is on the page.
export function showSentComments(root: ParentNode, seq: number): boolean {
  const notes = [...root.querySelectorAll<HTMLElement>(`.line-note[data-comment-seq="${seq}"]`)]
  if (notes.length === 0) return false
  for (const note of notes) {
    const details = note.closest('details')
    if (details && !details.open) details.open = true
    note.classList.remove('is-flash')
    void note.offsetWidth // restart the animation on a repeated click
    note.classList.add('is-flash')
    note.addEventListener('animationend', () => note.classList.remove('is-flash'), { once: true })
  }
  notes[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}
```

- [ ] **Step 5: Tag the sent notes**

In `web/src/blocks/LineNotes.tsx`, give `Note` an optional `seq` and render it as a data attribute:

```tsx
function Note({ kind, who, lines, seq, children }: { kind: 'ai' | 'sent' | 'draft'; who: string; lines: LineRange; seq?: number; children: ReactNode }) {
  return (
    <div className={`line-note is-${kind}`} data-comment-seq={seq}>
```

(the rest of `Note` is unchanged). In the sent-comments map, pass the seq:

```tsx
          <Note key={`s${i}`} kind="sent" who="You" lines={c.lines} seq={c.seq}>
```

- [ ] **Step 6: Render the header**

Replace `web/src/thread/MessageView.tsx`:

```tsx
import type { Message } from '../api/types'
import { Prose } from '../markdown/Prose'
import { lineCommentsLabel } from './timeline'

// `status`, when given, is the delivery status line shown under the user's latest message
// (see delivery.ts): null once the AI has acted on it, otherwise a short "sent"/"replying" note.
// `choice` is the title of the variant option the message was sent with (feature review t_3).
// `comments` is how many line comments went with it. Its header jumps to them via
// `onShowComments` (follow-ups A). Either header may stand alone, as the text may be empty.
export function MessageView({
  message,
  status,
  choice,
  comments = 0,
  onShowComments,
}: {
  message: Message
  status?: string | null
  choice?: string
  comments?: number
  onShowComments?: () => void
}) {
  if (message.actor === 'user')
    return (
      <>
        <div className="msg-user">
          {choice && <div className="msg-choice">{`Chose: ${choice}`}</div>}
          {comments > 0 && (
            <button type="button" className="msg-comments" onClick={onShowComments}>
              {lineCommentsLabel(comments)}
            </button>
          )}
          {message.text || null}
        </div>
        {status && (
          <p className="delivery-status" role="status">
            {status}
          </p>
        )}
      </>
    )
  return <Prose className="msg-ai" text={message.text} />
}
```

In `web/src/thread/ThreadView.tsx`:
- add `import { useRef } from 'react'` and `import { showSentComments } from './showSentComments'`;
- change the timeline import to `import { choiceTitle, sentComments, timeline } from './timeline'`;
- in `ThreadBody`, add `const articleRef = useRef<HTMLElement>(null)` below the `useSessionCtx()` line, and change `<article className="thread">` to `<article className="thread" ref={articleRef}>`;
- add these two props to `<MessageView …>`, after `choice={…}`:

```tsx
            comments={sentComments(thread, item.message).length}
            onShowComments={() => {
              if (articleRef.current) showSentComments(articleRef.current, item.message.seq)
            }}
```

In `web/src/thread/delivery.ts`, in the `threadIsReplying` comment, replace `a textless action (a draft-only send) bumps lastUserSeq without adding` with `a textless action (accepting or editing a conclusion) bumps lastUserSeq without adding`. Draft-only sends are messages now.

In `web/src/styles/app.css`, after the `.msg-choice:not(:last-child) { … }` rule, add:

```css
.msg-comments {
  display: block;
  padding: 0;
  border: none;
  background: none;
  font: 600 0.75rem var(--font-ui);
  color: var(--muted);
  text-align: left;
  cursor: pointer;
}
.msg-comments:hover { color: var(--fg); text-decoration: underline; }
.msg-comments:not(:last-child) { margin-bottom: 2px; }
.line-note.is-flash { animation: tdm-flash 1.6s ease-out; }
@keyframes tdm-flash {
  from { box-shadow: 0 0 0 2px var(--accent); }
  to { box-shadow: 0 0 0 2px transparent; }
}
```

- [ ] **Step 7: Add the e2e assertion (it runs in Task 5)**

In `web/e2e/loop.spec.ts`, after `await expect(lazy.getByText('Chosen')).toBeVisible()`, add:

```ts
  // Follow-ups A: the draft went as its own send (a review before the choice), headed "1 line comment"
  await expect(page.getByRole('button', { name: '1 line comment' })).toBeVisible()
```

- [ ] **Step 8: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. `scale.test.ts` accepts the rem font size. The existing test object literals with `comments: []` still typecheck.

- [ ] **Step 9: Commit**

```bash
git add web/src/api/types.ts web/src/thread web/src/blocks/LineNotes.tsx web/src/styles/app.css web/e2e/loop.spec.ts
git commit -m "feat(web): head messages sent with line comments with N line comments

Clicking the header scrolls to those comments and flashes them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web — one-click Resolve, Add note, and `c` to add a note

**Files:**
- Modify: `web/src/session/shortcuts.ts` (`RESOLVE_NOTE_EVENT`, the `c` case)
- Modify: `web/src/thread/ResolveThread.tsx` (one-click Resolve, Add note, hint, event listener, busy state)
- Modify: `web/src/styles/app.css` (`.resolve-bar`, `.resolve-hint`)
- Modify: `docs/superpowers/specs/2026-09-25-tandem-design.md` (the keyboard shortcut table)
- Test: `web/src/session/shortcuts.test.ts`, `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: the action `{ type: 'thread.resolve'; data: { threadId: string; text?: string } }` (already in `api/types.ts`) and `ctx.run`.
- Produces:
  - `export const RESOLVE_NOTE_EVENT = 'tdm:resolve-note'` in `web/src/session/shortcuts.ts`. It is dispatched on `document` as a `CustomEvent<{ threadId: string }>`;
  - `ResolveThread({ thread, onResolved })`, same signature as before.

- [ ] **Step 1: Write the failing shortcut tests**

In `web/src/session/shortcuts.test.ts`, change the import to `import { handleShortcut, RESOLVE_NOTE_EVENT, type KeyLike } from './shortcuts'`.

In the existing test `opens the comment editor with c and clears the selection with Escape`, t_1 is an open thread, so its last line would now open the note. Change that line to use the thread with a proposed conclusion:

```ts
    expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 't_2', select: vi.fn() })).toBe(false)
```

Add:

```ts
  // Follow-ups B and Review Focus 4: c comments on a line selection first; with no selection it
  // opens the Resolve note on an open thread of a live session, and nowhere else.
  it('opens the Resolve note with c when no line is selected', () => {
    const opened = vi.fn()
    document.addEventListener(RESOLVE_NOTE_EVENT, opened)
    try {
      expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 't_1', select: vi.fn() })).toBe(true)
      expect(opened).toHaveBeenCalledTimes(1)
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ threadId: 't_1' })

      expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 't_2', select: vi.fn() })).toBe(false) // conclusion proposed
      expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 'st_1', select: vi.fn() })).toBe(false) // a stage
      expect(handleShortcut(key('c'), { ctx: makeCtx({ readOnly: true }), current: 't_1', select: vi.fn() })).toBe(false)
      const textarea = document.createElement('textarea')
      expect(handleShortcut(key('c', { target: textarea }), { ctx: makeCtx(), current: 't_1', select: vi.fn() })).toBe(false)

      const selection = { blockId: 'b_2', lines: { start: 14, end: 14 }, editing: false }
      const withSelection = makeCtx({ selection })
      expect(handleShortcut(key('c'), { ctx: withSelection, current: 't_1', select: vi.fn() })).toBe(true)
      expect(withSelection.setSelection).toHaveBeenCalledWith({ ...selection, editing: true })
      const editing = makeCtx({ selection: { ...selection, editing: true } })
      expect(handleShortcut(key('c'), { ctx: editing, current: 't_1', select: vi.fn() })).toBe(false)

      expect(opened).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener(RESOLVE_NOTE_EVENT, opened)
    }
  })
```

- [ ] **Step 2: Rewrite the Resolve tests in ThreadView**

In `web/src/thread/ThreadView.test.tsx`:
- change the Testing Library import to `import { act, fireEvent, screen } from '@testing-library/react'`;
- add `import { RESOLVE_NOTE_EVENT } from '../session/shortcuts'`;
- **delete** these three tests: `resolves an open thread with an optional note (feature review t_7)`, `resolves with an empty note`, and `does not call onResolved when Resolve fails, and cancels back to the button`;
- keep `offers Resolve only on open threads of a live session` unchanged;
- add, in the same `describe('ThreadView', …)` block:

```ts
  it('resolves an open thread in one click (follow-ups B)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx } = renderStateful(<ThreadView threadId="t_1" onResolved={onResolved} />)
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1' } })
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
  })

  // Review Focus 5: one request per Resolve, both buttons disabled while it is in flight.
  it('sends a single Resolve while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_1" onResolved={onResolved} />, makeCtx({ run }))
    const resolve = screen.getByRole('button', { name: 'Resolve' })
    await user.click(resolve)
    expect(resolve).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
    fireEvent.click(resolve)
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('re-enables Resolve and does not advance when it fails', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_1" onResolved={onResolved} />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onResolved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeEnabled()
  })

  it('adds a note before resolving (follow-ups B)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx, container } = renderStateful(<ThreadView threadId="t_1" onResolved={onResolved} />)
    expect(container.querySelector('.resolve-hint')).toHaveTextContent('or press c to add a note')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Repository stays.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1', text: 'Repository stays.' } })
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('resolves with an empty note, and cancels the note back to the buttons', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    const submit = screen.getByRole('button', { name: 'Resolve' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_3' } })
  })

  it('opens the note editor when the c shortcut targets this thread', () => {
    renderStateful(<ThreadView threadId="t_1" />)
    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_3' } }))
    })
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_1' } }))
    })
    expect(screen.getByRole('textbox', { name: 'Conclusion (optional)' })).toHaveFocus()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/session/shortcuts.test.ts src/thread/ThreadView.test.tsx`
Expected: FAIL. `RESOLVE_NOTE_EVENT` is undefined, and the first click on `Resolve` opens the editor instead of running `thread.resolve`.

- [ ] **Step 4: Implement the shortcut**

In `web/src/session/shortcuts.ts`, add below the imports:

```ts
// RESOLVE_NOTE_EVENT asks the open thread's ResolveThread to open its note editor (the `c` key
// with no line selected). A document event keeps every key binding in handleShortcut, without
// lifting the editor's state into the session context.
export const RESOLVE_NOTE_EVENT = 'tdm:resolve-note'
```

Replace the `case 'c':` block with:

```ts
    case 'c': {
      // A line selection wins: c comments on it, as before.
      if (ctx.selection) {
        if (ctx.selection.editing) return false
        ctx.setSelection({ ...ctx.selection, editing: true })
        return true
      }
      // No selection: add a note and resolve an open thread (follow-ups B).
      const t = ctx.state.threads[current]
      if (ctx.readOnly || !t || t.status !== 'open') return false
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: t.id } }))
      return true
    }
```

- [ ] **Step 5: Implement one-click Resolve**

Replace `web/src/thread/ResolveThread.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Thread } from '../api/types'
import { CommentEditor } from '../blocks/CommentEditor'
import { useSessionCtx } from '../session/context'
import { RESOLVE_NOTE_EVENT } from '../session/shortcuts'

// ResolveThread lets the user resolve an open thread the AI has not proposed a conclusion for.
// Resolve resolves at once; the daemon fills in "Resolved by user" (follow-ups B). Add note, or
// `c` with no line selected, opens the same editor as the conclusion's Edit, starting empty. The
// note becomes the conclusion, and the agent receives it as "conclusion edited and accepted".
// It is its own component, so the editor state is dropped when the thread's status changes.
export function ResolveThread({ thread, onResolved }: { thread: Thread; onResolved?: () => void }) {
  const { run } = useSessionCtx()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    const open = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail?.threadId === thread.id) setEditing(true)
    }
    document.addEventListener(RESOLVE_NOTE_EVENT, open)
    return () => document.removeEventListener(RESOLVE_NOTE_EVENT, open)
  }, [thread.id])

  const resolve = async (text: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (await run({ type: 'thread.resolve', data: { threadId: thread.id, ...(text ? { text } : {}) } })) onResolved?.()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (!editing)
    return (
      <div className="resolve-bar">
        <button type="button" className="btn small" disabled={busy} onClick={() => void resolve('')}>
          Resolve
        </button>
        <button type="button" className="btn link" disabled={busy} onClick={() => setEditing(true)}>
          Add note
        </button>
        <span className="resolve-hint">
          or press <kbd>c</kbd> to add a note
        </span>
      </div>
    )
  return (
    <section className="conclusion" aria-label="Resolve thread">
      <div className="kicker">Resolve thread</div>
      <CommentEditor
        label="Conclusion (optional)"
        submitLabel="Resolve"
        allowEmpty
        onSave={(text) => void resolve(text)}
        onCancel={() => setEditing(false)}
      />
    </section>
  )
}
```

In `web/src/styles/app.css`, replace `.resolve-bar { display: flex; font-family: var(--font-ui); }` with:

```css
.resolve-bar { display: flex; align-items: center; gap: 8px; font-family: var(--font-ui); }
.resolve-hint { font-size: 0.75rem; color: var(--faint); }
.resolve-hint kbd { margin: 0 2px; }
```

- [ ] **Step 6: Update the shortcut table in the design spec**

In `docs/superpowers/specs/2026-09-25-tandem-design.md`, replace the row

```
| `c` | comment on the selection |
```

with

```
| `c` | comment on the selection; with no selection on an open thread, add a note and resolve |
```

- [ ] **Step 7: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/session/shortcuts.ts web/src/session/shortcuts.test.ts web/src/thread web/src/styles/app.css docs/superpowers/specs/2026-09-25-tandem-design.md
git commit -m "feat(web): one-click Resolve, with Add note (or c) for an optional note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rebuild webdist, verify everything, commit

**Files:**
- Regenerate: `internal/daemon/webdist/`

**Interfaces:**
- Consumes: everything above.
- Produces: an embedded UI that matches `web/src`.

- [ ] **Step 1: Build the web UI**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known (ROADMAP polish backlog) and fine.

- [ ] **Step 2: Run the full test suites and the project typecheck**

Run: `go test ./... && (cd web && npm test && npx tsc -b)`
Expected: all PASS. `TestPageServesBuiltUI` serves the new build, and `TestSnapshotContractFixture` matches the committed fixture. `tsc -b` writes only the git-ignored `tsconfig.tsbuildinfo`.

- [ ] **Step 3: Run the e2e (needs `npx playwright install chromium` once and a Go toolchain)**

Run: `cd web && npm run e2e`
Expected: PASS. After `Send choice`, the timeline shows the `1 line comment` header (the assertion added in Task 3), and `tdm wait` output is unchanged.

- [ ] **Step 4: Commit the build**

```bash
git status --short   # only internal/daemon/webdist/ should be modified
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the line-comment header and one-click Resolve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual smoke check (with the user)**

Run the check against a scratch home: `TANDEM_HOME="$(mktemp -d)"`, `go build -o /tmp/tdm ./cmd/tdm`, then drive a session with the CLI (two threads, each with a code block). Check:
- two draft comments on thread 1 plus one on thread 2, sent with `Send to AI`: thread 1 shows `2 line comments` and thread 2 shows `1 line comment`, both header-only;
- clicking a header scrolls to the comments and flashes them;
- `Resolve` resolves at once with `Resolved by user`, and `tdm wait` prints `conclusion edited and accepted`;
- `c` with no line selected opens the note editor, and `c` with a line selected opens the line-comment editor.
