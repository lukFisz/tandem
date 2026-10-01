# Demo 6 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four follow-ups from the demo 6 session:
1. `Answered: …` and `Chose: …` user messages get a header link. It jumps to the question or option they answer.
2. Messages the AI has not received yet look muted, with a dashed border.
3. The target of a jump gets a short highlight.
4. The guide tells the agent to keep the page open.

**Architecture:**
- **Domain:** the answer's user message gains `answerTo: "q_N"`. The reducer sets it from the `question.answered` payload, the same way `choice` links a `Chose:` message to its option. No event or command changes, so old logs replay into it.
  - This is the smallest sound link. The web cannot recover it from the text: two questions can share an answer title, and an Other answer is free text. It cannot recover it from seqs either: the question does not record when it was answered.
- **Web, header links:** both headers are plain links to `#q_N` / `#o_N`, like id chips. The existing hash routing does the rest: `useCurrentItem` → `anchorOf` → a fresh `ScrollRequest` → the `SessionPage` scroll effect. So chips and headers share one jump path.
- **Web, highlight:** the scroll effect calls a new `highlightJumpTarget(el)` (`web/src/shell/motion.ts`). It restarts an `is-jump-target` class and drops it after `JUMP_HIGHLIGHT_MS` on a timer. This reuses the resolve flash pattern: a `color-mix` background keyframe, a class dropped by a timer, and a static rule under reduced motion.
- **Web, delivery:** `isUndelivered` in `delivery.ts` is the rule `deliveryStatus` already uses. `MessageView` adds `is-undelivered` to the bubble.

**Tech Stack:** Go 1.x (event-sourced domain, `net/http` daemon), React 19 + TypeScript + Vite, Vitest + Testing Library, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-demo6-followups.md` (committed as 9b5ccab). Conventions: `docs/superpowers/plans/2026-09-26-question-message.md`.
- The jump path reused here landed with that plan's Task 1: `anchorOf`, `ScrollRequest` and the `SessionPage` scroll effect.
- The resolve flash pattern landed in f48d94c and 593c3cd.

## Global Constraints

- Module path `github.com/lukaszfiszer/tandem`.
- Test commands:
  - Go: `go test ./...` from the repo root, and `gofmt -l internal e2e` must list nothing;
  - web: `cd web && npm test`;
  - typecheck: `cd web && npm run typecheck`;
  - Playwright: `cd web && npm run e2e`.
- No new dependencies (Go or npm).
- Wire name: `Message.answerTo` (Go `AnswerTo`, JSON `answerTo`, omitted when empty). It holds the question id `q_N` and is set only on the user message that `question.answered` appends. `question.answered` and every other event payload stay unchanged.
- Header links:
  - the answer's header reads the question's first line (the same title as its `q_N` chip) and links to `#q_N`;
  - the choice header keeps its text `Chose: <title>` and links to `#o_N`;
  - both carry `title="id: <id>"` and class `msg-ref`, and CSS truncates them with an ellipsis at the chip's `max-width: 16rem`.
- The undelivered rule, verbatim from the spec: `msg.seq > delivered` and `msg.seq > thread.lastAiSeq`. The class is `is-undelivered`: muted text and a dashed border. Line comments (`.line-note`) keep their current look. The status line copy `Sent · waiting for the AI to pick it up` is unchanged.
- Jump highlight:
  - class `is-jump-target`, a soft `--accent` tint that fades out over `1s`;
  - with `prefers-reduced-motion`, a static tint;
  - either way, it clears after `JUMP_HIGHLIGHT_MS = 1000`, and it plays on every jump, including a repeated click on the same chip or header.
- Guide sentences (Task 5 pins them):
  - loop step 1: do not pass `--no-open` unless the user asks, because the user needs the page open in their browser;
  - resuming: run `tdm session show`, then `tdm open`, so the user has the page in front of them.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 6**, as its own `build(web): …` commit. `npm run e2e` runs `vite build`, which rewrites it. If any earlier step touches it, discard with `git checkout internal/daemon/webdist`.
- Test rules:
  - `SessionPage` scroll, hash and highlight assertions use `await waitFor(...)`. Do not add `useLayoutEffect` to production code to fix test timing.
  - New tests assert only what the change adds, and fail before it. A test that is expected to pass on its first run is named a "pin test".
- Commit messages use conventional style (`feat(domain): …`, `feat(web): …`, `docs(guide): …`, `test(e2e): …`, `build(web): …`). They carry **no** `Co-Authored-By` or other trailer (repo convention).
- Run the tasks in order.

## Review Focus

1. **A repeated jump to the same target.** A second click on the same chip or header within the 1 s window must restart the highlight. The first click's timer must not clear the second one early. Pinned in Task 4 (`motion.test.ts` "plays again on a repeated jump…", and `SessionPage.test.tsx` "highlights the question an answer header jumps to, again on a repeated click").
2. **An Other answer.** `Answered: "<text>"` must link to its question as well as an option answer does. Pinned in Task 1 (`TestAnswerQuestion`, whose `other` case asserts `AnswerTo`).
3. **A long or multi-line question.** The header shows only the first line, cut with an ellipsis like a chip. Pinned in Task 1: the contract fixture's question has two lines. Also pinned in Task 2 (`timeline.test.ts` `answeredQuestion`, `ThreadView.test.tsx` header test, `messages.test.ts` CSS test).
4. **An undelivered message on a resolved thread, and in a read-only session.**
   - Choose & resolve appends a user message that the agent still receives through `tdm wait`. It stays muted until delivered, although the status line is hidden on resolved threads.
   - A read-only session never mutes anything, because nothing will be delivered.
   - Pinned in Task 3 (`delivery.test.ts`, and `ThreadView.test.tsx` "mutes an undelivered message on a resolved thread too…").
5. **A log written before this change.** Replaying it must give old answer messages their `answerTo`, because the field is derived in the reducer. Pinned in Task 1 (`TestReplayQuestionEvents`).

---

### Task 1: Domain: link an answer's user message to its question

