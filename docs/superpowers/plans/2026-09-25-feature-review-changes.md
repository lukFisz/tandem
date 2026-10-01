# Feature Review Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six changes agreed in the feature review: landing on the first unresolved thread, a draft count on Send, a "Chose: …" header on choice messages, a silent-agent indicator, user-side resolving (Resolve, Choose & resolve), and dropping the yellow border on the variant comment box.

**Architecture:** Go first. The domain links a variant choice to its user message (`Message.choice`), gains a `thread.resolve` user command and a `resolve` flag on `variant.choose`. Both reuse existing event types, so old logs still replay and `tdm wait` needs only one new header. The daemon records the agent's last CLI call per session and adds it to the snapshot as `agentSeenAt`. The web UI then reads these through `api/types.ts`: a pure `agentQuietMinutes` plus a ticking `useNow` clock drive the quiet state, and the new buttons post the new actions.

**Tech Stack:** Go 1.x (`net/http`, `encoding/json`, stdlib tests), React 19 + TypeScript + Vite, Vitest + Testing Library, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-25-feature-review-decisions.md`. Conventions: `docs/superpowers/specs/2026-09-25-tandem-design.md`, `docs/superpowers/plans/2026-09-25-tandem-web.deviations.md`.

## Global Constraints

- Module path: `github.com/lukaszfiszer/tandem`. Go tests: `go test ./...` from the repo root. Web tests: `cd web && npm test`.
- No new dependencies (Go or npm).
- No new event types. Old `events.jsonl` logs must replay unchanged. New payload fields are `omitempty`.
- UI copy, verbatim:
  - Send button: `Send`, `Send (1 comment)`, `Send (3 comments)`.
  - Choice header: `Chose: <option title>`.
  - Typing bubble: `AI quiet for <N>m, it may have stopped`.
  - Top bar: `AI not connected`.
  - Buttons: `Resolve`, `Choose & resolve`.
- Default conclusion for an empty Resolve note: `Resolved by user` (`domain.UserResolvedText`).
- `tdm wait` headers: the user's Resolve renders as `conclusion edited and accepted`; Choose & resolve renders as `variant chosen, thread resolved`.
- Silent threshold: 10 minutes, as the named constant `AGENT_QUIET_MS` in `web/src/session/agent.ts`.
- Wire contract:
  - snapshot `agentSeenAt`: unix milliseconds, omitted until the agent has been seen;
  - message `choice: { blockId, optionId }`;
  - action `thread.resolve { threadId, text? }`;
  - `variant.choose` gains `resolve?: boolean`;
  - CLI requests carry the header `X-Tandem-Client: cli` (`store.ClientHeader` / `store.ClientCLI`).
- After any Go change to the snapshot JSON, regenerate the fixture with `go test ./internal/daemon -run TestSnapshotContractFixture -update` and commit `web/src/test/fixtures/snapshot.json`.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 12** (F5 in the tandem-web deviations). UI tasks do not commit it.
- Every commit message uses conventional style and ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run the tasks sequentially. Tasks 8–11 all touch `web/src/thread/ThreadView.tsx`.

## Review Focus

1. **Old logs with a textless `variant.chosen`.** Replaying them now yields a user message with empty text and a `choice`. The timeline must show only `Chose: <title>`, with no empty text. Delivery and the typing bubble keep working off `lastUserSeq`. Pinned by the Task 2 reducer test and the Task 8 ThreadView test.
2. **A blank or whitespace-only Resolve note.** It must resolve the thread with `Resolved by user`. The UI must let the user submit an empty editor. Pinned in Task 3 (domain) and Task 10 (UI).
3. **Resolve racing the AI's proposal.** If the AI proposes a conclusion just before the user's Resolve lands, the Resolve must still succeed. The user's text wins, and the event keeps `original` = the proposal. Pinned in Task 3.
4. **A long `tdm wait` that just returned** (the user took 20 minutes to answer). The page must not flip to "AI not connected" as `waiting` turns false. `waiting: true` must always suppress the quiet state. Pinned in Task 4 (wait end counts as contact) and Task 9 (`waiting` wins).
5. **Browser and dev-proxy requests** (cookie, or Bearer without `X-Tandem-Client`) must never refresh `agentSeenAt`. A snapshot without `agentSeenAt` (daemon restarted, agent not seen yet) must never show the quiet state. Pinned in Task 4 and Task 9.

---

### Task 1: Commit the spec and this plan

**Files:**
- Add: `docs/superpowers/specs/2026-09-25-feature-review-decisions.md` (already on disk, untracked)
- Add: `docs/superpowers/plans/2026-09-25-feature-review-changes.md` (this file)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Commit both docs**

```bash
git add docs/superpowers/specs/2026-09-25-feature-review-decisions.md docs/superpowers/plans/2026-09-25-feature-review-changes.md
git commit -m "docs: feature review decisions and implementation plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain — user messages carry the variant choice

The snapshot has no link between a user message and the choice sent with it. Today `VariantChosen` folds its comment into a plain user message, and a textless choice adds no message at all. This task adds `Message.Choice` and always records a choice as a user message.

**Files:**
- Modify: `internal/domain/state.go` (the `Message` struct)
- Modify: `internal/domain/reducer.go` (the `EvVariantChosen` case, plus a new `userChoice` helper next to `userMessage`)
- Test: `internal/domain/lifecycle_test.go`
- Regenerate: `web/src/test/fixtures/snapshot.json`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `domain.Message{Actor, Text, Seq, Choice *MessageChoice}` with JSON `"choice,omitempty"`;
  - `domain.MessageChoice{BlockID string "blockId"; OptionID string "optionId"}`;
  - `(*Thread).userChoice(text string, choice MessageChoice, seq int64)`, unexported, used again in Task 3.

- [ ] **Step 1: Write the failing tests**

In `internal/domain/lifecycle_test.go`, add `"encoding/json"`, `"reflect"` and `"strings"` to the imports. Then add:

```go
// A variant choice is a user message linked to the option, even without a comment, so the UI can
// show "Chose: <option>" in the timeline (feature review t_3). Old logs replay the same way.
func TestVariantChoiceIsAUserMessage(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorUser, EvVariantChosen, VariantChosen{ThreadID: "t_1", BlockID: "b_3", OptionID: "o_1"}),
		NewEvent(ActorUser, EvVariantChosen, VariantChosen{ThreadID: "t_1", BlockID: "b_3", OptionID: "o_2", Comment: "B after all"}),
	)
	th := replay(t, evs...).Threads["t_1"]
	want := []Message{
		{Actor: ActorAI, Text: "hi", Seq: 8},
		{Actor: ActorUser, Text: "", Seq: 9, Choice: &MessageChoice{BlockID: "b_3", OptionID: "o_1"}},
		{Actor: ActorUser, Text: "B after all", Seq: 10, Choice: &MessageChoice{BlockID: "b_3", OptionID: "o_2"}},
	}
	if !reflect.DeepEqual(th.Messages, want) {
		t.Fatalf("messages = %+v", th.Messages)
	}
	if th.LastUserSeq != 10 || !th.AwaitingAI() || th.Status != ThreadOpen {
		t.Fatalf("thread = %+v", th)
	}
}

func TestMessageChoiceJSON(t *testing.T) {
	b, _ := json.Marshal(Message{Actor: ActorAI, Text: "x", Seq: 1})
	if strings.Contains(string(b), "choice") {
		t.Fatalf("message without a choice = %s", b)
	}
	b, _ = json.Marshal(Message{Actor: ActorUser, Seq: 2, Choice: &MessageChoice{BlockID: "b_1", OptionID: "o_1"}})
	if want := `{"actor":"user","text":"","seq":2,"choice":{"blockId":"b_1","optionId":"o_1"}}`; string(b) != want {
		t.Fatalf("json = %s, want %s", b, want)
	}
}
```

In `TestUserEvents` in the same file, the textless choice now adds a message after the review message. Change

```go
	if len(th.Comments) != 1 || th.Messages[len(th.Messages)-1].Text != "overall ok" {
```

to

```go
	// The textless variant choice below the review adds its own (empty-text) message last.
	if len(th.Comments) != 1 || th.Messages[len(th.Messages)-2].Text != "overall ok" {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/domain/ -run 'TestVariantChoiceIsAUserMessage|TestMessageChoiceJSON|TestUserEvents' -v`
Expected: compile FAIL, `undefined: MessageChoice` / `unknown field Choice`.

- [ ] **Step 3: Implement**

In `internal/domain/state.go`, replace the `Message` struct with:

```go
type Message struct {
	Actor  Actor          `json:"actor"`
	Text   string         `json:"text"`
	Seq    int64          `json:"seq"`
	Choice *MessageChoice `json:"choice,omitempty"`
}

// MessageChoice links a user message to the variant option chosen with it.
type MessageChoice struct {
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
}
```

In `internal/domain/reducer.go`, replace the body of `case EvVariantChosen:` after the `b == nil` check:

```go
		b.ChosenOption, b.Rejected = p.OptionID, false
		s.Threads[b.ThreadID].userChoice(p.Comment, MessageChoice{BlockID: p.BlockID, OptionID: p.OptionID}, e.Seq)
```

Add below `userMessage`:

```go
// userChoice records a variant choice as a user message, with or without a comment.
func (t *Thread) userChoice(text string, choice MessageChoice, seq int64) {
	t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: text, Seq: seq, Choice: &choice})
	t.LastUserSeq = seq
}
```

- [ ] **Step 4: Run the domain tests**

Run: `go test ./internal/domain/ -v`
Expected: PASS.

- [ ] **Step 5: Regenerate the contract fixture and run everything**

Run: `go test ./internal/daemon -run TestSnapshotContractFixture -update && git diff web/src/test/fixtures/snapshot.json`
Expected: the only change is `"choice": {"blockId": "b_3", "optionId": "o_2"}` on t_2's `Simpler.` message.

Run: `go test ./... && (cd web && npm test)`
Expected: PASS. The web types ignore the extra field until Task 5.

- [ ] **Step 6: Commit**

```bash
git add internal/domain/state.go internal/domain/reducer.go internal/domain/lifecycle_test.go web/src/test/fixtures/snapshot.json
git commit -m "feat(domain): link user messages to the variant choice sent with them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Domain — user-side resolving, `tdm wait` rendering and the agent guide

`EditConclusion` requires a pending proposal (`proposedThread`), so it cannot resolve an open thread. This task adds two things:

- a new user command `thread.resolve`. It emits the existing `conclusion.edited` event, so `tdm wait` prints `conclusion edited and accepted` unchanged;
- a `resolve` flag on `variant.choose`. It stores the conclusion on the existing `variant.chosen` event, and the reducer resolves the thread from it.

**Files:**
- Modify: `internal/domain/commands.go` (the `ChooseVariant` field, the new `ResolveThread` type and `UserResolvedText`, `isCommand`, the factory entry)
- Modify: `internal/domain/events.go` (`VariantChosen.Conclusion`)
- Modify: `internal/domain/decide.go` (the `*ChooseVariant` case, a new `*ResolveThread` case, the `choiceConclusion` helper)
- Modify: `internal/domain/reducer.go` (the `EvVariantChosen` case)
- Modify: `internal/render/wait.go` (the `EvVariantChosen` case)
- Modify: `internal/guide/guide.md` (loop steps 4–5)
- Test: `internal/domain/decide_test.go`, `internal/render/wait_test.go`, `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: `(*Thread).userChoice` and `MessageChoice` from Task 2.
- Produces:
  - `domain.ResolveThread{ThreadID string "threadId"; Text string "text,omitempty"}`, wire type `"thread.resolve"` (user actor);
  - `domain.ChooseVariant.Resolve bool "resolve,omitempty"`;
  - `domain.VariantChosen.Conclusion string "conclusion,omitempty"`, non-empty only when the choice resolved the thread;
  - `const domain.UserResolvedText = "Resolved by user"`;
  - `tdm wait` header `variant chosen, thread resolved`.

- [ ] **Step 1: Write the failing domain tests**

In `internal/domain/decide_test.go`, add these rows to the `cases` slice of `TestDecideRules`:

```go
		{"resolve needs a thread id", []Command{stage, thread, &ResolveThread{}}, CodeInvalidInput},
		{"resolve unknown thread", []Command{stage, thread, &ResolveThread{ThreadID: "t_9"}}, CodeThreadNotFound},
		{"resolve twice", []Command{stage, thread, &ResolveThread{ThreadID: "t_1"}, &ResolveThread{ThreadID: "t_1"}}, CodeThreadResolved},
		{"choose after choose and resolve", []Command{stage, thread, variants,
			&ChooseVariant{BlockID: "b_1", OptionID: "o_1", Resolve: true}, &ChooseVariant{BlockID: "b_1", OptionID: "o_2"}}, CodeThreadResolved},
```

Add these new tests to the same file:

```go
// Feature review t_7: the user can resolve an open thread; the note becomes the conclusion and the
// agent receives it as "conclusion edited and accepted" (Review Focus 2 and 3).
func TestUserResolvesThread(t *testing.T) {
	cases := []struct {
		name     string
		cmds     []Command
		want     string
		original string
	}{
		{"with a note", []Command{stage, thread, &ResolveThread{ThreadID: "t_1", Text: "Keep it as is."}}, "Keep it as is.", ""},
		{"blank note", []Command{stage, thread, &ResolveThread{ThreadID: "t_1", Text: "  \n"}}, UserResolvedText, ""},
		{"over a proposed conclusion", []Command{stage, thread, conclude, &ResolveThread{ThreadID: "t_1"}}, UserResolvedText, "done"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, events := domaintest.Build(t, tc.cmds...)
			th := s.Threads["t_1"]
			if th.Status != ThreadResolved || th.Conclusion != tc.want || th.ProposedConclusion != "" || th.AwaitingAI() {
				t.Fatalf("thread = %+v", th)
			}
			last := events[len(events)-1]
			var p ConclusionEdited
			if last.Type != EvConclusionEdited || last.Actor != ActorUser || last.Decode(&p) != nil || p.Original != tc.original || p.Text != tc.want {
				t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
			}
		})
	}
	if UserResolvedText != "Resolved by user" {
		t.Fatalf("UserResolvedText = %q", UserResolvedText)
	}
}

// Feature review t_7: "Choose & resolve" records the choice and resolves the thread with the option
// title (plus the comment) as its conclusion; a plain choice still leaves the thread open.
func TestChooseAndResolve(t *testing.T) {
	for _, tc := range []struct{ comment, want string }{
		{"", "B"},
		{" Simpler. ", "B\n\nSimpler."},
	} {
		s, events := domaintest.Build(t, stage, thread, variants,
			&ChooseVariant{BlockID: "b_1", OptionID: "o_2", Comment: tc.comment, Resolve: true})
		th := s.Threads["t_1"]
		if th.Status != ThreadResolved || th.Conclusion != tc.want || th.AwaitingAI() || s.Blocks["b_1"].ChosenOption != "o_2" {
			t.Fatalf("comment %q: thread = %+v", tc.comment, th)
		}
		msg := th.Messages[len(th.Messages)-1]
		if msg.Actor != ActorUser || msg.Text != tc.comment || msg.Choice == nil || *msg.Choice != (MessageChoice{BlockID: "b_1", OptionID: "o_2"}) {
			t.Fatalf("comment %q: message = %+v", tc.comment, msg)
		}
		var p VariantChosen
		if err := events[len(events)-1].Decode(&p); err != nil || p.Conclusion != tc.want {
			t.Fatalf("comment %q: payload = %+v, %v", tc.comment, p, err)
		}
	}
	s, _ := domaintest.Build(t, stage, thread, variants, &ChooseVariant{BlockID: "b_1", OptionID: "o_2"})
	if th := s.Threads["t_1"]; th.Status != ThreadOpen || !th.AwaitingAI() {
		t.Fatalf("plain choice: thread = %+v", th)
	}
}
```

Extend `TestDecodeCommand` (append before its closing brace):

```go
	cmd, err = DecodeCommand(ActorUser, "thread.resolve", json.RawMessage(`{"threadId":"t_1","text":"ok"}`))
	if err != nil || *cmd.(*ResolveThread) != (ResolveThread{ThreadID: "t_1", Text: "ok"}) {
		t.Fatalf("thread.resolve = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "variant.choose", json.RawMessage(`{"blockId":"b_1","optionId":"o_1","resolve":true}`))
	if err != nil || !cmd.(*ChooseVariant).Resolve {
		t.Fatalf("variant.choose resolve = %#v, %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorAI, "thread.resolve", nil); err == nil {
		t.Fatal("agent must not be able to resolve threads")
	}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go test ./internal/domain/ -v`
Expected: compile FAIL, `undefined: ResolveThread`, `unknown field Resolve`, `undefined: UserResolvedText`.

- [ ] **Step 3: Implement the commands and events**

In `internal/domain/commands.go`, replace `ChooseVariant` and add the new type after it:

```go
type ChooseVariant struct {
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
	Comment  string `json:"comment,omitempty"`
	// Resolve also resolves the thread, with the option title (plus the comment) as its conclusion.
	Resolve bool `json:"resolve,omitempty"`
}

// ResolveThread resolves a thread from the user's side, whether or not a conclusion is proposed.
// An empty text resolves it with UserResolvedText.
type ResolveThread struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text,omitempty"`
}