**Files:**
- Modify: `internal/domain/state.go` (the `Message` struct)
- Modify: `internal/domain/reducer.go` (`EvQuestionAnswered`, new `userAnswer`)
- Modify: `internal/daemon/contract_test.go` (ask and answer a question in `t_2`)
- Regenerate: `web/src/test/fixtures/snapshot.json`
- Modify: `web/src/api/types.ts` (`Message.answerTo`)
- Test: `internal/domain/question_test.go`, `web/src/api/types.test.ts`, `web/src/thread/ThreadView.test.tsx` (one existing test adjusted for the fixture)

**Interfaces:**
- Consumes: `AnswerMessage(q, a)`, `State.Question(id)`, and the `QuestionAnswered` payload (`ThreadID`, `QuestionID`, `OptionID`, `Other`).
- Produces:
  - Go `Message.AnswerTo string` with JSON `answerTo,omitempty`;
  - TS `Message.answerTo?: string`;
  - contract fixture thread `t_2` with these messages:
    - `[0]` the choice `Simpler.` (seq 16);
    - `[1]` the answered question `q_2`, seq 20, text `"Cache user lookups too?\nOnly the hot paths."`, options `o_5` Yes / `o_6` No, answered `o_5`;
    - `[2]` `{actor: 'user', text: 'Answered: Yes', seq: 21, answerTo: 'q_2'}`;
    - `[3]` the AI's `Noted: user lookups are cached too.` (seq 22). Its `lastAiSeq` of 22 keeps every `t_2` user message delivered.

- [ ] **Step 1: Write the failing Go tests**

In `internal/domain/question_test.go`, in `TestAnswerQuestion`, replace

```go
			if msg.Actor != ActorUser || msg.Text != tc.text || msg.Seq != 5 || msg.Question != nil {
```

with

```go
			// Demo 6 follow-ups 1: the answer names its question, for option and Other answers alike.
			if msg.Actor != ActorUser || msg.Text != tc.text || msg.Seq != 5 || msg.Question != nil || msg.AnswerTo != "q_1" {
```

In `TestReplayQuestionEvents`, after the first `if … { t.Fatalf("replayed thread = …") }` block, add:

```go
	// Review Focus 5: answerTo is derived by the reducer, so a log written before it existed
	// replays into it.
	if got := replayed.Threads["t_1"].Messages[1].AnswerTo; got != "q_1" {
		t.Fatalf("replayed answer message links to %q, want q_1", got)
	}
```

After `TestMessageQuestionJSON`, add:

```go
// Demo 6 follow-ups 1: the answer's user message carries its question id; other messages omit it.
func TestAnswerMessageJSON(t *testing.T) {
	b, _ := json.Marshal(Message{Actor: ActorUser, Text: "Answered: No", Seq: 5, AnswerTo: "q_1"})
	if want := `{"actor":"user","text":"Answered: No","seq":5,"answerTo":"q_1"}`; string(b) != want {
		t.Fatalf("json = %s, want %s", b, want)
	}
	b, _ = json.Marshal(Message{Actor: ActorUser, Text: "Hi", Seq: 6})
	if want := `{"actor":"user","text":"Hi","seq":6}`; string(b) != want {
		t.Fatalf("json = %s, want %s", b, want)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/domain/`
Expected: FAIL to build, with `msg.AnswerTo undefined (type Message has no field or method AnswerTo)`.

- [ ] **Step 3: Add the field and set it in the reducer**

In `internal/domain/state.go`, replace

```go
	Question *MessageQuestion `json:"question,omitempty"`
}
```

with

```go
	Question *MessageQuestion `json:"question,omitempty"`
	AnswerTo string           `json:"answerTo,omitempty"` // the question (q_N) an answer message answers
}
```

In `internal/domain/reducer.go`, in `case EvQuestionAnswered:`, replace

```go
		t.userMessage(AnswerMessage(q, *q.Answer), e.Seq)
```

with

```go
		t.userAnswer(AnswerMessage(q, *q.Answer), q.ID, e.Seq)
```

and after `userChoice` add:

```go
// userAnswer records a question's answer as a user message that names the question, so the page
// can link back to it (demo 6 follow-ups 1), like userChoice names the chosen option.
func (t *Thread) userAnswer(text, questionID string, seq int64) {
	t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: text, Seq: seq, AnswerTo: questionID})
	t.LastUserSeq = seq
}
```

- [ ] **Step 4: Run the domain tests**

Run: `gofmt -l internal e2e; go test ./internal/domain/`
Expected: `gofmt` lists nothing; PASS.

- [ ] **Step 5: Put an answered question in the contract fixture, and write the web test**

In `internal/daemon/contract_test.go`, replace

```go
	run(&domain.WithdrawQuestion{QuestionID: "q_1"})
```

with

```go
	run(&domain.WithdrawQuestion{QuestionID: "q_1"})
	// Demo 6 follow-ups 1: an answered question and its linked answer message. A two-line question
	// pins that headers show the first line. The AI's reply after it keeps t_2's user messages
	// delivered (msg.seq <= lastAiSeq), as before.
	run(&domain.Ask{ThreadID: "t_2", Text: "Cache user lookups too?\nOnly the hot paths.", Options: []string{"Yes", "No"}})
	run(&domain.AnswerQuestion{QuestionID: "q_2", OptionID: "o_5"})
	run(&domain.Say{ThreadID: "t_2", Text: "Noted: user lookups are cached too."})
```

In `web/src/api/types.test.ts`, inside `describe('question messages (question message spec)', …)`, add:

```ts
  it('links the answer message to its question (demo 6 follow-ups 1)', () => {
    const t2 = normalizeSnapshot(fixture).state.threads.t_2
    expect(t2.messages[1].question?.id).toBe('q_2')
    expect(t2.messages[2]).toEqual({ actor: 'user', text: 'Answered: Yes', seq: 21, answerTo: 'q_2' })
  })
```

- [ ] **Step 6: Run them to see them fail**

Run: `go test ./internal/daemon/ -run TestSnapshotContractFixture`
Expected: FAIL, `snapshot JSON differs from ../../web/src/test/fixtures/snapshot.json`.

Run: `cd web && npx vitest run src/api/types.test.ts`
Expected: FAIL in `links the answer message to its question`, because `t2.messages[1]` is undefined.

- [ ] **Step 7: Regenerate the fixture and add the TS field**

Run: `go test ./internal/daemon/ -run TestSnapshotContractFixture -update`
Expected: `ok`. `git diff --stat web/src/test/fixtures/snapshot.json` shows only that file changed. `t_2` now has four messages, the third being `{"actor": "user", "text": "Answered: Yes", "seq": 21, "answerTo": "q_2"}`, and `lastSeq` is 22.

In `web/src/api/types.ts`, in `interface Message`, after the `question?: MessageQuestion` line add:

```ts
  /** Set on the user message an answer adds: the question (q_N) it answers (demo 6 follow-ups 1). */
  answerTo?: string
```

- [ ] **Step 8: Adjust the one web test that counts t_2's user messages**

`t_2` now has a second user message (the answer, seq 21). One existing test adds a textless choice at seq 18 and expects exactly two user messages.

In `web/src/thread/ThreadView.test.tsx`, in `'shows a textless choice as its own entry with only the header'`, replace

```tsx
      messages: [...t2.messages, { actor: 'user', text: '', seq: 18, choice: { blockId: 'b_3', optionId: 'o_1' } }],
```

with

```tsx
      // Only the fixture's first message: its later answer (seq 21) would sort after this one.
      messages: [t2.messages[0], { actor: 'user', text: '', seq: 18, choice: { blockId: 'b_3', optionId: 'o_1' } }],
```

In `'hides the delivery status once the AI has acted on the message (F12b-1)'`, replace the comment

```tsx
    // t_2's latest message is the user's "Simpler." (seq 16), but lastAiSeq is 17: the AI has
    // already acted, so no status line shows.
```

with

```tsx
    // t_2's latest user message is "Answered: Yes" (seq 21), but lastAiSeq is 22: the AI has
    // already acted, so no status line shows.
```

- [ ] **Step 9: Run everything touched**

Run: `go test ./... && (cd web && npm test && npm run typecheck)`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git status --short   # expect internal/domain, internal/daemon/contract_test.go, web/src only; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add internal/domain/state.go internal/domain/reducer.go internal/domain/question_test.go internal/daemon/contract_test.go web/src/test/fixtures/snapshot.json web/src/api/types.ts web/src/api/types.test.ts web/src/thread/ThreadView.test.tsx
git commit -m "feat(domain): link an answer's user message to its question

The Answered message carries answerTo (q_N), set by the reducer from
question.answered, so the page can link back to the question."
```

---

### Task 2: Web: answer and choice headers link to their question or option

**Files:**
- Modify: `web/src/refs/ids.ts` (`questionTitle`, used by `idTitles`)
- Modify: `web/src/thread/timeline.ts` (`QuestionRef`, `answeredQuestion`)
- Modify: `web/src/thread/MessageView.tsx` (header links)
- Modify: `web/src/thread/ThreadView.tsx` (passes `question`)
- Modify: `web/src/styles/app.css` (`.msg-ref` replaces the `.msg-choice` rules)
- Create: `web/src/styles/messages.test.ts`
- Test: `web/src/thread/timeline.test.ts`, `web/src/thread/ThreadView.test.tsx`, `web/src/shell/SessionPage.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1's `Message.answerTo` and the fixture's `t_2` (`q_2` titled `Cache user lookups too?`, the answer message `messages[2]`);
  - `anchorOf`, `useCurrentItem` and the `SessionPage` scroll effect, unchanged.
- Produces:
  - `questionTitle(text: string): string` in `web/src/refs/ids.ts`;
  - `interface QuestionRef { id: string; title: string }` and `answeredQuestion(thread: Thread, message: Message): QuestionRef | undefined` in `web/src/thread/timeline.ts`;
  - a `MessageView` prop `question?: QuestionRef`;
  - CSS class `msg-ref`, and the file `web/src/styles/messages.test.ts` (Task 3 appends to it).

- [ ] **Step 1: Write the failing tests**

In `web/src/thread/timeline.test.ts`, replace the import

```ts
import { choiceTitle, lineCommentsLabel, sentComments, timeline } from './timeline'
```

with

```ts
import { answeredQuestion, choiceTitle, lineCommentsLabel, sentComments, timeline } from './timeline'
```

and add inside `describe('timeline', …)`:

```ts
  // Demo 6 follow-ups 1: an answer names its question by the question's first line.
  it('finds the question an answer message answers', () => {
    const t2 = fixtureSnapshot().state.threads.t_2
    expect(answeredQuestion(t2, t2.messages[2])).toEqual({ id: 'q_2', title: 'Cache user lookups too?' })
    expect(answeredQuestion(t2, t2.messages[0])).toBeUndefined()
    expect(answeredQuestion({ ...t2, messages: [] }, t2.messages[2])).toEqual({ id: 'q_2', title: 'q_2' })
  })
```

In `web/src/thread/ThreadView.test.tsx`, add a new `describe` after `describe('ThreadView line comment header (follow-ups A)', …)`:

```tsx
describe('ThreadView header links (demo 6 follow-ups 1)', () => {
  it('heads an answer with the first line of its question, linking to the question', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    const link = screen.getByRole('link', { name: 'Cache user lookups too?' })
    expect(link).toHaveAttribute('href', '#q_2')
    expect(link).toHaveAttribute('title', 'id: q_2')
    expect(link).toHaveClass('msg-ref')
    expect(link.closest('.msg-user')).toHaveTextContent(/^Cache user lookups too\?Answered: Yes$/)
  })

  it('links a choice header to its option', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    const link = screen.getByRole('link', { name: 'Chose: Lazy delegate' })
    expect(link).toHaveAttribute('href', '#o_2')
    expect(link).toHaveAttribute('title', 'id: o_2')
    expect(link).toHaveClass('msg-ref')
  })
})
```

In `web/src/shell/SessionPage.test.tsx`, add after `'opens the thread of a question chip and scrolls to the question (question message spec)'`:

```tsx
  // Demo 6 follow-ups 1: a header link jumps like a chip: to the question an answer answers, and to
  // the option a choice chose.
  it('jumps from an answer header to its question, and from a choice header to its option', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.location.hash = '#t_2'
      render(<SessionPage sid="s_fixture" />)
      load()
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      await waitFor(() => expect(scrolled).toContain(document.querySelector('[data-question="q_2"]')))
      await waitFor(() => expect(window.location.hash).toBe('#t_2'))
      expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('link', { name: 'Chose: Lazy delegate' }))
      await waitFor(() => expect(scrolled).toContain(document.querySelector('[data-option="o_2"]')))
      await waitFor(() => expect(window.location.hash).toBe('#t_2'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
```