// UserResolvedText is the conclusion of a thread the user resolved without a note.
const UserResolvedText = "Resolved by user"
```

Add `func (*ResolveThread) isCommand() {}` to the `isCommand` list. Add `"thread.resolve": func() Command { return &ResolveThread{} },` to the `ActorUser` factory map.

In `internal/domain/events.go`, replace `VariantChosen`:

```go
type VariantChosen struct {
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
	Comment  string `json:"comment,omitempty"`
	// Conclusion is set when the choice also resolved the thread ("Choose & resolve").
	Conclusion string `json:"conclusion,omitempty"`
}
```

- [ ] **Step 4: Implement Decide**

In `internal/domain/decide.go`, replace the `case *ChooseVariant:` block:

```go
	case *ChooseVariant:
		return decideVariantAction(s, c.BlockID, func(t *Thread, b *Block) (Event, error) {
			opt := b.Variants.Option(c.OptionID)
			if opt == nil {
				return Event{}, errorf(CodeOptionNotFound, "option ids are listed in block "+b.ID, "no option %s in block %s", c.OptionID, b.ID)
			}
			p := VariantChosen{ThreadID: t.ID, BlockID: b.ID, OptionID: c.OptionID, Comment: c.Comment}
			if c.Resolve {
				p.Conclusion = choiceConclusion(opt.Title, c.Comment)
			}
			return NewEvent(ActorUser, EvVariantChosen, p), nil
		})
```

Add a new case just before `case *AcceptConclusion:`:

```go
	case *ResolveThread:
		if err := required("threadId", c.ThreadID); err != nil {
			return nil, Result{}, err
		}
		t, err := s.activeThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		text := c.Text
		if strings.TrimSpace(text) == "" {
			text = UserResolvedText
		}
		// Reuses conclusion.edited: the agent reads it as "conclusion edited and accepted". A
		// conclusion proposed meanwhile is kept as the original (Review Focus 3).
		return one(NewEvent(ActorUser, EvConclusionEdited, ConclusionEdited{ThreadID: t.ID, Original: t.ProposedConclusion, Text: text}), t.ID)
```

Add below `decideVariantAction`:

```go
// choiceConclusion is the conclusion of a thread the user resolves by choosing a variant.
func choiceConclusion(title, comment string) string {
	if c := strings.TrimSpace(comment); c != "" {
		return title + "\n\n" + c
	}
	return title
}
```

- [ ] **Step 5: Implement the reducer**

In `internal/domain/reducer.go`, replace the two lines that Task 2 put in the `EvVariantChosen` case after the `b == nil` check:

```go
		b.ChosenOption, b.Rejected = p.OptionID, false
		t := s.Threads[b.ThreadID]
		t.userChoice(p.Comment, MessageChoice{BlockID: p.BlockID, OptionID: p.OptionID}, e.Seq)
		if p.Conclusion != "" {
			t.resolve(p.Conclusion, e.Seq)
		}