Create `web/src/styles/messages.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('user message header links (demo 6 follow-ups 1)', () => {
  it('cut a long question with an ellipsis, like a chip', () => {
    const rule = appCss.match(/\.msg-ref\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    for (const decl of ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap', 'max-width: 16rem'])
      expect(rule![1]).toContain(decl)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/thread/timeline.test.ts src/thread/ThreadView.test.tsx src/shell/SessionPage.test.tsx src/styles/messages.test.ts`
Expected: FAIL.
- `answeredQuestion` is not exported: `timeline.test.ts` fails with `answeredQuestion is not a function`.
- There is no link named `Cache user lookups too?`, and none named `Chose: Lazy delegate` (it is a `div` today).
- `.msg-ref` has no rule.

- [ ] **Step 3: Name a question by its first line in one place**

In `web/src/refs/ids.ts`, before `idTitles`, add:

```ts
// questionTitle is how a question is named in its q_N chip and in its answer's header (demo 6
// follow-ups 1): its first line. CSS truncates it.
export function questionTitle(text: string): string {
  return text.trim().split('\n', 1)[0]
}
```

and in `idTitles` replace

```ts
      pairs.push([m.question.id, m.text.trim().split('\n', 1)[0]])
```

with

```ts
      pairs.push([m.question.id, questionTitle(m.text)])
```

- [ ] **Step 4: Find the question an answer answers**

In `web/src/thread/timeline.ts`, add the import

```ts
import { questionTitle } from '../refs/ids'
```

and after `choiceTitle` add:

```ts
// QuestionRef names the question an answer message answers, by id and by title.
export interface QuestionRef {
  id: string
  title: string
}

// answeredQuestion is the question a user message answers (Message.answerTo), titled by the
// question's first line like its q_N chip, or by its id when the question is not in the thread.
// Undefined for any other message (demo 6 follow-ups 1).
export function answeredQuestion(thread: Thread, message: Message): QuestionRef | undefined {
  const id = message.answerTo
  if (!id) return undefined
  const asked = thread.messages.find((m) => m.question?.id === id)
  return { id, title: asked ? questionTitle(asked.text) : id }
}
```

- [ ] **Step 5: Render both headers as links**

Replace `web/src/thread/MessageView.tsx` with:

```tsx
import type { Message } from '../api/types'
import { Prose } from '../markdown/Prose'
import { lineCommentsLabel, type QuestionRef } from './timeline'

// `status`, when given, is the delivery status line shown under the user's latest message
// (see delivery.ts): null once the AI has acted on it, otherwise a short "sent"/"replying" note.
// `choice` is the title of the variant option the message was sent with (feature review t_3), and
// `question` the question an answer message answers. Each heads the message as a plain link to
// #<id>, like an id chip: useCurrentItem opens the item's thread and SessionPage scrolls to it
// (demo 6 follow-ups 1). `comments` is how many line comments went with it. Its header jumps to
// them via `onShowComments` (follow-ups A). A header may stand alone, as the text may be empty.
export function MessageView({
  message,
  status,
  choice,
  question,
  comments = 0,
  onShowComments,
}: {
  message: Message
  status?: string | null
  choice?: string
  question?: QuestionRef
  comments?: number
  onShowComments?: () => void
}) {
  if (message.actor === 'user')
    return (
      <>
        <div className="msg-user">
          {question && (
            <a className="msg-ref" href={`#${question.id}`} title={`id: ${question.id}`}>
              {question.title}
            </a>
          )}
          {choice && message.choice && (
            <a className="msg-ref msg-choice" href={`#${message.choice.optionId}`} title={`id: ${message.choice.optionId}`}>
              {`Chose: ${choice}`}
            </a>
          )}
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

In `web/src/thread/ThreadView.tsx`, replace

```tsx
import { choiceTitle, sentComments, timeline } from './timeline'
```

with

```tsx
import { answeredQuestion, choiceTitle, sentComments, timeline } from './timeline'
```

and replace

```tsx
            choice={choiceTitle(state, item.message)}
```

with

```tsx
            choice={choiceTitle(state, item.message)}
            question={answeredQuestion(thread, item.message)}
```

- [ ] **Step 6: Style the header links**

In `web/src/styles/app.css`, replace

```css
.msg-choice { font: 600 0.75rem var(--font-ui); color: var(--muted); }
.msg-choice:not(:last-child) { margin-bottom: 2px; }
```

with

```css
/* Demo 6 follow-ups 1: a user message is headed by a link to what it answers or chose. Like an id
   chip, a long question is cut with an ellipsis. */
.msg-ref {
  display: block;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 0.75rem var(--font-ui);
  color: var(--muted);
  text-decoration: none;
}
.msg-ref:hover { color: var(--fg); text-decoration: underline; }
.msg-ref:not(:last-child) { margin-bottom: 2px; }
```

- [ ] **Step 7: Run the tests**

Run: `cd web && npx vitest run src/thread/timeline.test.ts src/thread/ThreadView.test.tsx src/shell/SessionPage.test.tsx src/styles/messages.test.ts src/refs`
Expected: PASS, including the existing `'heads a message sent with a variant choice with "Chose: <option>"'` (it queries `.msg-choice`, which the link keeps) and the `q_N` chip tests in `src/refs`.

- [ ] **Step 8: Run all web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src
git commit -m "feat(web): link answer and choice headers to their question or option

An Answered message is headed by its question's first line and a Chose
message by its option; both jump like id chips."
```

---

### Task 3: Web: undelivered user messages look muted

**Files:**
- Modify: `web/src/thread/delivery.ts` (`isUndelivered`; `deliveryStatus` uses it)
- Modify: `web/src/thread/MessageView.tsx` (`undelivered` prop)
- Modify: `web/src/thread/ThreadView.tsx` (passes `undelivered`)
- Modify: `web/src/styles/app.css` (`.msg-user` border, `.msg-user.is-undelivered`)
- Test: `web/src/thread/delivery.test.ts`, `web/src/thread/ThreadView.test.tsx`, `web/src/styles/messages.test.ts`

**Interfaces:**
- Consumes: `Thread.lastAiSeq`, `State.delivered`, `readOnly` from `useSessionCtx`, and Task 2's `MessageView` and `messages.test.ts`.
- Produces: `isUndelivered(msgSeq: number, thread: Thread, delivered: number): boolean` in `web/src/thread/delivery.ts`, a `MessageView` prop `undelivered?: boolean`, and the CSS class `is-undelivered`.

- [ ] **Step 1: Write the failing tests**

In `web/src/thread/delivery.test.ts`, replace the import

```ts
import { deliveryStatus, isReplying, stageAwaitsSummary, threadIsReplying } from './delivery'
```

with

```ts
import { deliveryStatus, isReplying, isUndelivered, stageAwaitsSummary, threadIsReplying } from './delivery'
```

and add at the end of the file:

```ts
// Demo 6 follow-ups 2: the same rule as deliveryStatus's "Sent · waiting…", without the
// resolved-thread exclusion: delivery still advances on a resolved thread (Review Focus 4).
describe('isUndelivered', () => {
  it('is true only past both what was delivered and the AI’s last action', () => {
    expect(isUndelivered(15, thread, 0)).toBe(true)
    expect(isUndelivered(8, thread, 7)).toBe(true)
    expect(isUndelivered(15, thread, 15)).toBe(false)
    expect(isUndelivered(7, thread, 0)).toBe(false)
    expect(isUndelivered(5, thread, 0)).toBe(false)
  })

  it('holds on a resolved thread too', () => {
    expect(isUndelivered(15, { ...thread, status: 'resolved' }, 0)).toBe(true)
  })
})
```

In `web/src/thread/ThreadView.test.tsx`, add a new `describe` after `describe('ThreadView header links (demo 6 follow-ups 1)', …)`:

```tsx
describe('ThreadView undelivered messages (demo 6 follow-ups 2)', () => {
  it('mutes a user message until the AI receives it', () => {
    // t_1's "Overall fine." (seq 15) is past t_1's lastAiSeq (7) and the fixture's delivered (0).
    const first = renderStateful(<ThreadView threadId="t_1" />)
    expect(first.container.querySelector('.msg-user')).toHaveClass('is-undelivered')
    first.unmount()
    const base = makeCtx()
    base.state.delivered = 15
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(container.querySelector('.msg-user')).not.toHaveClass('is-undelivered')
  })

  // Review Focus 4.
  it('mutes an undelivered message on a resolved thread too, but never in a read-only session', () => {
    const base = makeCtx()
    base.state.threads.t_1 = { ...base.state.threads.t_1, status: 'resolved', conclusion: 'Keep the repository.' }
    const first = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(first.container.querySelector('.msg-user')).toHaveClass('is-undelivered')
    first.unmount()
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { readOnly: true })
    expect(container.querySelector('.msg-user')).not.toHaveClass('is-undelivered')
  })

  it('pin test: messages the AI has acted on keep the normal style', () => {
    // t_2's user messages (seq 16 and 21) are both at or below its lastAiSeq (22).
    const { container } = renderStateful(<ThreadView threadId="t_2" />)
    expect(container.querySelectorAll('.msg-user')).toHaveLength(2)
    expect(container.querySelector('.msg-user.is-undelivered')).toBeNull()
  })
})
```

Append to `web/src/styles/messages.test.ts`:

```ts
describe('undelivered user messages (demo 6 follow-ups 2)', () => {
  it('are muted with a dashed border, without shifting the layout when they switch', () => {
    const rule = appCss.match(/\.msg-user\.is-undelivered\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('border-style: dashed')
    expect(rule![1]).toContain('color: var(--muted)')
    // The normal bubble keeps a transparent 1px border, so the dashed one takes no extra room.
    expect(appCss).toMatch(/\.msg-user\s*{[^}]*border: 1px solid transparent/)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/thread/delivery.test.ts src/thread/ThreadView.test.tsx src/styles/messages.test.ts`
Expected: FAIL.
- `isUndelivered is not a function`.
- No `.msg-user` has `is-undelivered`: the first two new ThreadView tests fail, and the pin test passes.
- There is no `.msg-user.is-undelivered` rule.

- [ ] **Step 3: Share the rule in delivery.ts**

In `web/src/thread/delivery.ts`, replace

```ts
export function deliveryStatus(msgSeq: number, thread: Thread, delivered: number): string | null {
  if (thread.status === 'resolved') return null
  if (msgSeq <= thread.lastAiSeq) return null
  if (msgSeq > delivered) return 'Sent · waiting for the AI to pick it up'
  return null
}
```

with

```ts
export function deliveryStatus(msgSeq: number, thread: Thread, delivered: number): string | null {
  if (thread.status === 'resolved') return null
  return isUndelivered(msgSeq, thread, delivered) ? 'Sent · waiting for the AI to pick it up' : null
}

// isUndelivered is true while the AI has not received a user message yet: past what was
// delivered to the agent and past the AI's last action in the thread. It is deliveryStatus's
// rule. It skips deliveryStatus's resolved-thread exclusion, because `tdm wait` still delivers a
// message that resolved its thread (Choose & resolve), so the muted style clears on its own
// (demo 6 follow-ups 2).
export function isUndelivered(msgSeq: number, thread: Thread, delivered: number): boolean {
  return msgSeq > delivered && msgSeq > thread.lastAiSeq
}
```

- [ ] **Step 4: Mark the bubble**

In `web/src/thread/MessageView.tsx`, replace

```tsx
// (demo 6 follow-ups 1). `comments` is how many line comments went with it. Its header jumps to
// them via `onShowComments` (follow-ups A). A header may stand alone, as the text may be empty.
export function MessageView({
  message,
  status,
  choice,
  question,
  comments = 0,
  onShowComments,
}: {
  message: Message
  status?: string | null
  choice?: string
  question?: QuestionRef
  comments?: number
  onShowComments?: () => void
}) {
  if (message.actor === 'user')
    return (
      <>
        <div className="msg-user">
```

with

```tsx
// (demo 6 follow-ups 1). `comments` is how many line comments went with it. Its header jumps to
// them via `onShowComments` (follow-ups A). A header may stand alone, as the text may be empty.
// `undelivered` mutes the bubble while the AI has not received it (demo 6 follow-ups 2).
export function MessageView({
  message,
  status,
  choice,
  question,
  comments = 0,
  onShowComments,
  undelivered = false,
}: {
  message: Message
  status?: string | null
  choice?: string
  question?: QuestionRef
  comments?: number
  onShowComments?: () => void
  undelivered?: boolean
}) {
  if (message.actor === 'user')
    return (
      <>
        <div className={undelivered ? 'msg-user is-undelivered' : 'msg-user'}>
```

In `web/src/thread/ThreadView.tsx`, replace

```tsx
import { deliveryStatus, threadIsReplying } from './delivery'
```

with

```tsx
import { deliveryStatus, isUndelivered, threadIsReplying } from './delivery'
```

and replace

```tsx
            question={answeredQuestion(thread, item.message)}
```

with

```tsx
            question={answeredQuestion(thread, item.message)}
            undelivered={!readOnly && item.message.actor === 'user' && isUndelivered(item.message.seq, thread, state.delivered)}
```

- [ ] **Step 5: Style it**

In `web/src/styles/app.css`, in the `.msg-user` rule, replace

```css
  border-radius: 12px 12px 2px 12px;
  font: 0.84375rem/1.5 var(--font-ui);
  white-space: pre-wrap;
}
```

with

```css
  border: 1px solid transparent;
  border-radius: 12px 12px 2px 12px;
  font: 0.84375rem/1.5 var(--font-ui);
  white-space: pre-wrap;
}
/* Demo 6 follow-ups 2: a message the AI has not received yet is muted, with a dashed border, until
   it is delivered. The base rule's transparent border keeps the switch from shifting the layout. */
.msg-user.is-undelivered { background: transparent; border-style: dashed; border-color: var(--faint); color: var(--muted); }
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run src/thread/delivery.test.ts src/thread/ThreadView.test.tsx src/styles/messages.test.ts`
Expected: PASS, including the existing `deliveryStatus` tests.

- [ ] **Step 7: Run all web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src
git commit -m "feat(web): mute user messages the AI has not received yet

Until the agent picks a message up it renders muted with a dashed border,
by the same rule as the Sent · waiting status line."
```

---

### Task 4: Web: highlight the target of a jump

**Files:**
- Modify: `web/src/shell/motion.ts` (`JUMP_HIGHLIGHT_MS`, `highlightJumpTarget`)
- Create: `web/src/shell/motion.test.ts`
- Modify: `web/src/shell/SessionPage.tsx` (the scroll effect highlights its target)
- Modify: `web/src/styles/app.css` (`.is-jump-target`, `@keyframes tdm-jump`, reduced motion)
- Create: `web/src/styles/jump.test.ts`
- Test: `web/src/shell/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `ScrollRequest` from `useCurrentItem`, which is a new object per visit. Also Task 2's header links, and the fixture's `q_2` in `t_2`.
- Produces: `JUMP_HIGHLIGHT_MS = 1000` and `highlightJumpTarget(el: HTMLElement): void` in `web/src/shell/motion.ts`, plus the CSS class `is-jump-target`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/shell/motion.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { highlightJumpTarget, JUMP_HIGHLIGHT_MS } from './motion'

describe('highlightJumpTarget (demo 6 follow-ups 3)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tints the target for about a second', () => {
    expect(JUMP_HIGHLIGHT_MS).toBe(1000)
    const el = document.createElement('section')
    highlightJumpTarget(el)
    expect(el).toHaveClass('is-jump-target')
    vi.advanceTimersByTime(JUMP_HIGHLIGHT_MS - 1)
    expect(el).toHaveClass('is-jump-target')
    vi.advanceTimersByTime(1)
    expect(el).not.toHaveClass('is-jump-target')
  })

  // Review Focus 1.
  it('plays again on a repeated jump, and the earlier timer does not cut it short', () => {
    const el = document.createElement('section')
    highlightJumpTarget(el)
    vi.advanceTimersByTime(600)
    highlightJumpTarget(el)
    vi.advanceTimersByTime(600) // the first jump's timer would have fired by now
    expect(el).toHaveClass('is-jump-target')
    vi.advanceTimersByTime(JUMP_HIGHLIGHT_MS - 600)
    expect(el).not.toHaveClass('is-jump-target')
  })
})
```

Create `web/src/styles/jump.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('jump highlight (demo 6 follow-ups 3)', () => {
  it('fades a soft accent tint out over a second', () => {
    expect(appCss).toMatch(/\.is-jump-target\s*{[^}]*animation:\s*tdm-jump 1s ease-out/)
    const frames = appCss.match(/@keyframes tdm-jump\s*{([\s\S]*?)\n}/)
    expect(frames).not.toBeNull()
    expect(frames![1]).toMatch(/background-color:\s*color-mix\(in srgb, var\(--accent\)/)
  })

  it('shows a static tint under prefers-reduced-motion', () => {
    const reduced = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join('\n')
    const rule = reduced.match(/\.is-jump-target\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('animation: none')
    expect(rule![1]).toMatch(/background-color:\s*color-mix\(in srgb, var\(--accent\)/)
  })
})
```

In `web/src/shell/SessionPage.test.tsx`, add after `'jumps from an answer header to its question, and from a choice header to its option'`:

```tsx
  // Demo 6 follow-ups 3: the option or question a jump lands on is highlighted.
  it('highlights the option an option chip jumps to', async () => {
    Element.prototype.scrollIntoView = function () {}
    try {
      const snap = structuredClone(fixture)
      snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache uses o_2.'
      window.location.hash = '#t_1'
      render(<SessionPage sid="s_fixture" />)
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      await userEvent.click(screen.getByRole('link', { name: 'Lazy delegate' }))
      await waitFor(() => expect(document.querySelector('[data-option="o_2"]')).toHaveClass('is-jump-target'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Review Focus 1: a repeated click on the same header plays the highlight again.
  it('highlights the question an answer header jumps to, again on a repeated click', async () => {
    Element.prototype.scrollIntoView = function () {}
    try {
      window.location.hash = '#t_2'
      render(<SessionPage sid="s_fixture" />)
      load()
      const question = () => document.querySelector('[data-question="q_2"]')!
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      await waitFor(() => expect(question()).toHaveClass('is-jump-target'))
      // Stand in for the timer that clears the tint, then click the same header again.
      question().classList.remove('is-jump-target')
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      await waitFor(() => expect(question()).toHaveClass('is-jump-target'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/shell/motion.test.ts src/styles/jump.test.ts src/shell/SessionPage.test.tsx`
Expected: FAIL.
- `highlightJumpTarget` is not exported from `./motion`.
- `app.css` has no `.is-jump-target` rule.
- In the two new `SessionPage` tests, `waitFor` times out without `is-jump-target`.

- [ ] **Step 3: Add the highlight helper**

Append to `web/src/shell/motion.ts`:

```ts
// JUMP_HIGHLIGHT_MS is how long the target of a jump stays tinted: app.css's tdm-jump fade runs
// this long, and under reduced motion the static tint shows for as long (demo 6 follow-ups 3).
export const JUMP_HIGHLIGHT_MS = 1000

const jumpTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

// highlightJumpTarget tints the option or question a chip or header link jumped to. Like the nav's
// resolve flash, the class is dropped on a timer, so it behaves the same with and without reduced
// motion. A repeated jump restarts it: the class comes off and back on after a reflow (restarting
// the animation), and the earlier timer is cancelled so it cannot clear the new tint early.
export function highlightJumpTarget(el: HTMLElement): void {
  clearTimeout(jumpTimers.get(el))
  el.classList.remove('is-jump-target')
  void el.offsetWidth // restart the animation on a repeated jump
  el.classList.add('is-jump-target')
  jumpTimers.set(
    el,
    setTimeout(() => {
      el.classList.remove('is-jump-target')
      jumpTimers.delete(el)
    }, JUMP_HIGHLIGHT_MS),
  )
}
```

- [ ] **Step 4: Highlight after every jump**

In `web/src/shell/SessionPage.tsx`, replace

```tsx
import { prefersReducedMotion } from './motion'
```

with

```tsx
import { highlightJumpTarget, prefersReducedMotion } from './motion'
```

and replace

```tsx
  useEffect(() => {
    if (!scrollTo) return
    const el = mainRef.current?.querySelector(scrollTo.selector)
    if (el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [scrollTo])
```

with

```tsx
  // Demo 6 follow-ups 3: the target is then tinted briefly. scrollTo is a new object on every
  // visit, so a repeated click on the same chip or header plays it again.
  useEffect(() => {
    if (!scrollTo) return
    const el = mainRef.current?.querySelector<HTMLElement>(scrollTo.selector)
    if (!el) return
    if (typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    highlightJumpTarget(el)
  }, [scrollTo])
```

- [ ] **Step 5: Style it**

In `web/src/styles/app.css`, after the `@keyframes tdm-flash { … }` block, add:

```css
/* Demo 6 follow-ups 3: the option or question a chip or header link jumped to gets a soft tint that
   fades out. highlightJumpTarget (shell/motion.ts) drops the class after JUMP_HIGHLIGHT_MS, so a
   repeated jump plays it again. */
.is-jump-target { animation: tdm-jump 1s ease-out; }
@keyframes tdm-jump {
  from { background-color: color-mix(in srgb, var(--accent) 18%, transparent); }
}
```

In the `@media (prefers-reduced-motion: reduce)` block that holds `.line-note.is-flash`, replace

```css
  .line-note.is-flash { animation: none; outline: 2px solid var(--accent); }
}
```

with

```css
  .line-note.is-flash { animation: none; outline: 2px solid var(--accent); }
  .is-jump-target { animation: none; background-color: color-mix(in srgb, var(--accent) 18%, transparent); }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run src/shell/motion.test.ts src/styles/jump.test.ts src/shell/SessionPage.test.tsx src/styles/resolved.test.ts`
Expected: PASS, including the existing option chip, question chip and header jump tests.

- [ ] **Step 7: Run all web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git status --short   # expect only web/src changes; if internal/daemon/webdist changed, git checkout internal/daemon/webdist
git add web/src
git commit -m "feat(web): highlight the option or question a jump lands on

A soft tint fades out over a second (static under reduced motion) and
plays again on every jump, including a repeated click."
```

---

### Task 5: Guide: keep the page open

**Files:**
- Modify: `internal/guide/guide.md` (loop step 1, the Resuming paragraph)
- Test: `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing guide test**

Append to `internal/guide/guide_test.go`:

```go
// Demo 6 follow-ups 4: the user needs the page open, so the agent lets session new open it and
// reopens it when resuming.
func TestGuideKeepsThePageOpen(t *testing.T) {
	for _, s := range []string{
		"Do not pass `--no-open` unless",
		"the user needs the page open in their browser",
		"run `tdm session show`, then `tdm open`",
		"so the user has the page in front of them",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `go test ./internal/guide/ -run TestGuideKeepsThePageOpen`
Expected: FAIL with four errors, starting with ``guide.md does not mention "Do not pass `--no-open` unless"``.

- [ ] **Step 3: Update the guide**

In `internal/guide/guide.md`, replace

```markdown
1. `tdm session new "<title>"` creates and opens the session. Then `tdm stage add "<title>" --goal "<what to decide>"`.
```

with

```markdown
1. `tdm session new "<title>"` creates the session and opens it in the user's browser. Do not pass `--no-open` unless
   the user asks for it: the user needs the page open in their browser. Then
   `tdm stage add "<title>" --goal "<what to decide>"`.
```

and replace

```markdown
Resuming (after a restart or lost context): run `tdm session show`. It lists stages, threads, each thread's open
question (if any), and everything under "Awaiting AI". Handle that input, then `tdm wait`.
```

with

```markdown
Resuming (after a restart or lost context): run `tdm session show`, then `tdm open`
so the user has the page in front of them. `tdm session show` lists stages, threads, each thread's open question
(if any), and everything under "Awaiting AI". Handle that input, then `tdm wait`.
```

Each phrase the test looks for must stay on one line.

- [ ] **Step 4: Run the guide and CLI tests**

Run: `go test ./internal/guide/ ./internal/cli/`
Expected: PASS. `TestGuideCoversEveryCommand` still finds every command.

- [ ] **Step 5: Commit**

```bash
git add internal/guide/guide.md internal/guide/guide_test.go
git commit -m "docs(guide): keep the page open on session new and when resuming"
```

---

### Task 6: End-to-end coverage, rebuild webdist, verify everything

**Files:**
- Modify: `web/e2e/loop.spec.ts` (new test)
- Regenerate: `internal/daemon/webdist/`

**Interfaces:**
- Consumes everything above:
  - the `is-undelivered` and `is-jump-target` classes;
  - the answer header link, named by the question's first line.
- Produces: nothing.

- [ ] **Step 1: Add the Playwright test**

Append to `web/e2e/loop.spec.ts`:

```ts
// Demo 6 follow-ups, through the real daemon and CLI: the Answered message is muted until
// `tdm wait` delivers it, and its header jumps back to the question, which lights up on every click.
test('an answer shows its delivery and links back to its question', async ({ page }) => {
  const url = run(['session', 'new', 'Cache design']).trim().split(' ')[1]
  run(['stage', 'add', 'Caching'])
  run(['thread', 'add', 'User cache'])
  expect(run(['ask', 'Cache user lookups too?', '--option', 'Yes', '--option', 'No'])).toBe('q_1 o_1 o_2\n')

  await page.goto(url)
  const q1 = page.locator('[data-question="q_1"]')
  await q1.getByRole('button', { name: 'Yes', exact: true }).click()

  // Muted until the agent picks it up, then the normal style
  const answer = page.locator('.msg-user').filter({ hasText: 'Answered: Yes' })
  await expect(answer).toHaveClass(/is-undelivered/)
  expect(run(['wait', '--timeout', '5s'])).toContain('Answered q_1 "Cache user lookups too?": o_1 "Yes".')
  await expect(answer).not.toHaveClass(/is-undelivered/)

  // The header jumps to the question and highlights it; the highlight clears and plays again
  const header = answer.getByRole('link', { name: 'Cache user lookups too?' })
  await expect(header).toHaveAttribute('href', '#q_1')
  await header.click()
  await expect(q1).toHaveClass(/is-jump-target/)
  await expect(page).toHaveURL(/#t_1$/)
  await expect(q1).not.toHaveClass(/is-jump-target/)
  await header.click()
  await expect(q1).toHaveClass(/is-jump-target/)
})
```

- [ ] **Step 2: Run the browser tests (pin test)**

Run: `cd web && npm run e2e`
Expected: all five tests PASS. The new test is a pin test: Tasks 1–4 already ship the behavior, and `npm run e2e` builds the current web UI (`vite build`) before `go build` embeds it. The run rewrites `internal/daemon/webdist/`. Step 3 rebuilds it properly.

- [ ] **Step 3: Build the web UI into webdist**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known and fine.

- [ ] **Step 4: Verify everything**

Run: `gofmt -l internal e2e; go test ./... && (cd web && npm test && npm run typecheck)`
Expected:
- `gofmt` lists no files, and all tests PASS;
- `TestPageServesBuiltUI` serves the new build;
- `TestSnapshotContractFixture` matches the Task 1 fixture.

- [ ] **Step 5: Commit the test, then the build**

```bash
git status --short   # expect web/e2e/loop.spec.ts and internal/daemon/webdist/ only
git add web/e2e/loop.spec.ts
git commit -m "test(e2e): answer delivery style and the header jump in the browser"
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the demo 6 follow-ups"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| 1. Answer header reads the question's first line, truncated like a chip | 1 (`answerTo`, fixture), 2 |
| 1. Clicking it opens the question's thread and scrolls to `[data-question="q_N"]` | 2 (`SessionPage` test), 6 |
| 1. `Chose: …` gets the same header, linking to its option | 2 |
| 2. Undelivered user message (`msg.seq > delivered` and `msg.seq > thread.lastAiSeq`) is muted with a dashed border | 3, 6 |
| 2. Switches to the normal style once the AI receives it | 3, 6 |
| 2. Line comments keep their current look | 3 (only `.msg-user` gets the class) |
| 3. A soft tint fades out over about 1 s after a chip or header jump | 4, 6 |
| 3. Static under `prefers-reduced-motion`, cleared after about 1 s | 4 (`jump.test.ts`, `motion.test.ts`) |
| 3. Plays on every jump, including a repeated click | 4, 6 (Review Focus 1) |
| 4. Loop step 1: no `--no-open` unless asked; resuming: `tdm session show` then `tdm open`; guide test | 5 |
| No new dependencies; webdist in its own `build(web): …` commit | Global Constraints, 6 |

## Spec ambiguities resolved here

- **How an answer links to its question.** Today the `Answered: …` message has no link to its question. It gains `answerTo`, derived in the reducer (see Architecture). Events stay unchanged, and replayed logs get the link.
- **"Header button" is a link.** Both headers are `<a href="#q_N">` / `<a href="#o_N">`, styled like the "N line comments" header, rather than `<button>`s.
  - This reuses the chips' hash routing, so a header and a chip share one jump path, one scroll and one highlight.
  - A link is also the right element for navigation.
  - Each carries `title="id: <id>"`, like a chip.
- **The choice header's text.** It stays `Chose: <title>` and becomes the link. The answer header shows only the question's first line, and the message text below it still reads `Answered: …`.
- **Truncation "like a chip".** `.msg-ref` uses the chip's `max-width: 16rem` with an ellipsis. The same rule applies to `Chose: …`.
- **Undelivered on a resolved thread and in a read-only session.**
  - On a resolved thread the style follows delivery: `tdm wait` still delivers the Choose & resolve message, so the style clears. This differs from the status line, which is hidden on resolved threads because `lastAiSeq` never advances there.
  - In a read-only session nothing is muted, the same as the status line.
- **Which messages are muted.** Every user message that meets the rule, including a header-only message (a textless choice, or line comments only). The line notes on blocks keep their look.
- **Which jumps highlight.** Jumps to an option or a question, from a chip or a header. `t_N` / `st_N` chips open a whole item and scroll nothing, so they get no highlight.
  - The tint is `--accent` at 18% via `color-mix`, fading over 1 s, like the resolve flash.
  - `JUMP_HIGHLIGHT_MS = 1000` clears it in both motion modes.
- **A choice in a superseded variants block.** The header still opens the thread. The card sits in a collapsed block, so the scroll and the tint land on a hidden element. This is unchanged from how option chips already behave.
- **The contract fixture.** A two-line question is asked and answered in `t_2` (`q_2`, `o_5`/`o_6`), followed by an AI reply. This keeps `t_2`'s delivery state, and `t_3`'s question tests, as they were. Only the textless choice test needed its message list narrowed.