```

- [ ] **Step 6: Run the domain tests**

Run: `go test ./internal/domain/ -v`
Expected: PASS.

- [ ] **Step 7: Write the failing `tdm wait` rendering test**

Add to `internal/render/wait_test.go`:

```go
// Feature review t_7: user-side resolving reaches the agent as "conclusion edited and accepted"
// (Resolve) and "variant chosen, thread resolved" (Choose & resolve), with the final text quoted.
func TestWaitUserResolved(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.ResolveThread{ThreadID: "t_1"},
		&domain.AddThread{Title: "Cache"},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindVariants},
			Variants: &domain.Variants{Options: []domain.VariantOption{{Title: "Empty map"}, {Title: "Lazy delegate"}}}},
		&domain.ChooseVariant{BlockID: "b_1", OptionID: "o_2", Comment: "Simpler.", Resolve: true},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	want := `# Stage st_1 "API" — 2/2 threads resolved

## t_1 "Endpoints" — conclusion edited and accepted

Final conclusion:
> Resolved by user

## t_2 "Cache" — variant chosen, thread resolved

Chose o_2 "Lazy delegate" (block b_1):
> Simpler.

Final conclusion:
> Lazy delegate
>
> Simpler.
`
	if got != want {
		t.Fatalf("Wait mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}
```

- [ ] **Step 8: Run it to verify it fails**

Run: `go test ./internal/render/ -run TestWaitUserResolved -v`
Expected: FAIL. The header reads `variant chosen` and the `Final conclusion` part is missing.

- [ ] **Step 9: Implement the rendering**

In `internal/render/wait.go`, replace the `case domain.EvVariantChosen:` block:

```go
	case domain.EvVariantChosen:
		var p domain.VariantChosen
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		opt := s.Blocks[p.BlockID].Variants.Option(p.OptionID)
		item := fmt.Sprintf("Chose %s %q (block %s)", opt.ID, opt.Title, p.BlockID)
		if p.Comment != "" {
			item += ":\n" + Quote(p.Comment)
		} else {
			item += ".\n"
		}
		what := "variant chosen"
		if p.Conclusion != "" {
			what = "variant chosen, thread resolved"
			item += "\nFinal conclusion:\n" + Quote(p.Conclusion)
		}
		return []section{threadSection(s, p.ThreadID, what, item)}, nil
```

Run: `go test ./internal/render/ -v`
Expected: PASS. `TestWait` is unchanged, because a plain choice still renders `variant chosen`.

- [ ] **Step 10: Write the failing guide test**

In `internal/guide/guide_test.go`, add the import `"github.com/lukaszfiszer/tandem/internal/domain"` and:

```go
// Feature review t_7: the user can resolve threads themselves. The agent must not propose a
// conclusion after "variant chosen, thread resolved", and must recognise the default note.
func TestGuideCoversUserResolvedThreads(t *testing.T) {
	for _, s := range []string{"variant chosen, thread resolved", "do not propose a conclusion", domain.UserResolvedText} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

Run: `go test ./internal/guide/ -v`
Expected: FAIL for all three strings.

- [ ] **Step 11: Update the guide**

In `internal/guide/guide.md`, replace

```
   - after a `variant chosen` event, propose the conclusion in the same turn.
5. `discussion requested` means the user rejected your conclusion: keep discussing, then conclude again.
   `conclusion accepted` or `conclusion edited and accepted` resolves the thread. Use the final text you are
   given.
```

with

```
   - after a `variant chosen` event, propose the conclusion in the same turn;
   - after `variant chosen, thread resolved`, do not propose a conclusion: the user chose and resolved the
     thread in one step, and the event quotes the final conclusion.
5. `discussion requested` means the user rejected your conclusion: keep discussing, then conclude again.
   `conclusion accepted` or `conclusion edited and accepted` resolves the thread. Use the final text you are
   given. The user can also resolve a thread you never proposed a conclusion for. You then get
   `conclusion edited and accepted` with their text (`Resolved by user` when they left no note).
```

- [ ] **Step 12: Run all Go tests**

Run: `go test ./...`
Expected: PASS. The contract fixture is unchanged, because the fixture uses no `resolve`.

- [ ] **Step 13: Commit**

```bash
git add internal/domain internal/render internal/guide
git commit -m "feat(domain): let the user resolve threads and choose-and-resolve variants

thread.resolve emits conclusion.edited (tdm wait: conclusion edited and accepted,
default note \"Resolved by user\"); variant.choose {resolve:true} stores the
conclusion on variant.chosen (tdm wait: variant chosen, thread resolved). The
agent guide says not to propose a conclusion for such threads.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Daemon — track the agent's last CLI call (`agentSeenAt`)

The CLI and the dev-server proxy both send `Authorization: Bearer`, so the token alone cannot tell the agent from a browser. This task has the CLI client mark every request with `X-Tandem-Client: cli`. The daemon touches the session on every `{sid}` route request (and on `POST /api/sessions`) that carries the header. The start and end of a `tdm wait` also count as contact. Snapshot pushes caused only by these touches are throttled to one per minute.

**Files:**
- Modify: `internal/store/daemoninfo.go` (the constants)
- Modify: `internal/client/client.go` (`Raw` sets the header)
- Modify: `internal/daemon/manager.go` (the `Session` fields, `TouchAgent`, `Snapshot`)
- Modify: `internal/daemon/wait.go` (`BeginWait` stamps contact at start and end)
- Modify: `internal/daemon/api.go` (`session()` and `createSession` touch; the `fromCLI` helper)
- Test: `internal/client/client_test.go`, create `internal/daemon/agent_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `const store.ClientHeader = "X-Tandem-Client"`, `const store.ClientCLI = "cli"`;
  - `(*daemon.Session).TouchAgent()`;
  - snapshot JSON `{"state":…,"waiting":bool,"agentSeenAt":<unix ms>}`, with `agentSeenAt` omitted while zero.

- [ ] **Step 1: Write the failing client test**

Add to `internal/client/client_test.go`:

```go
// Feature review t_6: the daemon tells the agent's CLI calls apart from the page's requests
// (the dev proxy also sends the Bearer token) by this header.
func TestRawMarksRequestsAsCLI(t *testing.T) {
	got := make(chan string, 1)
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- r.Header.Get(store.ClientHeader)
	}))
	t.Cleanup(hs.Close)
	u, _ := url.Parse(hs.URL)
	port, _ := strconv.Atoi(u.Port())
	c := New(store.DaemonInfo{Port: port, Token: "tok"})
	if _, _, err := c.Raw(context.Background(), http.MethodGet, "/x", nil); err != nil {
		t.Fatal(err)
	}
	if h := <-got; h != store.ClientCLI {
		t.Fatalf("%s = %q, want %q", store.ClientHeader, h, store.ClientCLI)
	}
}
```

- [ ] **Step 2: Write the failing daemon tests**

Create `internal/daemon/agent_test.go`:

```go
package daemon

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

var agentT0 = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)

// setClock swaps the session clock under its lock, so handler goroutines (which read it under
// the same lock) see the change without a data race.
func setClock(s *Session, now func() time.Time) {
	s.mu.Lock()
	s.now = now
	s.mu.Unlock()
}

func agentSeenAt(t *testing.T, s *Session) int64 {
	t.Helper()
	b, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var snap struct {
		AgentSeenAt int64 `json:"agentSeenAt"`
	}
	if err := json.Unmarshal(b, &snap); err != nil {
		t.Fatal(err)
	}
	return snap.AgentSeenAt
}

func TestSnapshotOmitsAgentSeenAtUntilTheAgentShowsUp(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := s.Snapshot()
	if strings.Contains(string(b), "agentSeenAt") {
		t.Fatalf("snapshot = %s", b)
	}
}

// Review Focus 5: only the CLI counts as the agent. Bearer requests without the client header
// (the dev server's proxy) must never refresh agentSeenAt.
func TestAgentSeenOnlyForCLIRequests(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session() // Bearer, no client header
	sess, err := e.srv.mgr.Get(sid)
	if err != nil {
		t.Fatal(err)
	}
	setClock(sess, func() time.Time { return agentT0 })
	e.do("GET", "/api/sessions/"+sid+"/state", "")
	e.command(sid, "stage.add", `{"title":"A"}`)
	if got := agentSeenAt(t, sess); got != 0 {
		t.Fatalf("requests without %s set agentSeenAt = %d", store.ClientHeader, got)
	}
	e.do("GET", "/api/sessions/"+sid+"/state", "", store.ClientHeader, store.ClientCLI)
	if got := agentSeenAt(t, sess); got != agentT0.UnixMilli() {
		t.Fatalf("agentSeenAt = %d, want %d", got, agentT0.UnixMilli())
	}
}

func TestCreateSessionFromCLIMarksAgentSeen(t *testing.T) {
	e := newTestEnv(t)
	body, _ := json.Marshal(map[string]any{"project": store.Project{ID: "p1", RootPath: "/r", Name: "r"}, "title": "Idea"})
	code, out := e.do("POST", "/api/sessions", string(body), store.ClientHeader, store.ClientCLI)
	var res struct{ ID string }
	json.Unmarshal([]byte(out), &res)
	sess, err := e.srv.mgr.Get(res.ID)
	if code != 200 || err != nil {
		t.Fatalf("create: %d %s %v", code, out, err)
	}
	if agentSeenAt(t, sess) == 0 {
		t.Fatal("tdm session new must count as agent contact")
	}
}

func TestTouchAgentPushesAtMostOncePerMinute(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	now := agentT0
	s.now = func() time.Time { return now }
	pushed := func() bool {
		ch := s.Changed()
		s.TouchAgent()
		select {
		case <-ch:
			return true
		default:
			return false
		}
	}
	if !pushed() {
		t.Fatal("first contact must push a snapshot")
	}
	now = agentT0.Add(30 * time.Second)
	if pushed() {
		t.Fatal("contact 30s after the last push must not push")
	}
	if got := agentSeenAt(t, s); got != now.UnixMilli() {
		t.Fatalf("agentSeenAt = %d, want the latest contact %d", got, now.UnixMilli())
	}
	now = agentT0.Add(61 * time.Second)
	if !pushed() {
		t.Fatal("contact a minute after the last push must push")
	}
}

// Review Focus 4: a tdm wait keeps the agent connected. When it returns (for example after the user
// took 20 minutes to answer), its end counts as contact, so the page does not flip to "AI not
// connected" when waiting turns false.
func TestWaitStartAndEndCountAsAgentContact(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	now := agentT0
	s.now = func() time.Time { return now }
	_, end := s.BeginWait(context.Background())
	if got := agentSeenAt(t, s); got != agentT0.UnixMilli() {
		t.Fatalf("after BeginWait agentSeenAt = %d", got)
	}
	now = agentT0.Add(20 * time.Minute)
	end()
	if got := agentSeenAt(t, s); got != now.UnixMilli() {
		t.Fatalf("after the wait ended agentSeenAt = %d, want %d", got, now.UnixMilli())
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go test ./internal/client/ ./internal/daemon/ -run 'TestRawMarksRequestsAsCLI|Agent' -v`
Expected: compile FAIL, `undefined: store.ClientHeader`, `s.TouchAgent undefined`.

- [ ] **Step 4: Implement the header**

Append to `internal/store/daemoninfo.go`:

```go
// ClientHeader marks requests sent by the tdm CLI, which the agent drives. The daemon uses it to
// tell them from the page's requests, including the dev server's proxy, which also sends the
// Bearer token.
const (
	ClientHeader = "X-Tandem-Client"
	ClientCLI    = "cli"
)
```

In `internal/client/client.go` `Raw`, after `req.Header.Set("Authorization", "Bearer "+c.token)`, add:

```go
	req.Header.Set(store.ClientHeader, store.ClientCLI)
```

- [ ] **Step 5: Implement the session tracking**

In `internal/daemon/manager.go`, add two fields to `Session` after `now func() time.Time`:

```go
	agentSeen   time.Time // last CLI call, or start/end of a tdm wait; zero until the agent shows up
	agentPushed time.Time // the agentSeen value TouchAgent last pushed to subscribers
```

Add after `MarkDelivered`:

```go
// agentPushEvery throttles snapshot pushes caused only by agent CLI calls: the page needs
// agentSeenAt to the minute, not a new snapshot for every read-only command.
const agentPushEvery = time.Minute

// TouchAgent records a CLI call from the agent.
func (s *Session) TouchAgent() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentSeen = s.now()
	if s.agentSeen.Sub(s.agentPushed) >= agentPushEvery {
		s.agentPushed = s.agentSeen
		s.notifyLocked()
	}
}
```

Replace `Snapshot`:

```go
func (s *Session) Snapshot() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var seen int64
	if !s.agentSeen.IsZero() {
		seen = s.agentSeen.UnixMilli()
	}
	return json.Marshal(struct {
		State       *domain.State `json:"state"`
		Waiting     bool          `json:"waiting"`
		AgentSeenAt int64         `json:"agentSeenAt,omitempty"`
	}{s.state, s.waiting, seen})
}
```

In `internal/daemon/wait.go` `BeginWait`, change `s.waitCancel, s.waiting = cancel, true` to:

```go
	s.waitCancel, s.waiting = cancel, true
	s.agentSeen = s.now()
```

In the returned cleanup function, replace the locked section with:

```go
			s.mu.Lock()
			defer s.mu.Unlock()
			// The agent stayed connected for the whole wait: its end counts as contact too, so
			// a long wait that just returned does not read as a silent agent (Review Focus 4).
			s.agentSeen = s.now()
			if s.waitSeq == mine {
				s.waitCancel, s.waiting = nil, false
				s.notifyLocked()
			}
```

- [ ] **Step 6: Touch on CLI requests**

In `internal/daemon/api.go`, replace `session()` and add `fromCLI` below it:

```go
func (s *Server) session(w http.ResponseWriter, r *http.Request) (*Session, bool) {
	sess, err := s.mgr.Get(r.PathValue("sid"))
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	if fromCLI(r) {
		sess.TouchAgent()
	}
	return sess, true
}

// fromCLI reports whether the request comes from the tdm CLI, that is, from the agent.
func fromCLI(r *http.Request) bool {
	return r.Header.Get(store.ClientHeader) == store.ClientCLI
}
```

In `createSession`, after the `if err != nil { writeError(w, err); return }` that follows `s.mgr.Create`, add:

```go
	if fromCLI(r) {
		sess.TouchAgent()
	}
```

- [ ] **Step 7: Run all Go tests**

Run: `go test ./...`
Expected: PASS. `TestSnapshotContractFixture` stays green, because the fixture never sees the agent, so `agentSeenAt` is omitted. The stream test still sees `"waiting":false`.

- [ ] **Step 8: Commit**

```bash
git add internal/store/daemoninfo.go internal/client internal/daemon
git commit -m "feat(daemon): record the agent's last CLI call as agentSeenAt in the snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web — API types for choice, agentSeenAt and the new actions

**Files:**
- Modify: `web/src/api/types.ts`
- Test: `web/src/api/types.test.ts`

**Interfaces:**
- Consumes: the JSON from Tasks 2–4.
- Produces:
  - `interface MessageChoice { blockId: string; optionId: string }`;
  - `Message.choice?: MessageChoice`;
  - `Snapshot.agentSeenAt?: number` (unix ms);
  - `Action` variants `{ type: 'variant.choose'; data: { blockId: string; optionId: string; comment?: string; resolve?: boolean } }` and `{ type: 'thread.resolve'; data: { threadId: string; text?: string } }`.
  - `normalizeSnapshot` passes `agentSeenAt` through only when it is a number.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('normalizeSnapshot', …)` in `web/src/api/types.test.ts`:

```ts
  it('keeps the variant choice a user message was sent with', () => {
    const s = normalizeSnapshot(fixture)
    expect(s.state.threads.t_2.messages[0]).toEqual({ actor: 'user', text: 'Simpler.', seq: 16, choice: { blockId: 'b_3', optionId: 'o_2' } })
  })

  it('reads agentSeenAt only when the daemon has seen the agent', () => {
    expect(normalizeSnapshot(fixture).agentSeenAt).toBeUndefined()
    expect(normalizeSnapshot({ ...structuredClone(fixture), agentSeenAt: 1790000000000 }).agentSeenAt).toBe(1790000000000)
    expect(normalizeSnapshot({ ...structuredClone(fixture), agentSeenAt: 'soon' }).agentSeenAt).toBeUndefined()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/api/types.test.ts`
Expected: the typecheck step of vitest may pass, but the `agentSeenAt` test FAILS (`normalizeSnapshot` drops it). The choice test passes already, because the spread keeps it. That is fine: it pins the contract.

- [ ] **Step 3: Implement**

In `web/src/api/types.ts`:

Update the header comment to `// Mirrors the JSON of internal/domain (State) and the daemon snapshot {state, waiting, agentSeenAt}.`

Replace `Message`:

```ts
export interface MessageChoice {
  blockId: string
  optionId: string
}

export interface Message {
  actor: Actor
  text: string
  seq: number
  /** Set on a user message sent with a variant choice (its text may be empty). */
  choice?: MessageChoice
}
```

Replace `Snapshot`:

```ts
export interface Snapshot {
  state: State
  waiting: boolean
  /** Unix ms of the agent's last CLI call (or tdm wait start/end); absent until the daemon has seen it. */
  agentSeenAt?: number
}
```

In `Action`, replace the `variant.choose` line and add `thread.resolve`:

```ts
  | { type: 'variant.choose'; data: { blockId: string; optionId: string; comment?: string; resolve?: boolean } }
  | { type: 'thread.resolve'; data: { threadId: string; text?: string } }
```

In `normalizeSnapshot`, replace the `return`:

```ts
  const agentSeenAt = typeof r.agentSeenAt === 'number' ? { agentSeenAt: r.agentSeenAt as number } : {}
  return { waiting: Boolean(r.waiting), ...agentSeenAt, state: { ...st, stages, threads, blocks } }
```

- [ ] **Step 4: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/types.test.ts
git commit -m "feat(web): types for message choices, agentSeenAt and resolve actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web — land on the first unresolved thread

**Files:**
- Modify: `web/src/session/nav.ts` (`defaultItem`)
- Test: `web/src/session/nav.test.ts`, `web/src/shell/SessionPage.test.tsx`, `web/src/shell/SessionPage.followBottom.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `defaultItem(state: State): string`, same signature. It returns:
  1. the first thread (stage order, then thread order) whose status is not `resolved`, `conclusion_proposed` included;
  2. otherwise the first stage whose status is `summary_proposed`;
  3. otherwise the last stage;
  4. `''` when there are no stages.

  `useCurrentItem` hash pinning is unchanged.

- [ ] **Step 1: Rewrite the nav tests**

In `web/src/session/nav.test.ts`, replace the test `'opens what needs the user first'` with:

```ts
  it('opens the first unresolved thread in stage/thread order (feature review t_5)', () => {
    const { state } = fixtureSnapshot()
    const resolve = (id: string) => (state.threads[id] = { ...state.threads[id], status: 'resolved' })
    expect(defaultItem(state)).toBe('t_1') // open, and ahead of t_2's proposed conclusion
    resolve('t_1')
    expect(defaultItem(state)).toBe('t_2') // a proposed conclusion is still unresolved
    resolve('t_2')
    expect(defaultItem(state)).toBe('t_3')
    resolve('t_3')
    expect(defaultItem(state)).toBe('st_2') // everything resolved, no summary to review: last stage
    state.stages[0] = { ...state.stages[0], status: 'summary_proposed' }
    expect(defaultItem(state)).toBe('st_1') // everything resolved: the summary awaiting the user
    expect(defaultItem({ ...state, stages: [] })).toBe('')
  })

  it("does not let a later thread's proposed conclusion jump ahead", () => {
    const { state } = fixtureSnapshot()
    state.stages[1] = { ...state.stages[1], threadIds: ['t_9'] }
    state.threads.t_9 = { ...state.threads.t_2, id: 't_9', stageId: 'st_2' }
    expect(defaultItem(state)).toBe('t_1')
  })
```

In the test `'pins the shown item so a later default change does not move the view'`, replace its body from `expect(result.current[0]).toBe('t_2')` on with:

```ts
    expect(result.current[0]).toBe('t_1') // default: the first unresolved thread
    expect(window.location.hash).toBe('#t_1')

    const next = { ...state, threads: { ...state.threads, t_1: { ...state.threads.t_1, status: 'resolved' as const } } }
    rerender({ state: next })
    expect(result.current[0]).toBe('t_1')
    expect(window.location.hash).toBe('#t_1')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/session/nav.test.ts`
Expected: FAIL, `expected 't_2' to be 't_1'`.

- [ ] **Step 3: Implement**

In `web/src/session/nav.ts`, replace `defaultItem` and its comment:

```ts
// defaultItem opens the first unresolved thread in stage/thread order (feature review t_5): a
// proposed conclusion or summary no longer jumps ahead. With every thread resolved it opens the
// first stage whose summary awaits the user, else the last stage.
export function defaultItem(state: State): string {
  const threads = state.stages.flatMap((s) => s.threadIds.map((id) => state.threads[id]).filter(Boolean))
  const open = threads.find((t) => t.status !== 'resolved')
  if (open) return open.id
  const summary = state.stages.find((s) => s.status === 'summary_proposed')
  if (summary) return summary.id
  return state.stages.at(-1)?.id ?? ''
}
```

- [ ] **Step 4: Update the page tests that relied on landing on t_2**

In `web/src/shell/SessionPage.test.tsx`:
- Rename `'connects, then opens what needs the user'` to `'connects, then opens the first unresolved thread'`, and change its heading expectation from `'Cache strategy'` to `'Repository layer'`.
- In each of these tests, add `window.location.hash = '#t_2'` as the first line of the body:
  - `'advances to the next open thread once accepting a proposed conclusion succeeds (F12b-4)'` (also change its comment to `// Opened on t_2 (conclusion proposed). Accepting it should move on to t_3, …`);
  - `'does not advance when the accept fails (F12b-4)'`;
  - `'does not advance after Accept resolves if the user already navigated elsewhere (fix round 1, Important)'`;
  - `'shows daemon errors with their hint'`.
- Leave `'advances to the stage once the last open thread is accepted (F12b-4)'` unchanged. Its t_2 is the only unresolved thread, so it is still the default.

In `web/src/shell/SessionPage.followBottom.test.tsx`, in the `describe('SessionPage follows the reply after any user action …')` block, add `window.location.hash = '#t_2'` as the first line of each of its four tests. In the first one, change the render comment to `// t_2 holds the variants block`.

- [ ] **Step 5: Run the web tests**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/session/nav.ts web/src/session/nav.test.ts web/src/shell/SessionPage.test.tsx web/src/shell/SessionPage.followBottom.test.tsx
git commit -m "feat(web): open the first unresolved thread when the page loads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web — show the draft count on the composer's Send button

`sendReview` sends every eligible draft comment in the session with the message, not only this thread's (see `useController.sendReview`). The count is therefore `countDraft(draft)` with no thread filter, the same number the top bar's `Send to AI · N` shows.

**Files:**
- Modify: `web/src/thread/Composer.tsx`
- Test: `web/src/thread/Composer.test.tsx`

**Interfaces:**
- Consumes: `countDraft(d: Draft, threadId?: string): number` from `web/src/draft/draft.ts`.
- Produces: the Send button's accessible name is `Send`, `Send (1 comment)` or `Send (N comments)`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/thread/Composer.test.tsx`:

```ts
  it('shows how many draft comments go with the message on Send (feature review t_1)', () => {
    const one = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const first = renderStateful(<Composer thread={thread} />, { draft: one })
    expect(screen.getByRole('button', { name: 'Send (1 comment)' })).toBeInTheDocument()
    first.unmount()

    // Comments on other threads go out with the message too, so they count.
    const three = addComment(
      addComment(one, { threadId: 't_3', blockId: 'b_4', lines: { start: 1, end: 1 }, text: 'y' }),
      { threadId: 't_1', blockId: 'b_2', lines: { start: 13, end: 13 }, text: 'z' },
    )
    const second = renderStateful(<Composer thread={thread} />, { draft: three })
    expect(screen.getByRole('button', { name: 'Send (3 comments)' })).toBeInTheDocument()
    second.unmount()

    renderStateful(<Composer thread={thread} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/thread/Composer.test.tsx`
Expected: FAIL, `Unable to find role="button" and name "Send (1 comment)"`.

- [ ] **Step 3: Implement**

In `web/src/thread/Composer.tsx`, after `const pending = countDraft(draft)`, add:

```ts
  // Every draft comment goes out with the message (sendReview sends the whole draft).
  const sendLabel = pending ? `Send (${pending} comment${pending > 1 ? 's' : ''})` : 'Send'
```

Replace the button text `Send` with `{sendLabel}`. Leave the footer hint as is.

- [ ] **Step 4: Run the web tests**

Run: `cd web && npm test`
Expected: PASS. The existing tests render with no draft, so their `name: 'Send'` still matches.

- [ ] **Step 5: Commit**

```bash
git add web/src/thread/Composer.tsx web/src/thread/Composer.test.tsx
git commit -m "feat(web): show the draft comment count on the composer's Send button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web — "Chose: <option>" header on choice messages

**Files:**
- Modify: `web/src/thread/timeline.ts` (add `choiceTitle`)
- Modify: `web/src/thread/MessageView.tsx` (the `choice` prop)
- Modify: `web/src/thread/ThreadView.tsx` (pass `choice`)
- Modify: `web/src/thread/delivery.ts` (fix the now-stale M2 comment)
- Modify: `web/src/styles/app.css` (`.msg-choice`)
- Test: `web/src/thread/timeline.test.ts`, `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `Message.choice?: MessageChoice` (Task 5).
- Produces:
  - `choiceTitle(state: State, message: Message): string | undefined`. It returns the option title, or the option id when the option is unknown, or `undefined` when there is no choice;
  - `MessageView({ message, status, choice }: { message: Message; status?: string | null; choice?: string })`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/thread/timeline.test.ts` (extend the import to `import { choiceTitle, timeline } from './timeline'`):

```ts
describe('choiceTitle', () => {
  it('names the option a message was sent with', () => {
    const { state } = fixtureSnapshot()
    expect(choiceTitle(state, state.threads.t_2.messages[0])).toBe('Lazy delegate')
    expect(choiceTitle(state, state.threads.t_1.messages[0])).toBeUndefined()
    expect(choiceTitle(state, { actor: 'user', text: '', seq: 99, choice: { blockId: 'b_9', optionId: 'o_9' } })).toBe('o_9')
  })
})
```

Add to `web/src/thread/ThreadView.test.tsx`:

```ts
  it('heads a message sent with a variant choice with "Chose: <option>" (feature review t_3)', () => {
    const { container } = renderStateful(<ThreadView threadId="t_2" />)
    const msg = container.querySelector('.msg-user')!
    expect(msg.querySelector('.msg-choice')).toHaveTextContent('Chose: Lazy delegate')
    expect(msg).toHaveTextContent('Simpler.')
  })

  // Review Focus 1: a choice without text (also every textless choice in an old log) is its own
  // timeline entry, showing only the header.
  it('shows a textless choice as its own entry with only the header', () => {
    const base = makeCtx()
    const t2 = base.state.threads.t_2
    base.state.threads.t_2 = {
      ...t2,
      messages: [...t2.messages, { actor: 'user', text: '', seq: 18, choice: { blockId: 'b_3', optionId: 'o_1' } }],
      lastUserSeq: 18,
    }
    const { container } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const msgs = container.querySelectorAll('.msg-user')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toHaveTextContent(/^Chose: Empty map$/)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/thread/timeline.test.ts src/thread/ThreadView.test.tsx`
Expected: FAIL, `choiceTitle is not a function` / `.msg-choice` not found.

- [ ] **Step 3: Implement**

Append to `web/src/thread/timeline.ts`:

```ts
// choiceTitle is the title of the variant option a user message was sent with (its id if the
// option is unknown), or undefined for a message without a choice.
export function choiceTitle(state: State, message: Message): string | undefined {
  const c = message.choice
  if (!c) return undefined
  return state.blocks[c.blockId]?.variants?.options.find((o) => o.id === c.optionId)?.title ?? c.optionId
}
```

Replace `web/src/thread/MessageView.tsx`:

```tsx
import type { Message } from '../api/types'
import { Prose } from '../markdown/Prose'

// `status`, when given, is the delivery status line shown under the user's latest message
// (see delivery.ts): null once the AI has acted on it, otherwise a short "sent"/"replying" note.
// `choice` is the title of the variant option the message was sent with: it heads the message,
// which may have no text of its own (feature review t_3).
export function MessageView({ message, status, choice }: { message: Message; status?: string | null; choice?: string }) {
  if (message.actor === 'user')
    return (
      <>
        <div className="msg-user">
          {choice && <div className="msg-choice">{`Chose: ${choice}`}</div>}
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

In `web/src/thread/ThreadView.tsx`, change the import to `import { choiceTitle, timeline } from './timeline'`. Add the prop `choice={choiceTitle(state, item.message)}` to `<MessageView …>`.

In `web/src/thread/delivery.ts`, in the `threadIsReplying` comment, replace `(a draft-only send, a variant choice without a comment) bumps lastUserSeq without adding a message (M2)` with `(a draft-only send) bumps lastUserSeq without adding a message (M2)`.

In `web/src/styles/app.css`, after the `.msg-user { … }` rule, add:

```css
.msg-choice { font: 600 0.75rem var(--font-ui); color: var(--muted); }
.msg-choice:not(:last-child) { margin-bottom: 2px; }
```

- [ ] **Step 4: Run the web tests**

Run: `cd web && npm test`
Expected: PASS. `scale.test.ts` accepts the rem font size.

- [ ] **Step 5: Commit**

```bash
git add web/src/thread web/src/styles/app.css
git commit -m "feat(web): head messages sent with a variant choice with Chose: <option>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — silent agent: ticking clock, quiet bubble, "AI not connected"

**Files:**
- Create: `web/src/session/agent.ts`, `web/src/session/agent.test.ts`
- Create: `web/src/session/clock.ts`, `web/src/session/clock.test.ts`
- Modify: `web/src/session/context.ts` (`SessionCtx.quietMinutes`)
- Modify: `web/src/session/useController.ts` (compute `quietMinutes`)
- Modify: `web/src/test/session.tsx` (`makeCtx` default)
- Modify: `web/src/thread/TypingBubble.tsx`, `web/src/thread/ThreadView.tsx`, `web/src/shell/TopBar.tsx`
- Modify: `web/src/styles/app.css`
- Test: `web/src/thread/ThreadView.test.tsx`, `web/src/shell/Shell.test.tsx`, `web/src/shell/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `Snapshot.agentSeenAt?: number` (Task 5).
- Produces:
  - `export const AGENT_QUIET_MS = 10 * 60 * 1000`;
  - `agentQuietMinutes(s: { waiting: boolean; agentSeenAt?: number }, now: number): number | null`. It returns `null` while `waiting`, while `agentSeenAt` is absent, or while silence is under the threshold; otherwise it returns whole minutes;
  - `export const CLOCK_TICK_MS = 30_000`, `useNow(tickMs?: number): number`;
  - `SessionCtx.quietMinutes: number | null`;
  - `TypingBubble({ quietMinutes }: { quietMinutes?: number | null })`.

- [ ] **Step 1: Write the failing unit tests**

Create `web/src/session/agent.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AGENT_QUIET_MS, agentQuietMinutes } from './agent'

const MIN = 60_000
const now = 1_790_000_000_000

describe('agentQuietMinutes', () => {
  it('uses a 10 minute threshold', () => {
    expect(AGENT_QUIET_MS).toBe(10 * MIN)
  })

  // Review Focus 4: a running tdm wait means the agent is connected, however long ago it started.
  it('is null while tdm wait runs', () => {
    expect(agentQuietMinutes({ waiting: true, agentSeenAt: now - 60 * MIN }, now)).toBeNull()
  })

  // Review Focus 5: no agentSeenAt (daemon restarted, agent not seen yet) is no evidence of silence.
  it('is null when the daemon has not seen the agent', () => {
    expect(agentQuietMinutes({ waiting: false }, now)).toBeNull()
  })

  it('is null below the threshold', () => {
    expect(agentQuietMinutes({ waiting: false, agentSeenAt: now - AGENT_QUIET_MS + 1 }, now)).toBeNull()
  })

  it('returns whole minutes from the threshold on', () => {
    expect(agentQuietMinutes({ waiting: false, agentSeenAt: now - AGENT_QUIET_MS }, now)).toBe(10)
    expect(agentQuietMinutes({ waiting: false, agentSeenAt: now - 17 * MIN - 59_000 }, now)).toBe(17)
  })
})
```

Create `web/src/session/clock.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { CLOCK_TICK_MS, useNow } from './clock'

afterEach(() => vi.useRealTimers())

describe('useNow', () => {
  it('ticks on its own, without a new snapshot', () => {
    vi.useFakeTimers()
    const start = Date.now()
    const { result } = renderHook(() => useNow())
    expect(result.current).toBe(start)
    act(() => vi.advanceTimersByTime(CLOCK_TICK_MS))
    expect(result.current).toBe(start + CLOCK_TICK_MS)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/session/agent.test.ts src/session/clock.test.ts`
Expected: FAIL, `Failed to resolve import "./agent"` / `"./clock"`.

- [ ] **Step 3: Implement agent.ts and clock.ts**

Create `web/src/session/agent.ts`:

```ts
// Feature review t_6: after this long without a CLI call from the agent, and with no tdm wait
// running, the page says the AI may have stopped.
export const AGENT_QUIET_MS = 10 * 60 * 1000

// agentQuietMinutes returns how many whole minutes the agent has been silent, or null when it is
// not considered silent: tdm wait is running, the daemon has not seen it (agentSeenAt absent), or
// the silence is shorter than AGENT_QUIET_MS.
export function agentQuietMinutes(s: { waiting: boolean; agentSeenAt?: number }, now: number): number | null {
  if (s.waiting || s.agentSeenAt === undefined) return null
  const silent = now - s.agentSeenAt
  return silent >= AGENT_QUIET_MS ? Math.floor(silent / 60_000) : null
}
```

Create `web/src/session/clock.ts`:

```ts
import { useEffect, useState } from 'react'

// Often enough that "AI quiet for Nm" flips within half a minute of crossing the threshold.
export const CLOCK_TICK_MS = 30_000

// useNow returns Date.now(), refreshed every tickMs, so time-based UI changes without a snapshot.
export function useNow(tickMs: number = CLOCK_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])
  return now
}
```

Run: `cd web && npx vitest run src/session/agent.test.ts src/session/clock.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing UI tests**

Add to `web/src/thread/ThreadView.test.tsx`:

```ts
  it('says the AI may have stopped when it has been quiet for a while (feature review t_6)', () => {
    const base = makeCtx()
    base.state.delivered = 15
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state, quietMinutes: 12 })
    expect(screen.getByRole('status', { name: 'AI quiet for 12m, it may have stopped' })).toHaveTextContent(
      'AI quiet for 12m, it may have stopped',
    )
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })
```

Add to the `describe('TopBar', …)` block in `web/src/shell/Shell.test.tsx`:

```ts
  it('shows "AI not connected" once the agent has been quiet (feature review t_6)', () => {
    const { container } = bar({ waiting: false, quietMinutes: 12 })
    expect(screen.getByText('AI not connected')).toBeInTheDocument()
    expect(screen.queryByText('AI is working…')).toBeNull()
    expect(container.querySelector('.dot.is-quiet')).toBeInTheDocument()
  })
```

Add to `web/src/shell/SessionPage.test.tsx` (extend the `vitest` import if needed; `vi` is already imported):

```ts
  it('flips to "AI not connected" after 10 quiet minutes without a new snapshot (feature review t_6)', () => {
    vi.useFakeTimers()
    try {
      window.location.hash = '#st_2'
      render(<SessionPage sid="s_fixture" />)
      const snap = { ...structuredClone(fixture), agentSeenAt: Date.now() - 9 * 60_000 - 50_000 }
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      expect(screen.getByText('AI is working…')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(30_000))
      expect(screen.getByText('AI not connected')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd web && npx vitest run src/thread/ThreadView.test.tsx src/shell/Shell.test.tsx src/shell/SessionPage.test.tsx`
Expected: FAIL. `quietMinutes` is not in `SessionCtx` (a type error in the editor; vitest runs anyway), and the quiet texts are not found.

- [ ] **Step 6: Wire the context**

In `web/src/session/context.ts`, add to `SessionCtx` after `waiting: boolean`:

```ts
  /** Whole minutes the agent has been silent (no CLI call, no tdm wait), or null — see session/agent.ts. */
  quietMinutes: number | null
```

In `web/src/session/useController.ts`, add these imports:

```ts
import { agentQuietMinutes } from './agent'
import { useNow } from './clock'
```

After `const readOnly = …`, add:

```ts
  const now = useNow()
  const quietMinutes = agentQuietMinutes(snapshot, now)
```

Add `quietMinutes,` to the returned object after `waiting,`. Add `quietMinutes` to the `useMemo` dependency list after `waiting`.

In `web/src/test/session.tsx` `makeCtx`, add `quietMinutes: null,` after `waiting: snap.waiting,`.

- [ ] **Step 7: Implement the bubble and the top bar**

Replace the `TypingBubble` function in `web/src/thread/TypingBubble.tsx`, keeping the file's comment and appending one sentence to it: `With quietMinutes set, the agent has gone silent and the bubble says so in words instead (feature review t_6).`

```tsx
export function TypingBubble({ quietMinutes = null }: { quietMinutes?: number | null }) {
  if (quietMinutes !== null) {
    const text = `AI quiet for ${quietMinutes}m, it may have stopped`
    return (
      <div className="typing-bubble is-quiet" role="status" aria-label={text}>
        {text}
      </div>
    )
  }
  return (
    <div className="typing-bubble" role="status" aria-label="AI is replying">
      <span className="visually-hidden">AI is replying</span>
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
    </div>
  )
}
```

In `web/src/thread/ThreadView.tsx` `ThreadBody`, change `const { readOnly, waiting } = useSessionCtx()` to `const { readOnly, waiting, quietMinutes } = useSessionCtx()`, and render `<TypingBubble quietMinutes={quietMinutes} />`.

In `web/src/shell/TopBar.tsx`, read `quietMinutes` from `useSessionCtx()`. Insert a branch between the `waiting` branch and the final `else`:

```tsx
  else if (quietMinutes !== null)
    status = (
      <>
        <span className="dot is-quiet" aria-hidden />
        AI not connected
      </>
    )
```

In `web/src/styles/app.css`, after `.ai-status .dot.is-reconnecting { … }`, add:

```css
.ai-status .dot.is-quiet { background: var(--faint); }
```

After `.typing-bubble { … }`, add:

```css
.typing-bubble.is-quiet { font: 0.8125rem var(--font-ui); color: var(--muted); }
```

- [ ] **Step 8: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/session web/src/test/session.tsx web/src/thread web/src/shell web/src/styles/app.css
git commit -m "feat(web): tell the user when the agent has gone quiet for 10 minutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Web — Resolve button on open threads

**Files:**
- Modify: `web/src/blocks/CommentEditor.tsx` (the `allowEmpty` prop)
- Create: `web/src/thread/ResolveThread.tsx`
- Modify: `web/src/thread/ConclusionCard.tsx` (render `ResolveThread` for open threads)
- Modify: `web/src/styles/app.css` (`.resolve-bar`)
- Test: `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: the action `{ type: 'thread.resolve'; data: { threadId: string; text?: string } }` (Task 5) and `ctx.run`.
- Produces:
  - `CommentEditor` prop `allowEmpty?: boolean`. When true, the submit button is enabled while the box is empty, and `onSave('')` is called;
  - `ResolveThread({ thread, onResolved }: { thread: Thread; onResolved?: () => void })`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/thread/ThreadView.test.tsx`:

```ts
  it('resolves an open thread with an optional note (feature review t_7)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx } = renderStateful(<ThreadView threadId="t_1" onResolved={onResolved} />)
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Repository stays.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1', text: 'Repository stays.' } })
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  // Review Focus 2: an empty note is allowed; the daemon fills in "Resolved by user".
  it('resolves with an empty note', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />)
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    const submit = screen.getByRole('button', { name: 'Resolve' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_3' } })
  })

  it('does not call onResolved when Resolve fails, and cancels back to the button', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_1" onResolved={onResolved} />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onResolved).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
  })

  it('offers Resolve only on open threads of a live session', () => {
    const { unmount } = renderStateful(<ThreadView threadId="t_2" />) // conclusion proposed
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
    unmount()
    const base = makeCtx({ readOnly: true })
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state, readOnly: true })
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/thread/ThreadView.test.tsx`
Expected: FAIL, `Unable to find role="button" and name "Resolve"`.

- [ ] **Step 3: Implement `allowEmpty`**

In `web/src/blocks/CommentEditor.tsx`:
- add `allowEmpty?: boolean` to `Props`;
- destructure `allowEmpty = false`;
- replace `submit`:

```ts
  const submit = () => {
    const t = text.trim()
    if (t || allowEmpty) onSave(t)
  }
```

- change the button's `disabled={!text.trim()}` to `disabled={!allowEmpty && !text.trim()}`.

- [ ] **Step 4: Implement `ResolveThread`**

Create `web/src/thread/ResolveThread.tsx`:

```tsx
import { useRef, useState } from 'react'
import type { Thread } from '../api/types'
import { CommentEditor } from '../blocks/CommentEditor'
import { useSessionCtx } from '../session/context'

// ResolveThread lets the user resolve an open thread the AI has not proposed a conclusion for
// (feature review t_7). It uses the same editor as the conclusion's Edit, starting empty. The
// optional note becomes the conclusion ("Resolved by user" when empty, filled in by the daemon),
// and the agent receives it as "conclusion edited and accepted". Its own component, so the editor
// state is dropped when the thread's status changes.
export function ResolveThread({ thread, onResolved }: { thread: Thread; onResolved?: () => void }) {
  const { run } = useSessionCtx()
  const [editing, setEditing] = useState(false)
  const inFlight = useRef(false)
  if (!editing)
    return (
      <div className="resolve-bar">
        <button type="button" className="btn small" onClick={() => setEditing(true)}>
          Resolve
        </button>
      </div>
    )
  return (
    <section className="conclusion" aria-label="Resolve thread">
      <div className="kicker">Resolve thread</div>
      <CommentEditor
        label="Conclusion (optional)"
        submitLabel="Resolve"
        allowEmpty
        onSave={async (text) => {
          if (inFlight.current) return
          inFlight.current = true
          try {
            if (await run({ type: 'thread.resolve', data: { threadId: thread.id, ...(text ? { text } : {}) } })) onResolved?.()
          } finally {
            inFlight.current = false
          }
        }}
        onCancel={() => setEditing(false)}
      />
    </section>
  )
}
```

In `web/src/thread/ConclusionCard.tsx`, import `ResolveThread` from `./ResolveThread`. Replace `if (thread.status !== 'conclusion_proposed') return null` with:

```tsx
  if (thread.status === 'open') return readOnly ? null : <ResolveThread thread={thread} onResolved={onResolved} />
  if (thread.status !== 'conclusion_proposed') return null
```

In `web/src/styles/app.css`, after `.conclusion.is-resolved { … }`, add:

```css
.resolve-bar { display: flex; font-family: var(--font-ui); }
```

- [ ] **Step 5: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. Existing `CommentEditor` callers do not pass `allowEmpty` and behave as before.

- [ ] **Step 6: Commit**

```bash
git add web/src/blocks/CommentEditor.tsx web/src/thread web/src/styles/app.css
git commit -m "feat(web): let the user resolve an open thread with an optional note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Web — Choose & resolve on variants, and no yellow border on the comment box

**Files:**
- Modify: `web/src/blocks/VariantsBlock.tsx` (the `onResolved` prop, the `send(resolve)` parameter, the new button)
- Modify: `web/src/blocks/BlockView.tsx` (pass `onResolved` through)
- Modify: `web/src/thread/ThreadView.tsx` (pass `onResolved` to `BlockView`)
- Modify: `web/src/styles/app.css` (`.variant-confirm`)
- Create: `web/src/styles/variants.test.ts`
- Test: `web/src/blocks/VariantsBlock.test.tsx`, `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `variant.choose` with `resolve?: boolean` (Task 5), and the `onResolved` callback that ThreadView already receives from SessionPage (it auto-advances to the next unresolved thread).
- Produces:
  - `VariantsBlock({ block, onResolved }: { block: Block; onResolved?: () => void })`;
  - `BlockView({ block, onResolved }: { block: Block; onResolved?: () => void })`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/blocks/VariantsBlock.test.tsx`:

```ts
  it('chooses and resolves in one step, with the comment (feature review t_7)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} onResolved={onResolved} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.type(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' }), 'Fewer null checks')
    await user.click(screen.getByRole('button', { name: 'Choose & resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({
      type: 'variant.choose',
      data: { blockId: 'b_3', optionId: 'o_1', comment: 'Fewer null checks', resolve: true },
    })
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('does not resolve on a plain Send choice, nor call onResolved when Choose & resolve fails', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} onResolved={onResolved} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'variant.choose', data: { blockId: 'b_3', optionId: 'o_1' } })
    expect(onResolved).not.toHaveBeenCalled()

    vi.mocked(ctx.run).mockResolvedValueOnce(false)
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Choose & resolve' }))
    expect(onResolved).not.toHaveBeenCalled()
    expect(empty).toHaveClass('is-selected')
  })
```

Add to `web/src/thread/ThreadView.test.tsx`:

```ts
  it('advances after Choose & resolve in the thread (feature review t_7)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderStateful(<ThreadView threadId="t_2" onResolved={onResolved} />)
    await user.click(screen.getAllByRole('button', { name: 'Choose' })[0])
    await user.click(screen.getByRole('button', { name: 'Choose & resolve' }))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('shows no typing bubble on a thread resolved by a choice', () => {
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved', conclusion: 'Lazy delegate', lastUserSeq: 18 }
    base.state.delivered = 18
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })
```

Create `web/src/styles/variants.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('variant choice comment box (feature review t_8)', () => {
  it('has no border', () => {
    const rule = appCss.match(/\.variant-confirm\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).not.toMatch(/border/)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/blocks/VariantsBlock.test.tsx src/thread/ThreadView.test.tsx src/styles/variants.test.ts`
Expected: FAIL. The button `Choose & resolve` is not found, and the CSS rule has `border: 1px solid var(--accent)`. The "no typing bubble" test already passes: `threadIsReplying` excludes resolved threads, like Go's `AwaitingAI`. It pins that behaviour for the new resolution path.

- [ ] **Step 3: Implement VariantsBlock**

In `web/src/blocks/VariantsBlock.tsx`:
- change the signature to `export function VariantsBlock({ block, onResolved }: { block: Block; onResolved?: () => void }) {`;
- replace `send`:

```ts
  // resolve: "Choose & resolve" also resolves the thread with the option title (plus the comment)
  // as its conclusion (feature review t_7), then lets the page advance like Accept does.
  const send = async (resolve = false) => {
    if (!selected || pending) return
    setPending(true)
    const c = comment.trim()
    const ok = await ctx.run({
      type: 'variant.choose',
      data: { blockId: block.id, optionId: selected, ...(c ? { comment: c } : {}), ...(resolve ? { resolve: true } : {}) },
    })
    setPending(false)
    if (!ok) return
    cancel()
    if (resolve) onResolved?.()
  }
```

- in the `.variant-confirm` `.actions`, insert between `Send choice` and `Cancel`:

```tsx
            <button type="button" className="btn small" disabled={pending} onClick={() => void send(true)}>
              Choose &amp; resolve
            </button>
```

The ⌘/Ctrl↵ handler keeps calling `send()` (Send choice).

In `web/src/blocks/BlockView.tsx`, change the signature to `export function BlockView({ block, onResolved }: { block: Block; onResolved?: () => void })` and the variants case to `return <VariantsBlock block={block} onResolved={onResolved} />`.

In `web/src/thread/ThreadView.tsx`, change `<BlockView key={item.block.id} block={item.block} />` to `<BlockView key={item.block.id} block={item.block} onResolved={onResolved} />`.

- [ ] **Step 4: Drop the border**

In `web/src/styles/app.css`, replace the `.variant-confirm { … }` rule with:

```css
.variant-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  font-family: var(--font-ui);
}
```

The padding goes with the border, so the textarea lines up with the cards.

- [ ] **Step 5: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/blocks web/src/thread/ThreadView.tsx web/src/thread/ThreadView.test.tsx web/src/styles
git commit -m "feat(web): Choose & resolve on variants; drop the choice box's accent border

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Rebuild webdist, verify everything, commit

**Files:**
- Regenerate: `internal/daemon/webdist/`
- Check: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything above.
- Produces: an embedded UI that matches `web/src`.

- [ ] **Step 1: Build the web UI**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known (ROADMAP polish backlog) and fine.

- [ ] **Step 2: Run the full test suites**

Run: `go test ./... && (cd web && npm test)`
Expected: all PASS. `TestPageServesBuiltUI` serves the new build, and `TestSnapshotContractFixture` matches the committed fixture.

- [ ] **Step 3: Run the e2e (optional; needs `npx playwright install chromium` once and a Go toolchain)**

Run: `cd web && npm run e2e`
Expected: PASS. The page lands on `Repository layer` (the only thread). After `Send choice`, the timeline shows `Chose: Lazy delegate`. `tdm wait` still contains `Chose o_2 "Lazy delegate" (block b_3).`.

- [ ] **Step 4: Check the roadmap**

Read `docs/ROADMAP.md`. None of its parked features or polish items is delivered by this plan, so leave it unchanged. Edit it only if review turns up an item this work completed.

- [ ] **Step 5: Commit the build**

```bash
git add internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the feature review changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual smoke check (with the user)**

Run the check against a scratch home: `TANDEM_HOME="$(mktemp -d)"`, `go build -o /tmp/tdm ./cmd/tdm`, then drive a session with the CLI. Check:
- the page opens on the first open thread;
- `Send (2 comments)` shows with two draft comments;
- `Choose & resolve` resolves the thread and advances, and `tdm wait` prints `variant chosen, thread resolved`;
- `Resolve` with an empty note gives `Resolved by user`;
- with no `tdm wait` running and nothing sent for 10 minutes, the top bar shows `AI not connected`. Use a delivered message to see the bubble text.
