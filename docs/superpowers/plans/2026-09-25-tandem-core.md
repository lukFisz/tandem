# Tandem core (Go daemon + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `tdm` Go binary: the event-sourced domain, the JSONL store, the auto-started local daemon (HTTP API, long-poll `wait`, SSE), and the agent-facing CLI. The whole agent ↔ user loop then works end to end over HTTP, with a placeholder page instead of the real UI.

**Architecture:** A single Go binary. `tdm daemon run` owns all state: one in-memory `domain.State` per session, rebuilt by replaying `events.jsonl`, with one writer per session. Every other `tdm` command is a thin HTTP client that auto-starts the daemon when needed. Commands are validated by the pure `domain.Decide`, persisted as events, and folded by `State.Apply`. Markdown output for the agent is produced by `internal/render`.

**Tech Stack:** Go 1.27, standard library (`net/http` 1.22+ routing patterns, `embed`, `crypto/*`), `github.com/spf13/cobra` for the CLI. Tests use the standard `testing` package only.

**Spec:** `docs/superpowers/specs/2026-09-25-tandem-design.md`

**Scope note:** This is plan 1 of 3.
- Plan 2 (web UI): React + Vite + Shiki, replacing the placeholder page; plus Playwright E2E.
- Plan 3: agent legibility eval script.

Both follow once this plan is merged. This plan produces working, testable software on its own: the full loop can be driven by the CLI (agent) and raw HTTP actions (user).

## Global Constraints

- Everything in the repo is in English: code, comments, CLI output, docs.
- Module path: `github.com/lukaszfiszer/tandem`. `go.mod` declares `go 1.27`.
- The only third-party dependency is `github.com/spf13/cobra`.
- Exit codes: `0` ok, `1` error, `2` usage error, `3` `wait` timeout.
- **stdout** is compact text/markdown by default. `--json` on every command gives JSON.
- Errors go to **stderr** as `error: <code>: <message>` plus an optional `hint: <hint>` line. With `--json` they are `{"error":{"code","message","hint"}}`.
- Environment:
  - `TANDEM_HOME` (default `~/.tandem`);
  - `TANDEM_SESSION` (session override);
  - `TANDEM_NO_BROWSER=1` (never open a browser; used in tests);
  - `TANDEM_IDLE_TIMEOUT` (daemon idle shutdown, Go duration; default `30m`).
- `tdm wait` default timeout is `9m`.
- The daemon listens on `127.0.0.1` only. Every request except `GET /health` needs the token (Bearer header or `tandem_token` cookie).
- `daemon.json` and all written files use mode `0600`; directories use `0700`.
- Ids:
  - sessions are `s_` + 6 lowercase hex;
  - inside a session, ids are sequential: `st_N`, `t_N`, `b_N`, `o_N`.
- File snapshots are at most 1 MiB. Files containing a NUL byte are rejected as binary.
- TDD: every step that adds behaviour starts with a failing test.

## Review Focus

1. **User text containing markdown syntax** (`#`, `>`, backticks) in comments and messages must not break the structure of the `wait` output. It is always quoted with `> `, and code fences grow longer than any backtick run. Pinned in Task 7.
2. **`tdm block add file` with a bad path** must fail with a specific error code and hint, never a stack trace or a silently wrong snapshot. Bad paths are: a path outside the project, a missing file, a binary file, a file over 1 MiB, or `--lines` beyond EOF. Pinned in Task 13.
3. **Stale `daemon.json`** (daemon crashed or was killed) must be handled transparently: the next command starts a fresh daemon. Pinned in Task 11.
4. **Concurrent writes** (the browser and the CLI at the same instant) must always give strictly increasing `seq` values and a log that reloads cleanly. Pinned in Task 6.
5. **The agent's shell kills `tdm wait` mid-request** (for example the ~10 min tool cap). Events that were not written to a live client must not be marked delivered; the next `tdm wait` returns them. Pinned in Task 10.

---

## File map

```
go.mod
cmd/tdm/main.go                          entrypoint (version via -ldflags "-X main.version=…")
internal/domain/event.go                Event envelope, Actor, NewEvent/Decode
internal/domain/lines.go                LineRange, ParseLineRange, CountLines
internal/domain/ids.go                  FormatID, NewSessionID
internal/domain/lang.go                 LangFromPath
internal/domain/events.go               event type constants + payload structs
internal/domain/blocks.go               BlockKind, BlockContent, Variants
internal/domain/state.go                State, Session, Stage, Thread, Block
internal/domain/reducer.go              State.Apply, Replay
internal/domain/eventref.go             EventThreadIDs, EventStageID, PendingUserEvents
internal/domain/errors.go               domain.Error + codes
internal/domain/commands.go             command structs, DecodeCommand
internal/domain/resolve.go              openStage/activeThread/block lookups with errors
internal/domain/decide.go               Decide (validation → events)
internal/domain/domaintest/build.go     test helper: Build/Try
internal/store/paths.go                 Home, ProjectDir, SessionDir, …
internal/store/fsutil.go                writeFileAtomic
internal/store/log.go                   OpenLog, Log.Append
internal/store/blobs.go                 PutBlob, GetBlob
internal/store/project.go               Project, ProjectFor, Load/SaveProject, SessionIndex
internal/store/daemoninfo.go            DaemonInfo read/write/remove
internal/render/md.go                   Fence, Quote, human
internal/render/wait.go                 Wait
internal/render/views.go                Show, Summarize, Export
internal/daemon/manager.go              Manager, Session (single writer, notify)
internal/daemon/content.go              Session.StoreContent (Content → blob)
internal/daemon/server.go               Config, Server, Handler, auth guard, helpers
internal/daemon/api.go                  REST handlers
internal/daemon/wait.go                 long-poll wait handler, BeginWait
internal/daemon/stream.go               SSE handler
internal/daemon/activity.go             idle tracking
internal/daemon/run.go                  Run (listen, daemon.json, idle shutdown)
internal/daemon/webdist/index.html      placeholder page (replaced by plan 2)
internal/client/client.go               Client, APIError, DecodeError
internal/client/connect.go              Connect/Existing, auto-start, version check
internal/cli/app.go                     Execute, app, output, errors, session resolution
internal/cli/session.go                 session new/list/use/show/close, open
internal/cli/content.go                 stage/thread/block/annotate/say/conclude
internal/cli/files.go                   readExcerpt
internal/cli/loop.go                    wait, log, export, daemon
internal/cli/guide.go                   guide, skill install
internal/guide/guide.go                 embedded guide.md + skill.md
internal/guide/guide.md
internal/guide/skill.md
e2e/e2e_test.go                         builds the binary and drives the full loop
```

---

### Task 1: Module scaffold and domain primitives

**Files:**
- Create: `go.mod`, `internal/domain/event.go`, `internal/domain/lines.go`, `internal/domain/ids.go`, `internal/domain/lang.go`
- Test: `internal/domain/primitives_test.go`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Actor string` with `ActorAI`, `ActorUser`, `ActorSystem`
  - `type Event struct{Seq int64; TS time.Time; Actor Actor; Type string; V int; Data json.RawMessage}`
  - `func NewEvent(actor Actor, typ string, payload any) Event`
  - `func (e Event) Decode(into any) error`
  - `type LineRange struct{Start, End int}`, `func ParseLineRange(s string) (LineRange, error)`, `func (r LineRange) String() string`, `func (r LineRange) Within(first, count int) bool`
  - `func CountLines(text string) int`
  - `func FormatID(prefix string, n int) string`, `func NewSessionID() string`
  - `func LangFromPath(path string) string`

- [ ] **Step 1: Initialise the module**

```bash
cd /Users/lukaszfiszer/code/tandem
go mod init github.com/lukaszfiszer/tandem
go mod edit -go=1.27
```

- [ ] **Step 2: Write the failing tests**

`internal/domain/primitives_test.go`:

```go
package domain

import (
	"regexp"
	"testing"
)

func TestParseLineRange(t *testing.T) {
	cases := []struct {
		in   string
		want LineRange
		ok   bool
	}{
		{"14", LineRange{14, 14}, true},
		{"14-20", LineRange{14, 20}, true},
		{" 3-3 ", LineRange{3, 3}, true},
		{"0", LineRange{}, false},
		{"5-4", LineRange{}, false},
		{"a-b", LineRange{}, false},
		{"", LineRange{}, false},
	}
	for _, tc := range cases {
		got, err := ParseLineRange(tc.in)
		if (err == nil) != tc.ok {
			t.Fatalf("ParseLineRange(%q) err = %v, want ok=%v", tc.in, err, tc.ok)
		}
		if tc.ok && got != tc.want {
			t.Fatalf("ParseLineRange(%q) = %+v, want %+v", tc.in, got, tc.want)
		}
	}
}

func TestLineRangeStringAndWithin(t *testing.T) {
	if s := (LineRange{14, 14}).String(); s != "14" {
		t.Fatalf("String = %q", s)
	}
	if s := (LineRange{14, 15}).String(); s != "14-15" {
		t.Fatalf("String = %q", s)
	}
	// block covers lines 12..15
	if !(LineRange{12, 15}).Within(12, 4) || (LineRange{15, 16}).Within(12, 4) || (LineRange{11, 12}).Within(12, 4) {
		t.Fatal("Within gives wrong answer for block 12..15")
	}
}

func TestCountLines(t *testing.T) {
	for in, want := range map[string]int{"": 0, "a": 1, "a\n": 1, "a\nb": 2, "a\n\n": 2} {
		if got := CountLines(in); got != want {
			t.Fatalf("CountLines(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestEventRoundTrip(t *testing.T) {
	e := NewEvent(ActorAI, "x.y", map[string]string{"k": "v"})
	if e.V != 1 || e.Actor != ActorAI || e.Type != "x.y" {
		t.Fatalf("unexpected envelope %+v", e)
	}
	var got map[string]string
	if err := e.Decode(&got); err != nil || got["k"] != "v" {
		t.Fatalf("Decode = %v, %v", got, err)
	}
}

func TestIDs(t *testing.T) {
	if FormatID("t", 3) != "t_3" {
		t.Fatal("FormatID")
	}
	if id := NewSessionID(); !regexp.MustCompile(`^s_[0-9a-f]{6}$`).MatchString(id) {
		t.Fatalf("NewSessionID = %q", id)
	}
}

func TestLangFromPath(t *testing.T) {
	for path, want := range map[string]string{
		"a/B.kt": "kotlin", "x.kts": "kotlin", "Main.java": "java", "main.go": "go",
		"s.py": "python", "README.md": "markdown", "noext": "text",
	} {
		if got := LangFromPath(path); got != want {
			t.Fatalf("LangFromPath(%q) = %q, want %q", path, got, want)
		}
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/domain/`
Expected: FAIL (build errors: `undefined: ParseLineRange`, …)

- [ ] **Step 4: Implement the primitives**

`internal/domain/event.go`:

```go
package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

type Actor string

const (
	ActorAI     Actor = "ai"
	ActorUser   Actor = "user"
	ActorSystem Actor = "system"
)

// Event is one line of events.jsonl. Seq and TS are assigned when the event is appended to a session.
type Event struct {
	Seq   int64           `json:"seq"`
	TS    time.Time       `json:"ts"`
	Actor Actor           `json:"actor"`
	Type  string          `json:"type"`
	V     int             `json:"v"`
	Data  json.RawMessage `json:"data"`
}

// NewEvent builds an unsequenced event. Payloads are plain structs, so marshalling cannot fail.
func NewEvent(actor Actor, typ string, payload any) Event {
	data, err := json.Marshal(payload)
	if err != nil {
		panic(fmt.Sprintf("marshal %s payload: %v", typ, err))
	}
	return Event{Actor: actor, Type: typ, V: 1, Data: data}
}

func (e Event) Decode(into any) error {
	if err := json.Unmarshal(e.Data, into); err != nil {
		return fmt.Errorf("event %d (%s): %w", e.Seq, e.Type, err)
	}
	return nil
}
```

`internal/domain/lines.go`:

```go
package domain

import (
	"fmt"
	"strconv"
	"strings"
)

// LineRange is an inclusive, 1-based range of lines.
type LineRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// ParseLineRange parses "14" or "14-20".
func ParseLineRange(s string) (LineRange, error) {
	a, b, found := strings.Cut(strings.TrimSpace(s), "-")
	start, err := strconv.Atoi(a)
	if err != nil {
		return LineRange{}, fmt.Errorf("invalid line range %q: want N or N-M", s)
	}
	end := start
	if found {
		if end, err = strconv.Atoi(b); err != nil {
			return LineRange{}, fmt.Errorf("invalid line range %q: want N or N-M", s)
		}
	}
	if start < 1 || end < start {
		return LineRange{}, fmt.Errorf("invalid line range %q: lines start at 1 and end must be >= start", s)
	}
	return LineRange{Start: start, End: end}, nil
}

func (r LineRange) String() string {
	if r.Start == r.End {
		return strconv.Itoa(r.Start)
	}
	return fmt.Sprintf("%d-%d", r.Start, r.End)
}

// Within reports whether r lies inside the block lines [first, first+count-1].
func (r LineRange) Within(first, count int) bool {
	return r.Start >= first && r.End <= first+count-1
}

// CountLines counts lines in text; a trailing newline does not start a new line.
func CountLines(text string) int {
	if text == "" {
		return 0
	}
	return strings.Count(strings.TrimSuffix(text, "\n"), "\n") + 1
}
```

`internal/domain/ids.go`:

```go
package domain

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// FormatID builds a session-scoped sequential id such as "t_3".
func FormatID(prefix string, n int) string { return fmt.Sprintf("%s_%d", prefix, n) }

// NewSessionID returns a random session id such as "s_8f2a1c".
func NewSessionID() string {
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "s_" + hex.EncodeToString(b[:])
}
```

`internal/domain/lang.go`:

```go
package domain

import (
	"path/filepath"
	"strings"
)

var langByExt = map[string]string{
	".go": "go", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".py": "python",
	".md": "markdown", ".ts": "typescript", ".tsx": "tsx", ".js": "javascript",
	".json": "json", ".yaml": "yaml", ".yml": "yaml", ".sh": "bash", ".sql": "sql",
}

// LangFromPath guesses the highlighting language from a file extension ("text" when unknown).
func LangFromPath(path string) string {
	if lang, ok := langByExt[strings.ToLower(filepath.Ext(path))]; ok {
		return lang
	}
	return "text"
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./internal/domain/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add go.mod internal/domain
git commit -m "feat(domain): event envelope, line ranges, ids"
```

---

### Task 2: Domain state and structural reducer

**Files:**
- Create: `internal/domain/events.go`, `internal/domain/blocks.go`, `internal/domain/state.go`, `internal/domain/reducer.go`
- Test: `internal/domain/reducer_test.go`

**Interfaces:**
- Consumes: Task 1 (`Event`, `NewEvent`, `LineRange`)
- Produces:
  - event type constants `Ev*` (all of them, including the ones Task 3 folds), all payload structs listed in `events.go`
  - `type BlockKind string` (`KindNote`, `KindCode`, `KindFile`, `KindMarkdown`, `KindVariants`); `type BlockContent struct{Kind, Lang, Text, Path, BlobSHA; FirstLine, LineCount int; Content string}`; `func (c BlockContent) Annotatable() bool`
  - `type Variants struct{Title; Options []VariantOption}`; `type VariantOption struct{ID, Title, Description; Pros, Cons []string; Blocks []BlockContent}`; `func (v *Variants) Option(id string) *VariantOption`
  - `type State struct{Session; Stages []*Stage; Threads map[string]*Thread; Blocks map[string]*Block; LastSeq, LastAISeq, Delivered int64; EndRequested bool}`
  - `func NewState() *State`, `func Replay(events []Event) (*State, error)`, `func (s *State) Apply(e Event) error`, `func (s *State) Stage(id string) *Stage`
  - status types and constants: `SessionActive/SessionClosed`, `StageOpen/StageSummaryProposed/StageAccepted`, `ThreadOpen/ThreadConclusionProposed/ThreadResolved`
  - `func (t *Thread) AwaitingAI() bool`

- [ ] **Step 1: Write the failing tests**

`internal/domain/reducer_test.go`:

```go
package domain

import "testing"

func replay(t *testing.T, evs ...Event) *State {
	t.Helper()
	for i := range evs {
		evs[i].Seq = int64(i + 1)
	}
	s, err := Replay(evs)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	return s
}

func structureEvents() []Event {
	return []Event{
		NewEvent(ActorAI, EvSessionCreated, SessionCreated{ID: "s_1", Title: "Idea", ProjectID: "p"}),
		NewEvent(ActorAI, EvStageCreated, StageCreated{ID: "st_1", Title: "Data model", Goal: "Pick storage"}),
		NewEvent(ActorAI, EvThreadCreated, ThreadCreated{ID: "t_1", StageID: "st_1", Title: "Repo"}),
		NewEvent(ActorAI, EvBlockAdded, BlockAdded{ID: "b_1", ThreadID: "t_1",
			BlockContent: BlockContent{Kind: KindCode, Lang: "go", Text: "a\nb\n", FirstLine: 1, LineCount: 2}}),
		NewEvent(ActorAI, EvBlockAdded, BlockAdded{ID: "b_2", ThreadID: "t_1", Supersedes: "b_1",
			BlockContent: BlockContent{Kind: KindCode, Lang: "go", Text: "c\n", FirstLine: 1, LineCount: 1}}),
		NewEvent(ActorAI, EvAnnotationAdded, AnnotationAdded{BlockID: "b_2", Lines: LineRange{1, 1}, Text: "why"}),
		NewEvent(ActorAI, EvBlockAdded, BlockAdded{ID: "b_3", ThreadID: "t_1",
			BlockContent: BlockContent{Kind: KindVariants},
			Variants:     &Variants{Options: []VariantOption{{ID: "o_1", Title: "A"}, {ID: "o_2", Title: "B"}}}}),
		NewEvent(ActorAI, EvMessagePosted, MessagePosted{ThreadID: "t_1", Text: "hi"}),
	}
}

func TestReplayStructure(t *testing.T) {
	s := replay(t, structureEvents()...)

	if s.Session.ID != "s_1" || s.Session.Status != SessionActive {
		t.Fatalf("session = %+v", s.Session)
	}
	st := s.Stage("st_1")
	if st == nil || st.Status != StageOpen || st.Goal != "Pick storage" || len(st.ThreadIDs) != 1 {
		t.Fatalf("stage = %+v", st)
	}
	th := s.Threads["t_1"]
	if th.Status != ThreadOpen || len(th.BlockIDs) != 3 || len(th.Messages) != 1 || th.Messages[0].Actor != ActorAI {
		t.Fatalf("thread = %+v", th)
	}
	if s.Blocks["b_1"].SupersededBy != "b_2" {
		t.Fatal("b_1 should be superseded by b_2")
	}
	if a := s.Blocks["b_2"].Annotations; len(a) != 1 || a[0].Text != "why" {
		t.Fatalf("annotations = %+v", a)
	}
	if s.Blocks["b_3"].Variants.Option("o_2").Title != "B" {
		t.Fatal("variant option lookup")
	}
	if s.LastSeq != 8 || s.LastAISeq != 8 || th.LastAISeq != 8 {
		t.Fatalf("seqs: last=%d lastAI=%d thread.lastAI=%d", s.LastSeq, s.LastAISeq, th.LastAISeq)
	}
	if th.AwaitingAI() {
		t.Fatal("thread without user events must not await AI")
	}
}

func TestReplayRejectsUnknownEventType(t *testing.T) {
	evs := []Event{{Seq: 1, Type: "nope", Data: []byte(`{}`)}}
	if _, err := Replay(evs); err == nil {
		t.Fatal("want error for unknown event type")
	}
}

func TestReplayRejectsUnknownThread(t *testing.T) {
	evs := []Event{NewEvent(ActorAI, EvMessagePosted, MessagePosted{ThreadID: "t_9", Text: "x"})}
	evs[0].Seq = 1
	if _, err := Replay(evs); err == nil {
		t.Fatal("want error for unknown thread")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/domain/`
Expected: FAIL (`undefined: Replay`, `undefined: EvSessionCreated`, …)

- [ ] **Step 3: Implement events, blocks, state, reducer**

`internal/domain/events.go`:

```go
package domain

const (
	EvSessionCreated                = "session.created"
	EvSessionClosed                 = "session.closed"
	EvSessionEndRequested           = "session.end_requested"
	EvStageCreated                  = "stage.created"
	EvStageSummaryProposed          = "stage.summary.proposed"
	EvStageSummaryAccepted          = "stage.summary.accepted"
	EvStageSummaryChangesRequested  = "stage.summary.changes_requested"
	EvThreadCreated                 = "thread.created"
	EvBlockAdded                    = "block.added"
	EvAnnotationAdded               = "annotation.added"
	EvMessagePosted                 = "message.posted"
	EvConclusionProposed            = "conclusion.proposed"
	EvConclusionAccepted            = "conclusion.accepted"
	EvConclusionEdited              = "conclusion.edited"
	EvConclusionDiscussionRequested = "conclusion.discussion_requested"
	EvReviewSubmitted               = "review.submitted"
	EvVariantChosen                 = "variant.chosen"
	EvVariantsRejected              = "variants.rejected"
	EvAgentDelivered                = "agent.delivered"
)

type SessionCreated struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	ProjectID string `json:"projectId"`
}

type SessionClosed struct{}

type SessionEndRequested struct {
	Comment string `json:"comment,omitempty"`
}

type StageCreated struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Goal  string `json:"goal,omitempty"`
}

type StageSummaryProposed struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}

type StageSummaryAccepted struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}

type StageSummaryChangesRequested struct {
	StageID string `json:"stageId"`
	Comment string `json:"comment"`
}

type ThreadCreated struct {
	ID      string `json:"id"`
	StageID string `json:"stageId"`
	Title   string `json:"title"`
}

type BlockAdded struct {
	ID         string `json:"id"`
	ThreadID   string `json:"threadId"`
	Supersedes string `json:"supersedes,omitempty"`
	BlockContent
	Variants *Variants `json:"variants,omitempty"`
}

type AnnotationAdded struct {
	BlockID string    `json:"blockId"`
	Lines   LineRange `json:"lines"`
	Text    string    `json:"text"`
}

// MessagePosted is an AI chat message. User messages arrive inside ReviewSubmitted.
type MessagePosted struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

type ConclusionProposed struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

type ConclusionAccepted struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

type ConclusionEdited struct {
	ThreadID string `json:"threadId"`
	Original string `json:"original"`
	Text     string `json:"text"`
}

type ConclusionDiscussionRequested struct {
	ThreadID string `json:"threadId"`
	Comment  string `json:"comment"`
}

type ReviewSubmitted struct {
	Threads []ReviewThread `json:"threads"`
}

type ReviewThread struct {
	ThreadID string        `json:"threadId"`
	Comments []LineComment `json:"comments,omitempty"`
	Message  string        `json:"message,omitempty"`
}

type LineComment struct {
	BlockID string    `json:"blockId"`
	Lines   LineRange `json:"lines"`
	Text    string    `json:"text"`
}

type VariantChosen struct {
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
	Comment  string `json:"comment,omitempty"`
}

type VariantsRejected struct {
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	Comment  string `json:"comment"`
}

type AgentDelivered struct {
	UpTo int64 `json:"upTo"`
}
```

`internal/domain/blocks.go`:

```go
package domain

type BlockKind string

const (
	KindNote     BlockKind = "note"
	KindCode     BlockKind = "code"
	KindFile     BlockKind = "file"
	KindMarkdown BlockKind = "markdown"
	KindVariants BlockKind = "variants"
)

// BlockContent is the renderable content of a block; blocks nested in variant options use it too.
type BlockContent struct {
	Kind      BlockKind `json:"type"`
	Lang      string    `json:"lang,omitempty"`
	Text      string    `json:"text,omitempty"`
	Path      string    `json:"path,omitempty"`
	BlobSHA   string    `json:"blobSha,omitempty"`
	FirstLine int       `json:"firstLine,omitempty"`
	LineCount int       `json:"lineCount,omitempty"`
	// Content is transport-only: the CLI sends file excerpts here and the daemon moves them
	// into a blob before Decide, which rejects commands that still carry it.
	Content string `json:"content,omitempty"`
}

// Annotatable reports whether line annotations and line comments may target this content.
func (c BlockContent) Annotatable() bool {
	return c.Kind == KindCode || c.Kind == KindFile || c.Kind == KindMarkdown
}

type Variants struct {
	Title   string          `json:"title,omitempty"`
	Options []VariantOption `json:"options"`
}

type VariantOption struct {
	ID          string         `json:"id,omitempty"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Pros        []string       `json:"pros,omitempty"`
	Cons        []string       `json:"cons,omitempty"`
	Blocks      []BlockContent `json:"blocks,omitempty"`
}

func (v *Variants) Option(id string) *VariantOption {
	if v == nil {
		return nil
	}
	for i := range v.Options {
		if v.Options[i].ID == id {
			return &v.Options[i]
		}
	}
	return nil
}
```

`internal/domain/state.go`:

```go
package domain

type SessionStatus string
type StageStatus string
type ThreadStatus string

const (
	SessionActive SessionStatus = "active"
	SessionClosed SessionStatus = "closed"

	StageOpen            StageStatus = "open"
	StageSummaryProposed StageStatus = "summary_proposed"
	StageAccepted        StageStatus = "accepted"

	ThreadOpen               ThreadStatus = "open"
	ThreadConclusionProposed ThreadStatus = "conclusion_proposed"
	ThreadResolved           ThreadStatus = "resolved"
)

// State is the fold of a session's events. It is also the JSON the web UI receives.
type State struct {
	Session      Session            `json:"session"`
	Stages       []*Stage           `json:"stages"`
	Threads      map[string]*Thread `json:"threads"`
	Blocks       map[string]*Block  `json:"blocks"`
	LastSeq      int64              `json:"lastSeq"`
	LastAISeq    int64              `json:"lastAiSeq"`
	Delivered    int64              `json:"delivered"`
	EndRequested bool               `json:"endRequested"`
	optionCount  int
}

type Session struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	ProjectID string        `json:"projectId"`
	Status    SessionStatus `json:"status"`
}

type Stage struct {
	ID              string      `json:"id"`
	Title           string      `json:"title"`
	Goal            string      `json:"goal,omitempty"`
	Status          StageStatus `json:"status"`
	ProposedSummary string      `json:"proposedSummary,omitempty"`
	Summary         string      `json:"summary,omitempty"`
	ThreadIDs       []string    `json:"threadIds"`
}

type Thread struct {
	ID                 string        `json:"id"`
	StageID            string        `json:"stageId"`
	Title              string        `json:"title"`
	Status             ThreadStatus  `json:"status"`
	BlockIDs           []string      `json:"blockIds"`
	Messages           []Message     `json:"messages"`
	Comments           []LineComment `json:"comments"`
	ProposedConclusion string        `json:"proposedConclusion,omitempty"`
	Conclusion         string        `json:"conclusion,omitempty"`
	LastUserSeq        int64         `json:"lastUserSeq"`
	LastAISeq          int64         `json:"lastAiSeq"`
}

// AwaitingAI reports whether the user acted in this thread after the AI's last action.
func (t *Thread) AwaitingAI() bool {
	return t.Status != ThreadResolved && t.LastUserSeq > t.LastAISeq
}

type Message struct {
	Actor Actor  `json:"actor"`
	Text  string `json:"text"`
	Seq   int64  `json:"seq"`
}

type Block struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
	BlockContent
	Variants     *Variants    `json:"variants,omitempty"`
	Annotations  []Annotation `json:"annotations,omitempty"`
	SupersededBy string       `json:"supersededBy,omitempty"`
	ChosenOption string       `json:"chosenOption,omitempty"`
	Rejected     bool         `json:"rejected,omitempty"`
}

type Annotation struct {
	Lines LineRange `json:"lines"`
	Text  string    `json:"text"`
}

func NewState() *State {
	return &State{Threads: map[string]*Thread{}, Blocks: map[string]*Block{}}
}

func (s *State) Stage(id string) *Stage {
	for _, st := range s.Stages {
		if st.ID == id {
			return st
		}
	}
	return nil
}
```

`internal/domain/reducer.go`:

```go
package domain

import "fmt"

// Replay folds events into a fresh state.
func Replay(events []Event) (*State, error) {
	s := NewState()
	for _, e := range events {
		if err := s.Apply(e); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// Apply folds one sequenced event into the state.
func (s *State) Apply(e Event) error {
	if err := s.apply(e); err != nil {
		return err
	}
	s.LastSeq = e.Seq
	if e.Actor == ActorAI {
		s.LastAISeq = e.Seq
	}
	return nil
}

func decode[T any](e Event) (T, error) {
	var p T
	err := e.Decode(&p)
	return p, err
}

func unknown(kind, id string, e Event) error {
	return fmt.Errorf("event %d (%s): unknown %s %q", e.Seq, e.Type, kind, id)
}

func (s *State) apply(e Event) error {
	switch e.Type {
	case EvSessionCreated:
		p, err := decode[SessionCreated](e)
		if err != nil {
			return err
		}
		s.Session = Session{ID: p.ID, Title: p.Title, ProjectID: p.ProjectID, Status: SessionActive}
	case EvSessionClosed:
		s.Session.Status = SessionClosed
	case EvStageCreated:
		p, err := decode[StageCreated](e)
		if err != nil {
			return err
		}
		s.Stages = append(s.Stages, &Stage{ID: p.ID, Title: p.Title, Goal: p.Goal, Status: StageOpen})
	case EvThreadCreated:
		p, err := decode[ThreadCreated](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		s.Threads[p.ID] = &Thread{ID: p.ID, StageID: p.StageID, Title: p.Title, Status: ThreadOpen, LastAISeq: e.Seq}
		st.ThreadIDs = append(st.ThreadIDs, p.ID)
	case EvBlockAdded:
		p, err := decode[BlockAdded](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		s.Blocks[p.ID] = &Block{ID: p.ID, ThreadID: p.ThreadID, BlockContent: p.BlockContent, Variants: p.Variants}
		t.BlockIDs = append(t.BlockIDs, p.ID)
		if old := s.Blocks[p.Supersedes]; old != nil {
			old.SupersededBy = p.ID
		}
		if p.Variants != nil {
			s.optionCount += len(p.Variants.Options)
		}
		t.LastAISeq = e.Seq
	case EvAnnotationAdded:
		p, err := decode[AnnotationAdded](e)
		if err != nil {
			return err
		}
		b := s.Blocks[p.BlockID]
		if b == nil {
			return unknown("block", p.BlockID, e)
		}
		b.Annotations = append(b.Annotations, Annotation{Lines: p.Lines, Text: p.Text})
		s.Threads[b.ThreadID].LastAISeq = e.Seq
	case EvMessagePosted:
		p, err := decode[MessagePosted](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Messages = append(t.Messages, Message{Actor: ActorAI, Text: p.Text, Seq: e.Seq})
		t.LastAISeq = e.Seq
	default:
		return fmt.Errorf("event %d: unknown event type %q", e.Seq, e.Type)
	}
	return nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/domain/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/domain
git commit -m "feat(domain): state model and structural reducer"
```

---

### Task 3: Lifecycle and user-event folding, event references

**Files:**
- Modify: `internal/domain/reducer.go` (add cases before `default:` plus two `Thread` helpers)
- Create: `internal/domain/eventref.go`
- Test: `internal/domain/lifecycle_test.go`

**Interfaces:**
- Consumes: Task 2 (`State`, payloads, `replay` test helper in `reducer_test.go`)
- Produces:
  - Apply handles every `Ev*` type.
  - `func EventThreadIDs(s *State, e Event) []string`
  - `func EventStageID(s *State, e Event) string`
  - `func PendingUserEvents(events []Event, delivered int64) []Event`

- [ ] **Step 1: Write the failing tests**

`internal/domain/lifecycle_test.go`:

```go
package domain

import "testing"

func TestConclusionLifecycle(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),
		NewEvent(ActorUser, EvConclusionDiscussionRequested, ConclusionDiscussionRequested{ThreadID: "t_1", Comment: "not yet"}),
	)
	s := replay(t, evs...)
	th := s.Threads["t_1"]
	if th.Status != ThreadOpen || th.ProposedConclusion != "" || !th.AwaitingAI() {
		t.Fatalf("after discussion request: %+v", th)
	}
	if last := th.Messages[len(th.Messages)-1]; last.Actor != ActorUser || last.Text != "not yet" {
		t.Fatalf("discussion comment should be a user message, got %+v", last)
	}

	evs = append(evs,
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v2"}),
		NewEvent(ActorUser, EvConclusionEdited, ConclusionEdited{ThreadID: "t_1", Original: "v2", Text: "v2 edited"}),
	)
	s = replay(t, evs...)
	th = s.Threads["t_1"]
	if th.Status != ThreadResolved || th.Conclusion != "v2 edited" || th.AwaitingAI() {
		t.Fatalf("after edit: %+v", th)
	}
}

func TestStageSummaryLifecycle(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposed{StageID: "st_1", Text: "sum"}),
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "more"}),
	)
	st := replay(t, evs...).Stage("st_1")
	if st.Status != StageOpen || st.ProposedSummary != "" {
		t.Fatalf("after changes requested: %+v", st)
	}
	evs = append(evs,
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposed{StageID: "st_1", Text: "sum2"}),
		NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: "st_1", Text: "sum2"}),
	)
	st = replay(t, evs...).Stage("st_1")
	if st.Status != StageAccepted || st.Summary != "sum2" {
		t.Fatalf("after accept: %+v", st)
	}
}

func TestUserEvents(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorUser, EvReviewSubmitted, ReviewSubmitted{Threads: []ReviewThread{{
			ThreadID: "t_1",
			Comments: []LineComment{{BlockID: "b_2", Lines: LineRange{1, 1}, Text: "why?"}},
			Message:  "overall ok",
		}}}),
		NewEvent(ActorUser, EvVariantChosen, VariantChosen{ThreadID: "t_1", BlockID: "b_3", OptionID: "o_2"}),
		NewEvent(ActorUser, EvSessionEndRequested, SessionEndRequested{}),
		NewEvent(ActorSystem, EvAgentDelivered, AgentDelivered{UpTo: 10}),
	)
	s := replay(t, evs...)
	th := s.Threads["t_1"]
	if len(th.Comments) != 1 || th.Messages[len(th.Messages)-1].Text != "overall ok" {
		t.Fatalf("review not folded: %+v", th)
	}
	if s.Blocks["b_3"].ChosenOption != "o_2" || !th.AwaitingAI() {
		t.Fatal("variant choice not folded")
	}
	if !s.EndRequested || s.Delivered != 10 {
		t.Fatalf("EndRequested=%v Delivered=%d", s.EndRequested, s.Delivered)
	}

	s = replay(t, append(evs, NewEvent(ActorUser, EvVariantsRejected, VariantsRejected{ThreadID: "t_1", BlockID: "b_3", Comment: "none"}))...)
	if b := s.Blocks["b_3"]; !b.Rejected || b.ChosenOption != "" {
		t.Fatalf("rejection not folded: %+v", b)
	}
}

func TestEventRefsAndPending(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorUser, EvVariantChosen, VariantChosen{ThreadID: "t_1", BlockID: "b_3", OptionID: "o_1"}),
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "x"}),
		NewEvent(ActorUser, EvSessionEndRequested, SessionEndRequested{}),
	)
	s := replay(t, evs...)
	byType := map[string]Event{}
	for _, e := range evs {
		byType[e.Type] = e
	}
	if ids := EventThreadIDs(s, byType[EvAnnotationAdded]); len(ids) != 1 || ids[0] != "t_1" {
		t.Fatalf("annotation thread ids = %v", ids)
	}
	if got := EventStageID(s, byType[EvVariantChosen]); got != "st_1" {
		t.Fatalf("variant stage = %q", got)
	}
	if got := EventStageID(s, byType[EvStageSummaryChangesRequested]); got != "st_1" {
		t.Fatalf("summary stage = %q", got)
	}
	if got := EventStageID(s, byType[EvSessionEndRequested]); got != "" {
		t.Fatalf("session event stage = %q", got)
	}
	pending := PendingUserEvents(evs, 9)
	if len(pending) != 2 || pending[0].Seq != 10 {
		t.Fatalf("pending = %+v", pending)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/domain/`
Expected: FAIL (`unknown event type "conclusion.proposed"` from Replay; `undefined: EventThreadIDs`)

- [ ] **Step 3: Extend the reducer**

In `internal/domain/reducer.go`, insert these cases before `default:`:

```go
	case EvConclusionProposed:
		p, err := decode[ConclusionProposed](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Status, t.ProposedConclusion, t.LastAISeq = ThreadConclusionProposed, p.Text, e.Seq
	case EvConclusionAccepted:
		p, err := decode[ConclusionAccepted](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.resolve(p.Text, e.Seq)
	case EvConclusionEdited:
		p, err := decode[ConclusionEdited](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.resolve(p.Text, e.Seq)
	case EvConclusionDiscussionRequested:
		p, err := decode[ConclusionDiscussionRequested](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Status, t.ProposedConclusion = ThreadOpen, ""
		t.userMessage(p.Comment, e.Seq)
	case EvStageSummaryProposed:
		p, err := decode[StageSummaryProposed](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.Status, st.ProposedSummary = StageSummaryProposed, p.Text
	case EvStageSummaryAccepted:
		p, err := decode[StageSummaryAccepted](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.Status, st.Summary, st.ProposedSummary = StageAccepted, p.Text, ""
	case EvStageSummaryChangesRequested:
		p, err := decode[StageSummaryChangesRequested](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.Status, st.ProposedSummary = StageOpen, ""
	case EvReviewSubmitted:
		p, err := decode[ReviewSubmitted](e)
		if err != nil {
			return err
		}
		for _, rt := range p.Threads {
			t := s.Threads[rt.ThreadID]
			if t == nil {
				return unknown("thread", rt.ThreadID, e)
			}
			t.Comments = append(t.Comments, rt.Comments...)
			t.userMessage(rt.Message, e.Seq)
		}
	case EvVariantChosen:
		p, err := decode[VariantChosen](e)
		if err != nil {
			return err
		}
		b := s.Blocks[p.BlockID]
		if b == nil {
			return unknown("block", p.BlockID, e)
		}
		b.ChosenOption, b.Rejected = p.OptionID, false
		s.Threads[b.ThreadID].userMessage(p.Comment, e.Seq)
	case EvVariantsRejected:
		p, err := decode[VariantsRejected](e)
		if err != nil {
			return err
		}
		b := s.Blocks[p.BlockID]
		if b == nil {
			return unknown("block", p.BlockID, e)
		}
		b.ChosenOption, b.Rejected = "", true
		s.Threads[b.ThreadID].userMessage(p.Comment, e.Seq)
	case EvSessionEndRequested:
		s.EndRequested = true
	case EvAgentDelivered:
		p, err := decode[AgentDelivered](e)
		if err != nil {
			return err
		}
		s.Delivered = p.UpTo
```

Append to the end of `internal/domain/reducer.go`:

```go
// userMessage records user activity in the thread; empty text only bumps LastUserSeq.
func (t *Thread) userMessage(text string, seq int64) {
	if text != "" {
		t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: text, Seq: seq})
	}
	t.LastUserSeq = seq
}

func (t *Thread) resolve(conclusion string, seq int64) {
	t.Status, t.Conclusion, t.ProposedConclusion, t.LastUserSeq = ThreadResolved, conclusion, "", seq
}
```

- [ ] **Step 4: Add event references**

`internal/domain/eventref.go`:

```go
package domain

import "encoding/json"

type eventRef struct {
	ID       string `json:"id"`
	StageID  string `json:"stageId"`
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	Threads  []struct {
		ThreadID string `json:"threadId"`
	} `json:"threads"`
}

// EventThreadIDs returns the threads an event refers to; session- and stage-level events return nil.
func EventThreadIDs(s *State, e Event) []string {
	var r eventRef
	if json.Unmarshal(e.Data, &r) != nil {
		return nil
	}
	switch {
	case len(r.Threads) > 0:
		ids := make([]string, 0, len(r.Threads))
		for _, t := range r.Threads {
			ids = append(ids, t.ThreadID)
		}
		return ids
	case r.ThreadID != "":
		return []string{r.ThreadID}
	case r.BlockID != "":
		if b := s.Blocks[r.BlockID]; b != nil {
			return []string{b.ThreadID}
		}
	case e.Type == EvThreadCreated:
		return []string{r.ID}
	}
	return nil
}

// EventStageID returns the stage an event belongs to, or "" for session-level events.
func EventStageID(s *State, e Event) string {
	if ids := EventThreadIDs(s, e); len(ids) > 0 {
		if t := s.Threads[ids[0]]; t != nil {
			return t.StageID
		}
	}
	var r eventRef
	if json.Unmarshal(e.Data, &r) != nil {
		return ""
	}
	if r.StageID != "" {
		return r.StageID
	}
	if e.Type == EvStageCreated {
		return r.ID
	}
	return ""
}

// PendingUserEvents returns the user events after the delivered cursor, in order.
func PendingUserEvents(events []Event, delivered int64) []Event {
	var out []Event
	for _, e := range events {
		if e.Actor == ActorUser && e.Seq > delivered {
			out = append(out, e)
		}
	}
	return out
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./internal/domain/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/domain
git commit -m "feat(domain): fold lifecycle and user events, event references"
```

---

### Task 4: Commands, validation rules and `Decide`

**Files:**
- Create: `internal/domain/errors.go`, `internal/domain/commands.go`, `internal/domain/resolve.go`, `internal/domain/decide.go`, `internal/domain/domaintest/build.go`
- Test: `internal/domain/decide_test.go` (package `domain_test`)

**Interfaces:**
- Consumes: Tasks 1–3
- Produces:
  - `type Error struct{Code, Message, Hint string}` (json `code`, `message`, `hint`) with `Error()` and `NotFound() bool`; code constants `Code*` (listed in `errors.go`)
  - `type Command interface{ isCommand() }`
  - agent commands: `AddStage{Title, Goal}`, `AddThread{StageID, Title}`, `AddBlock{ThreadID, Supersedes; BlockContent; Variants *Variants}`, `Annotate{BlockID; Lines LineRange; Text}`, `Say{ThreadID, Text}`, `Conclude{ThreadID, Text}`, `ProposeStageSummary{StageID, Text}`, `CloseSession{}`
  - user commands: `SubmitReview{Threads []ReviewThread}`, `ChooseVariant{BlockID, OptionID, Comment}`, `RejectVariants{BlockID, Comment}`, `AcceptConclusion{ThreadID}`, `EditConclusion{ThreadID, Text}`, `RequestDiscussion{ThreadID, Comment}`, `AcceptStageSummary{StageID}`, `RequestStageChanges{StageID, Comment}`, `EndSession{Comment}`
  - `func DecodeCommand(actor Actor, typ string, data json.RawMessage) (Command, error)`
  - wire names: agent `stage.add`, `thread.add`, `block.add`, `annotate`, `say`, `conclude`, `stage.propose`, `session.close`; user `review.submit`, `variant.choose`, `variants.reject`, `conclusion.accept`, `conclusion.edit`, `conclusion.discuss`, `stage.accept`, `stage.request_changes`, `session.end`
  - `type Result struct{ID string; OptionIDs []string}` (json `id`, `optionIds`)
  - `func Decide(s *State, cmd Command) ([]Event, Result, error)`: returns unsequenced events; every returned error is a `*Error`
  - `domaintest.Build(t testing.TB, cmds ...domain.Command) (*domain.State, []domain.Event)`: starts with `session.created` for session `s_test`, titled `Test session`
  - `domaintest.Try(t testing.TB, cmds ...domain.Command) error`: builds all but the last command and returns the last command's `Decide` error

- [ ] **Step 1: Write the test helper package**

`internal/domain/domaintest/build.go`:

```go
// Package domaintest builds domain states from commands for tests in any package.
package domaintest

import (
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

// Build runs commands through Decide and Apply with sequential seqs, failing the test on any error.
// The session "s_test" titled "Test session" is created first.
func Build(t testing.TB, cmds ...domain.Command) (*domain.State, []domain.Event) {
	t.Helper()
	s := domain.NewState()
	var events []domain.Event
	apply := func(e domain.Event) {
		e.Seq = s.LastSeq + 1
		e.TS = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC).Add(time.Duration(e.Seq) * time.Second)
		if err := s.Apply(e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
		events = append(events, e)
	}
	apply(domain.NewEvent(domain.ActorAI, domain.EvSessionCreated,
		domain.SessionCreated{ID: "s_test", Title: "Test session", ProjectID: "p_test"}))
	for i, c := range cmds {
		evs, _, err := domain.Decide(s, c)
		if err != nil {
			t.Fatalf("command %d (%T): %v", i, c, err)
		}
		for _, e := range evs {
			apply(e)
		}
	}
	return s, events
}

// Try builds all commands but the last, then returns the Decide error of the last one.
func Try(t testing.TB, cmds ...domain.Command) error {
	t.Helper()
	s, _ := Build(t, cmds[:len(cmds)-1]...)
	_, _, err := domain.Decide(s, cmds[len(cmds)-1])
	return err
}
```

- [ ] **Step 2: Write the failing tests**

`internal/domain/decide_test.go`:

```go
package domain_test

import (
	"encoding/json"
	"errors"
	"testing"

	. "github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

var (
	stage    = &AddStage{Title: "Data model"}
	thread   = &AddThread{Title: "Repo"}
	code     = &AddBlock{BlockContent: BlockContent{Kind: KindCode, Lang: "kotlin", Text: "a\nb\nc\n"}}
	variants = &AddBlock{BlockContent: BlockContent{Kind: KindVariants},
		Variants: &Variants{Options: []VariantOption{{Title: "A"}, {Title: "B"}}}}
	conclude = &Conclude{Text: "done"}
	accept   = &AcceptConclusion{ThreadID: "t_1"}
)

func TestDecideHappyPath(t *testing.T) {
	s, events := domaintest.Build(t,
		stage, thread, code,
		&Annotate{BlockID: "b_1", Lines: LineRange{2, 3}, Text: "why"},
		variants, variants,
		&AddBlock{Supersedes: "b_1", BlockContent: BlockContent{Kind: KindCode, Lang: "kotlin", Text: "x\n"}},
		&Say{Text: "look"},
		&SubmitReview{Threads: []ReviewThread{{ThreadID: "t_1",
			Comments: []LineComment{{BlockID: "b_1", Lines: LineRange{1, 1}, Text: "hmm"}}}}},
		&ChooseVariant{BlockID: "b_2", OptionID: "o_2", Comment: "B is simpler"},
		conclude, accept,
		&ProposeStageSummary{Text: "summary"},
		&AcceptStageSummary{StageID: "st_1"},
	)
	if got := s.Blocks["b_3"].Variants.Options[1].ID; got != "o_4" {
		t.Fatalf("second variants block option id = %s, want o_4", got)
	}
	if s.Blocks["b_1"].SupersededBy != "b_4" || s.Blocks["b_1"].LineCount != 3 {
		t.Fatalf("b_1 = %+v", s.Blocks["b_1"])
	}
	if s.Threads["t_1"].Conclusion != "done" || s.Stage("st_1").Summary != "summary" {
		t.Fatal("lifecycle did not complete")
	}
	if last := events[len(events)-1]; last.Actor != ActorUser || last.Type != EvStageSummaryAccepted {
		t.Fatalf("last event = %s by %s", last.Type, last.Actor)
	}
}

func TestDecideResult(t *testing.T) {
	s, _ := domaintest.Build(t, stage, thread)
	_, res, err := Decide(s, variants)
	if err != nil || res.ID != "b_1" || len(res.OptionIDs) != 2 || res.OptionIDs[0] != "o_1" {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
}

func TestDecideRules(t *testing.T) {
	file := &AddBlock{BlockContent: BlockContent{Kind: KindFile, Path: "a.go", Content: "x"}}
	oneVariant := &AddBlock{BlockContent: BlockContent{Kind: KindVariants},
		Variants: &Variants{Options: []VariantOption{{Title: "A"}}}}
	proposeAccept := []Command{conclude, accept, &ProposeStageSummary{Text: "s"}, &AcceptStageSummary{StageID: "st_1"}}

	cases := []struct {
		name string
		cmds []Command
		code string
	}{
		{"thread without stage", []Command{&AddThread{Title: "x"}}, CodeNoOpenStage},
		{"empty title", []Command{&AddStage{Title: "  "}}, CodeInvalidInput},
		{"block without thread", []Command{stage, &AddBlock{BlockContent: BlockContent{Kind: KindNote, Text: "x"}}}, CodeNoOpenThread},
		{"code needs lang", []Command{stage, thread, &AddBlock{BlockContent: BlockContent{Kind: KindCode, Text: "x"}}}, CodeInvalidInput},
		{"unknown block type", []Command{stage, thread, &AddBlock{BlockContent: BlockContent{Kind: "image"}}}, CodeInvalidInput},
		{"content not stored as blob", []Command{stage, thread, file}, CodeInvalidInput},
		{"one variant", []Command{stage, thread, oneVariant}, CodeInvalidInput},
		{"annotation outside block", []Command{stage, thread, code, &Annotate{BlockID: "b_1", Lines: LineRange{3, 4}, Text: "x"}}, CodeInvalidInput},
		{"annotate variants", []Command{stage, thread, variants, &Annotate{BlockID: "b_1", Lines: LineRange{1, 1}, Text: "x"}}, CodeInvalidInput},
		{"unknown block", []Command{stage, thread, &Annotate{BlockID: "b_9", Lines: LineRange{1, 1}, Text: "x"}}, CodeBlockNotFound},
		{"propose with open thread", []Command{stage, thread, &ProposeStageSummary{Text: "s"}}, CodeThreadsUnresolved},
		{"accept without proposal", []Command{stage, thread, accept}, CodeNoConclusionProposed},
		{"say to resolved thread", []Command{stage, thread, conclude, accept, &Say{ThreadID: "t_1", Text: "x"}}, CodeThreadResolved},
		{"thread in accepted stage", append(append([]Command{stage, thread}, proposeAccept...), &AddThread{StageID: "st_1", Title: "y"}), CodeStageNotOpen},
		{"accept summary twice", append(append([]Command{stage, thread}, proposeAccept...), &AcceptStageSummary{StageID: "st_1"}), CodeNoSummaryProposed},
		{"unknown option", []Command{stage, thread, variants, &ChooseVariant{BlockID: "b_1", OptionID: "o_9"}}, CodeOptionNotFound},
		{"reject needs comment", []Command{stage, thread, variants, &RejectVariants{BlockID: "b_1"}}, CodeInvalidInput},
		{"discussion needs comment", []Command{stage, thread, conclude, &RequestDiscussion{ThreadID: "t_1"}}, CodeInvalidInput},
		{"empty review", []Command{stage, thread, &SubmitReview{}}, CodeInvalidInput},
		{"review needs explicit thread", []Command{stage, thread, &SubmitReview{Threads: []ReviewThread{{Message: "x"}}}}, CodeInvalidInput},
		{"review comment on another thread's block", []Command{stage, thread, code, &AddThread{Title: "other"},
			&SubmitReview{Threads: []ReviewThread{{ThreadID: "t_2",
				Comments: []LineComment{{BlockID: "b_1", Lines: LineRange{1, 1}, Text: "x"}}}}}}, CodeInvalidInput},
		{"supersede across threads", []Command{stage, thread, code, &AddThread{Title: "other"},
			&AddBlock{Supersedes: "b_1", BlockContent: BlockContent{Kind: KindNote, Text: "x"}}}, CodeInvalidInput},
		{"closed session", []Command{&CloseSession{}, stage}, CodeSessionClosed},
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
}

func TestThreadsUnresolvedHintListsThreads(t *testing.T) {
	err := domaintest.Try(t, stage, thread, &AddThread{Title: "b"}, &ProposeStageSummary{Text: "s"})
	var de *Error
	if !errors.As(err, &de) || de.Hint != "open threads: t_1, t_2; propose conclusions with `tdm conclude`" {
		t.Fatalf("hint = %q", de.Hint)
	}
}

func TestDecodeCommand(t *testing.T) {
	cmd, err := DecodeCommand(ActorAI, "thread.add", json.RawMessage(`{"title":"x","stageId":"st_1"}`))
	if err != nil || cmd.(*AddThread).StageID != "st_1" {
		t.Fatalf("cmd = %#v, err = %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorUser, "thread.add", nil); err == nil {
		t.Fatal("user must not be able to send agent commands")
	}
	if _, err := DecodeCommand(ActorAI, "variant.choose", nil); err == nil {
		t.Fatal("agent must not be able to send user commands")
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/domain/...`
Expected: FAIL (`undefined: AddStage`, `undefined: Decide`, …)

- [ ] **Step 4: Implement errors, commands, resolution and Decide**

`internal/domain/errors.go`:

```go
package domain

import (
	"fmt"
	"strings"
)

const (
	CodeInvalidCommand       = "invalid_command"
	CodeInvalidInput         = "invalid_input"
	CodeSessionClosed        = "session_closed"
	CodeSessionNotFound      = "session_not_found"
	CodeProjectNotFound      = "project_not_found"
	CodeStageNotFound        = "stage_not_found"
	CodeThreadNotFound       = "thread_not_found"
	CodeBlockNotFound        = "block_not_found"
	CodeOptionNotFound       = "option_not_found"
	CodeNoOpenStage          = "no_open_stage"
	CodeNoOpenThread         = "no_open_thread"
	CodeStageNotOpen         = "stage_not_open"
	CodeThreadResolved       = "thread_resolved"
	CodeThreadsUnresolved    = "threads_unresolved"
	CodeNoConclusionProposed = "no_conclusion_proposed"
	CodeNoSummaryProposed    = "no_summary_proposed"
)

// Error is a rule violation the caller can act on; Hint tells an agent how to recover.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func (e *Error) NotFound() bool { return strings.HasSuffix(e.Code, "_not_found") }

func errorf(code, hint, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...), Hint: hint}
}

func required(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return errorf(CodeInvalidInput, "", "%s is required", field)
	}
	return nil
}
```

`internal/domain/commands.go`:

```go
package domain

import "encoding/json"

type Command interface{ isCommand() }

// Agent commands.

type AddStage struct {
	Title string `json:"title"`
	Goal  string `json:"goal,omitempty"`
}

type AddThread struct {
	StageID string `json:"stageId,omitempty"`
	Title   string `json:"title"`
}

type AddBlock struct {
	ThreadID   string `json:"threadId,omitempty"`
	Supersedes string `json:"supersedes,omitempty"`
	BlockContent
	Variants *Variants `json:"variants,omitempty"`
}

type Annotate struct {
	BlockID string    `json:"blockId"`
	Lines   LineRange `json:"lines"`
	Text    string    `json:"text"`
}

type Say struct {
	ThreadID string `json:"threadId,omitempty"`
	Text     string `json:"text"`
}

type Conclude struct {
	ThreadID string `json:"threadId,omitempty"`
	Text     string `json:"text"`
}

type ProposeStageSummary struct {
	StageID string `json:"stageId,omitempty"`
	Text    string `json:"text"`
}

type CloseSession struct{}

// User commands (sent by the web UI).

type SubmitReview struct {
	Threads []ReviewThread `json:"threads"`
}

type ChooseVariant struct {
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
	Comment  string `json:"comment,omitempty"`
}

type RejectVariants struct {
	BlockID string `json:"blockId"`
	Comment string `json:"comment"`
}

type AcceptConclusion struct {
	ThreadID string `json:"threadId"`
}

type EditConclusion struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

type RequestDiscussion struct {
	ThreadID string `json:"threadId"`
	Comment  string `json:"comment"`
}

type AcceptStageSummary struct {
	StageID string `json:"stageId"`
}

type RequestStageChanges struct {
	StageID string `json:"stageId"`
	Comment string `json:"comment"`
}

type EndSession struct {
	Comment string `json:"comment,omitempty"`
}

func (*AddStage) isCommand()            {}
func (*AddThread) isCommand()           {}
func (*AddBlock) isCommand()            {}
func (*Annotate) isCommand()            {}
func (*Say) isCommand()                 {}
func (*Conclude) isCommand()            {}
func (*ProposeStageSummary) isCommand() {}
func (*CloseSession) isCommand()        {}
func (*SubmitReview) isCommand()        {}
func (*ChooseVariant) isCommand()       {}
func (*RejectVariants) isCommand()      {}
func (*AcceptConclusion) isCommand()    {}
func (*EditConclusion) isCommand()      {}
func (*RequestDiscussion) isCommand()   {}
func (*AcceptStageSummary) isCommand()  {}
func (*RequestStageChanges) isCommand() {}
func (*EndSession) isCommand()          {}

var commandFactories = map[Actor]map[string]func() Command{
	ActorAI: {
		"stage.add":     func() Command { return &AddStage{} },
		"thread.add":    func() Command { return &AddThread{} },
		"block.add":     func() Command { return &AddBlock{} },
		"annotate":      func() Command { return &Annotate{} },
		"say":           func() Command { return &Say{} },
		"conclude":      func() Command { return &Conclude{} },
		"stage.propose": func() Command { return &ProposeStageSummary{} },
		"session.close": func() Command { return &CloseSession{} },
	},
	ActorUser: {
		"review.submit":         func() Command { return &SubmitReview{} },
		"variant.choose":        func() Command { return &ChooseVariant{} },
		"variants.reject":       func() Command { return &RejectVariants{} },
		"conclusion.accept":     func() Command { return &AcceptConclusion{} },
		"conclusion.edit":       func() Command { return &EditConclusion{} },
		"conclusion.discuss":    func() Command { return &RequestDiscussion{} },
		"stage.accept":          func() Command { return &AcceptStageSummary{} },
		"stage.request_changes": func() Command { return &RequestStageChanges{} },
		"session.end":           func() Command { return &EndSession{} },
	},
}

// DecodeCommand turns a wire command {type, data} into a typed command the actor may send.
func DecodeCommand(actor Actor, typ string, data json.RawMessage) (Command, error) {
	f := commandFactories[actor][typ]
	if f == nil {
		return nil, errorf(CodeInvalidCommand, "", "unknown %s command %q", actor, typ)
	}
	cmd := f()
	if len(data) > 0 {
		if err := json.Unmarshal(data, cmd); err != nil {
			return nil, errorf(CodeInvalidInput, "", "decode %s: %v", typ, err)
		}
	}
	return cmd, nil
}
```

`internal/domain/resolve.go`:

```go
package domain

const hintShow = "run `tdm session show` to list stages and threads"

// openStage returns the stage (or the latest open one when id is empty) and checks it is open.
func (s *State) openStage(id string) (*Stage, error) {
	if id == "" {
		for i := len(s.Stages) - 1; i >= 0; i-- {
			if s.Stages[i].Status == StageOpen {
				return s.Stages[i], nil
			}
		}
		return nil, errorf(CodeNoOpenStage, "add one with `tdm stage add \"<title>\"`", "no open stage in session %s", s.Session.ID)
	}
	st := s.Stage(id)
	if st == nil {
		return nil, errorf(CodeStageNotFound, hintShow, "no stage %s in session %s", id, s.Session.ID)
	}
	if st.Status != StageOpen {
		return nil, errorf(CodeStageNotOpen, "add a new stage with `tdm stage add \"<title>\"`", "stage %s is %s", id, st.Status)
	}
	return st, nil
}

// activeThread returns the thread (or the latest unresolved one when id is empty) and checks it can change.
func (s *State) activeThread(id string) (*Thread, error) {
	if id == "" {
		for n := len(s.Threads); n >= 1; n-- {
			if t := s.Threads[FormatID("t", n)]; t.Status != ThreadResolved {
				id = t.ID
				break
			}
		}
		if id == "" {
			return nil, errorf(CodeNoOpenThread, "add one with `tdm thread add \"<title>\"`", "no open thread in session %s", s.Session.ID)
		}
	}
	t := s.Threads[id]
	if t == nil {
		return nil, errorf(CodeThreadNotFound, hintShow, "no thread %s in session %s", id, s.Session.ID)
	}
	if t.Status == ThreadResolved {
		return nil, errorf(CodeThreadResolved, "add a new thread with `tdm thread add \"<title>\"`", "thread %s is resolved", id)
	}
	if st := s.Stage(t.StageID); st.Status != StageOpen {
		return nil, errorf(CodeStageNotOpen, "add a new stage with `tdm stage add \"<title>\"`", "stage %s of thread %s is %s", st.ID, id, st.Status)
	}
	return t, nil
}

func (s *State) block(id string) (*Block, error) {
	b := s.Blocks[id]
	if b == nil {
		return nil, errorf(CodeBlockNotFound, "block ids are printed by `tdm block add`", "no block %s in session %s", id, s.Session.ID)
	}
	return b, nil
}

func (s *State) proposedThread(id string) (*Thread, error) {
	if err := required("threadId", id); err != nil {
		return nil, err
	}
	t, err := s.activeThread(id)
	if err != nil {
		return nil, err
	}
	if t.Status != ThreadConclusionProposed {
		return nil, errorf(CodeNoConclusionProposed, "wait for the AI to propose a conclusion", "thread %s has no proposed conclusion", id)
	}
	return t, nil
}

func (s *State) proposedStage(id string) (*Stage, error) {
	st := s.Stage(id)
	if st == nil {
		return nil, errorf(CodeStageNotFound, hintShow, "no stage %s in session %s", id, s.Session.ID)
	}
	if st.Status != StageSummaryProposed {
		return nil, errorf(CodeNoSummaryProposed, "wait for the AI to propose a stage summary", "stage %s has no proposed summary", id)
	}
	return st, nil
}

func checkLines(b *Block, r LineRange) error {
	if r.Start < 1 || r.End < r.Start || !r.Within(b.FirstLine, b.LineCount) {
		covers := LineRange{Start: b.FirstLine, End: b.FirstLine + b.LineCount - 1}
		return errorf(CodeInvalidInput, "block "+b.ID+" covers lines "+covers.String(), "lines %s are outside block %s", r, b.ID)
	}
	return nil
}
```

`internal/domain/decide.go`:

```go
package domain

import (
	"fmt"
	"strings"
)

type Result struct {
	ID        string   `json:"id,omitempty"`
	OptionIDs []string `json:"optionIds,omitempty"`
}

// Decide validates cmd against s and returns the unsequenced events it produces.
// Every error it returns is a *Error.
func Decide(s *State, cmd Command) ([]Event, Result, error) {
	if s.Session.Status == SessionClosed {
		return nil, Result{}, errorf(CodeSessionClosed, "start a new session with `tdm session new \"<title>\"`", "session %s is closed", s.Session.ID)
	}
	switch c := cmd.(type) {
	case *AddStage:
		return decideAddStage(s, c)
	case *AddThread:
		return decideAddThread(s, c)
	case *AddBlock:
		return decideAddBlock(s, c)
	case *Annotate:
		return decideAnnotate(s, c)
	case *Say:
		return decideThreadText(s, c.ThreadID, c.Text, func(id string) Event {
			return NewEvent(ActorAI, EvMessagePosted, MessagePosted{ThreadID: id, Text: c.Text})
		})
	case *Conclude:
		return decideThreadText(s, c.ThreadID, c.Text, func(id string) Event {
			return NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: id, Text: c.Text})
		})
	case *ProposeStageSummary:
		return decideProposeStage(s, c)
	case *CloseSession:
		return one(NewEvent(ActorAI, EvSessionClosed, SessionClosed{}), s.Session.ID)
	case *SubmitReview:
		return decideReview(s, c)
	case *ChooseVariant:
		return decideVariantAction(s, c.BlockID, func(t *Thread, b *Block) (Event, error) {
			if b.Variants.Option(c.OptionID) == nil {
				return Event{}, errorf(CodeOptionNotFound, "option ids are listed in block "+b.ID, "no option %s in block %s", c.OptionID, b.ID)
			}
			return NewEvent(ActorUser, EvVariantChosen, VariantChosen{ThreadID: t.ID, BlockID: b.ID, OptionID: c.OptionID, Comment: c.Comment}), nil
		})
	case *RejectVariants:
		return decideVariantAction(s, c.BlockID, func(t *Thread, b *Block) (Event, error) {
			if err := required("comment", c.Comment); err != nil {
				return Event{}, err
			}
			return NewEvent(ActorUser, EvVariantsRejected, VariantsRejected{ThreadID: t.ID, BlockID: b.ID, Comment: c.Comment}), nil
		})
	case *AcceptConclusion:
		t, err := s.proposedThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvConclusionAccepted, ConclusionAccepted{ThreadID: t.ID, Text: t.ProposedConclusion}), t.ID)
	case *EditConclusion:
		t, err := s.proposedThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		if err := required("text", c.Text); err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvConclusionEdited, ConclusionEdited{ThreadID: t.ID, Original: t.ProposedConclusion, Text: c.Text}), t.ID)
	case *RequestDiscussion:
		t, err := s.proposedThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		if err := required("comment", c.Comment); err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvConclusionDiscussionRequested, ConclusionDiscussionRequested{ThreadID: t.ID, Comment: c.Comment}), t.ID)
	case *AcceptStageSummary:
		st, err := s.proposedStage(c.StageID)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: st.ID, Text: st.ProposedSummary}), st.ID)
	case *RequestStageChanges:
		st, err := s.proposedStage(c.StageID)
		if err != nil {
			return nil, Result{}, err
		}
		if err := required("comment", c.Comment); err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: st.ID, Comment: c.Comment}), st.ID)
	case *EndSession:
		return one(NewEvent(ActorUser, EvSessionEndRequested, SessionEndRequested{Comment: c.Comment}), s.Session.ID)
	}
	return nil, Result{}, errorf(CodeInvalidCommand, "", "unsupported command %T", cmd)
}

func one(e Event, id string) ([]Event, Result, error) { return []Event{e}, Result{ID: id}, nil }

func decideAddStage(s *State, c *AddStage) ([]Event, Result, error) {
	if err := required("title", c.Title); err != nil {
		return nil, Result{}, err
	}
	id := FormatID("st", len(s.Stages)+1)
	return one(NewEvent(ActorAI, EvStageCreated, StageCreated{ID: id, Title: c.Title, Goal: c.Goal}), id)
}

func decideAddThread(s *State, c *AddThread) ([]Event, Result, error) {
	if err := required("title", c.Title); err != nil {
		return nil, Result{}, err
	}
	st, err := s.openStage(c.StageID)
	if err != nil {
		return nil, Result{}, err
	}
	id := FormatID("t", len(s.Threads)+1)
	return one(NewEvent(ActorAI, EvThreadCreated, ThreadCreated{ID: id, StageID: st.ID, Title: c.Title}), id)
}

func decideAddBlock(s *State, c *AddBlock) ([]Event, Result, error) {
	t, err := s.activeThread(c.ThreadID)
	if err != nil {
		return nil, Result{}, err
	}
	if c.Supersedes != "" {
		old, err := s.block(c.Supersedes)
		if err != nil {
			return nil, Result{}, err
		}
		if old.ThreadID != t.ID {
			return nil, Result{}, errorf(CodeInvalidInput, "", "block %s belongs to thread %s, not %s", old.ID, old.ThreadID, t.ID)
		}
	}
	content, err := normalizeContent(c.BlockContent, true)
	if err != nil {
		return nil, Result{}, err
	}
	var variants *Variants
	if content.Kind == KindVariants {
		if variants, err = s.assignOptionIDs(c.Variants); err != nil {
			return nil, Result{}, err
		}
	} else if c.Variants != nil {
		return nil, Result{}, errorf(CodeInvalidInput, "", "variants are only allowed on blocks of type variants")
	}
	id := FormatID("b", len(s.Blocks)+1)
	res := Result{ID: id}
	if variants != nil {
		for _, o := range variants.Options {
			res.OptionIDs = append(res.OptionIDs, o.ID)
		}
	}
	e := NewEvent(ActorAI, EvBlockAdded, BlockAdded{ID: id, ThreadID: t.ID, Supersedes: c.Supersedes, BlockContent: content, Variants: variants})
	return []Event{e}, res, nil
}

// normalizeContent validates block content and fills in line metadata; top is false for nested blocks.
func normalizeContent(c BlockContent, top bool) (BlockContent, error) {
	if c.Content != "" {
		return c, errorf(CodeInvalidInput, "", "content must be stored as a blob before deciding")
	}
	switch c.Kind {
	case KindNote:
		if err := required("text", c.Text); err != nil {
			return c, err
		}
	case KindCode:
		if err := required("text", c.Text); err != nil {
			return c, err
		}
		if strings.TrimSpace(c.Lang) == "" {
			return c, errorf(CodeInvalidInput, "pass --lang, e.g. --lang kotlin", "code blocks need a language")
		}
		c.FirstLine, c.LineCount = 1, CountLines(c.Text)
	case KindFile:
		if c.Path == "" || c.BlobSHA == "" || c.LineCount < 1 {
			return c, errorf(CodeInvalidInput, "", "file blocks need a path, a blob and a line count")
		}
		c.FirstLine = max(c.FirstLine, 1)
	case KindMarkdown:
		c.Lang = "markdown"
		if c.BlobSHA == "" {
			if err := required("text", c.Text); err != nil {
				return c, err
			}
			c.FirstLine, c.LineCount = 1, CountLines(c.Text)
		} else if c.LineCount < 1 {
			return c, errorf(CodeInvalidInput, "", "markdown blob needs a line count")
		} else {
			c.FirstLine = max(c.FirstLine, 1)
		}
	case KindVariants:
		if !top {
			return c, errorf(CodeInvalidInput, "", "variants cannot be nested")
		}
	default:
		return c, errorf(CodeInvalidInput, "use one of: note, code, file, markdown, variants", "unknown block type %q", c.Kind)
	}
	return c, nil
}

func (s *State) assignOptionIDs(v *Variants) (*Variants, error) {
	if v == nil || len(v.Options) < 2 {
		return nil, errorf(CodeInvalidInput, "pass JSON with at least two options via --input -", "variants need at least 2 options")
	}
	out := &Variants{Title: v.Title}
	for i, o := range v.Options {
		if err := required(fmt.Sprintf("options[%d].title", i), o.Title); err != nil {
			return nil, err
		}
		o.ID = FormatID("o", s.optionCount+i+1)
		blocks := make([]BlockContent, 0, len(o.Blocks))
		for _, b := range o.Blocks {
			nb, err := normalizeContent(b, false)
			if err != nil {
				return nil, err
			}
			blocks = append(blocks, nb)
		}
		o.Blocks = blocks
		out.Options = append(out.Options, o)
	}
	return out, nil
}

func decideAnnotate(s *State, c *Annotate) ([]Event, Result, error) {
	b, err := s.block(c.BlockID)
	if err != nil {
		return nil, Result{}, err
	}
	if !b.Annotatable() {
		return nil, Result{}, errorf(CodeInvalidInput, "annotate code, file or markdown blocks", "block %s (%s) cannot be annotated", b.ID, b.Kind)
	}
	if _, err := s.activeThread(b.ThreadID); err != nil {
		return nil, Result{}, err
	}
	if err := checkLines(b, c.Lines); err != nil {
		return nil, Result{}, err
	}
	if err := required("text", c.Text); err != nil {
		return nil, Result{}, err
	}
	return one(NewEvent(ActorAI, EvAnnotationAdded, AnnotationAdded{BlockID: b.ID, Lines: c.Lines, Text: c.Text}), b.ID)
}

func decideThreadText(s *State, threadID, text string, mk func(id string) Event) ([]Event, Result, error) {
	t, err := s.activeThread(threadID)
	if err != nil {
		return nil, Result{}, err
	}
	if err := required("text", text); err != nil {
		return nil, Result{}, err
	}
	return one(mk(t.ID), t.ID)
}

func decideProposeStage(s *State, c *ProposeStageSummary) ([]Event, Result, error) {
	if err := required("text", c.Text); err != nil {
		return nil, Result{}, err
	}
	var st *Stage
	if c.StageID == "" {
		for i := len(s.Stages) - 1; i >= 0 && st == nil; i-- {
			if s.Stages[i].Status != StageAccepted {
				st = s.Stages[i]
			}
		}
		if st == nil {
			return nil, Result{}, errorf(CodeNoOpenStage, "add one with `tdm stage add \"<title>\"`", "no open stage in session %s", s.Session.ID)
		}
	} else if st = s.Stage(c.StageID); st == nil {
		return nil, Result{}, errorf(CodeStageNotFound, hintShow, "no stage %s in session %s", c.StageID, s.Session.ID)
	}
	if st.Status == StageAccepted {
		return nil, Result{}, errorf(CodeStageNotOpen, "add a new stage with `tdm stage add \"<title>\"`", "stage %s is already accepted", st.ID)
	}
	var open []string
	for _, id := range st.ThreadIDs {
		if s.Threads[id].Status != ThreadResolved {
			open = append(open, id)
		}
	}
	if len(open) > 0 {
		return nil, Result{}, errorf(CodeThreadsUnresolved,
			"open threads: "+strings.Join(open, ", ")+"; propose conclusions with `tdm conclude`",
			"stage %s has %d unresolved thread(s)", st.ID, len(open))
	}
	return one(NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposed{StageID: st.ID, Text: c.Text}), st.ID)
}

func decideReview(s *State, c *SubmitReview) ([]Event, Result, error) {
	if len(c.Threads) == 0 {
		return nil, Result{}, errorf(CodeInvalidInput, "", "review has no threads")
	}
	for _, rt := range c.Threads {
		if err := required("threadId", rt.ThreadID); err != nil {
			return nil, Result{}, err
		}
		t, err := s.activeThread(rt.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		if len(rt.Comments) == 0 && strings.TrimSpace(rt.Message) == "" {
			return nil, Result{}, errorf(CodeInvalidInput, "", "thread %s: review needs a comment or a message", t.ID)
		}
		for _, cm := range rt.Comments {
			b, err := s.block(cm.BlockID)
			if err != nil {
				return nil, Result{}, err
			}
			if b.ThreadID != t.ID {
				return nil, Result{}, errorf(CodeInvalidInput, "", "block %s is not in thread %s", b.ID, t.ID)
			}
			if !b.Annotatable() {
				return nil, Result{}, errorf(CodeInvalidInput, "", "block %s (%s) takes no line comments", b.ID, b.Kind)
			}
			if err := checkLines(b, cm.Lines); err != nil {
				return nil, Result{}, err
			}
			if err := required("comment text", cm.Text); err != nil {
				return nil, Result{}, err
			}
		}
	}
	return one(NewEvent(ActorUser, EvReviewSubmitted, ReviewSubmitted{Threads: c.Threads}), "")
}

func decideVariantAction(s *State, blockID string, mk func(*Thread, *Block) (Event, error)) ([]Event, Result, error) {
	b, err := s.block(blockID)
	if err != nil {
		return nil, Result{}, err
	}
	if b.Kind != KindVariants {
		return nil, Result{}, errorf(CodeInvalidInput, "", "block %s is not a variants block", b.ID)
	}
	t, err := s.activeThread(b.ThreadID)
	if err != nil {
		return nil, Result{}, err
	}
	e, err := mk(t, b)
	if err != nil {
		return nil, Result{}, err
	}
	return one(e, b.ID)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./internal/domain/...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/domain
git commit -m "feat(domain): commands, rules and Decide"
```

---

### Task 5: Store: JSONL log, blobs, projects, daemon info

**Files:**
- Create: `internal/store/paths.go`, `internal/store/fsutil.go`, `internal/store/log.go`, `internal/store/blobs.go`, `internal/store/project.go`, `internal/store/daemoninfo.go`
- Test: `internal/store/store_test.go`

**Interfaces:**
- Consumes: `domain.Event`, `domain.NewEvent`
- Produces:
  - `func Home() (string, error)`, `func ProjectDir(home, pid string) string`, `func SessionDir(home, pid, sid string) string`
  - `type Log`, `func OpenLog(path string) (*Log, []domain.Event, string, error)` (the string is a warning), `func (l *Log) Append(events []domain.Event) error`, `func (l *Log) Close() error`
  - `func PutBlob(dir string, content []byte) (string, error)`, `func GetBlob(dir, sha string) ([]byte, error)`
  - `type Project struct{ID, RootPath, Name, ActiveSessionID string}` (json `id`, `rootPath`, `name`, `activeSessionId`)
  - `func ProjectFor(dir string) (Project, error)`, `func LoadProject(home, id string) (*Project, error)` (nil, nil when missing), `func SaveProject(home string, p Project) error`, `func SessionIndex(home string) (map[string]string, error)` (sid → pid)
  - `type DaemonInfo struct{Port, PID int; Version, Token string}` (json `port`, `pid`, `version`, `token`)
  - `func WriteDaemonInfo(home string, info DaemonInfo) error`, `func ReadDaemonInfo(home string) (DaemonInfo, error)`, `func RemoveDaemonInfo(home string, pid int) error` (pid 0 = remove unconditionally)

- [ ] **Step 1: Write the failing tests**

`internal/store/store_test.go`:

```go
package store

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

func event(seq int64, typ string) domain.Event {
	e := domain.NewEvent(domain.ActorAI, typ, map[string]int64{"n": seq})
	e.Seq = seq
	return e
}

func TestLogRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s", "events.jsonl")
	l, evs, warn, err := OpenLog(path)
	if err != nil || len(evs) != 0 || warn != "" {
		t.Fatalf("open empty: %v %v %q", evs, err, warn)
	}
	if err := l.Append([]domain.Event{event(1, "a"), event(2, "b")}); err != nil {
		t.Fatal(err)
	}
	l.Close()
	l, evs, warn, err = OpenLog(path)
	if err != nil || warn != "" || len(evs) != 2 || evs[1].Type != "b" || evs[1].Seq != 2 {
		t.Fatalf("reopen: %+v %v %q", evs, err, warn)
	}
	l.Close()
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("log mode = %v", info.Mode().Perm())
	}
}

func TestLogDropsTruncatedLastLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	l, _, _, _ := OpenLog(path)
	l.Append([]domain.Event{event(1, "a")})
	l.Close()
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString(`{"seq":2,"ty`)
	f.Close()

	l, evs, warn, err := OpenLog(path)
	if err != nil || len(evs) != 1 || warn == "" {
		t.Fatalf("got %d events, err %v, warn %q", len(evs), err, warn)
	}
	if err := l.Append([]domain.Event{event(2, "b")}); err != nil {
		t.Fatal(err)
	}
	l.Close()
	_, evs, warn, err = OpenLog(path)
	if err != nil || len(evs) != 2 || warn != "" {
		t.Fatalf("after repair: %d events, err %v, warn %q", len(evs), err, warn)
	}
}

func TestLogRejectsCorruptMiddleLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	os.WriteFile(path, []byte("garbage\n{\"seq\":2,\"type\":\"a\",\"data\":{}}\n"), 0o600)
	if _, _, _, err := OpenLog(path); err == nil || !strings.Contains(err.Error(), "line 1") {
		t.Fatalf("want line 1 error, got %v", err)
	}
}

func TestBlobs(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "blobs")
	a, err := PutBlob(dir, []byte("hello\n"))
	if err != nil || len(a) != 64 {
		t.Fatalf("PutBlob = %q, %v", a, err)
	}
	b, _ := PutBlob(dir, []byte("hello\n"))
	if a != b {
		t.Fatal("same content must give the same id")
	}
	got, err := GetBlob(dir, a)
	if err != nil || string(got) != "hello\n" {
		t.Fatalf("GetBlob = %q, %v", got, err)
	}
	if _, err := GetBlob(dir, "../../etc/passwd"); err == nil {
		t.Fatal("GetBlob must reject non-sha ids")
	}
}

func TestProjectForGitSubdir(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, out)
	}
	sub := filepath.Join(root, "a", "b")
	os.MkdirAll(sub, 0o700)
	p1, err1 := ProjectFor(sub)
	p2, err2 := ProjectFor(root)
	want, _ := filepath.EvalSymlinks(root)
	if err1 != nil || err2 != nil || p1.ID != p2.ID || p1.RootPath != want || len(p1.ID) != 12 {
		t.Fatalf("p1=%+v p2=%+v want root %s", p1, p2, want)
	}
}

func TestProjectForNonGit(t *testing.T) {
	dir := t.TempDir()
	p, err := ProjectFor(dir)
	want, _ := filepath.EvalSymlinks(dir)
	if err != nil || p.RootPath != want || p.Name != filepath.Base(want) {
		t.Fatalf("p = %+v, err = %v", p, err)
	}
}

func TestProjectSaveLoadAndIndex(t *testing.T) {
	home := t.TempDir()
	if p, err := LoadProject(home, "nope"); p != nil || err != nil {
		t.Fatalf("missing project: %v %v", p, err)
	}
	want := Project{ID: "abc", RootPath: "/x", Name: "x", ActiveSessionID: "s_1"}
	if err := SaveProject(home, want); err != nil {
		t.Fatal(err)
	}
	got, err := LoadProject(home, "abc")
	if err != nil || *got != want {
		t.Fatalf("got %+v, %v", got, err)
	}
	os.MkdirAll(SessionDir(home, "abc", "s_1"), 0o700)
	idx, err := SessionIndex(home)
	if err != nil || idx["s_1"] != "abc" {
		t.Fatalf("index = %v, %v", idx, err)
	}
}

func TestDaemonInfo(t *testing.T) {
	home := t.TempDir()
	if _, err := ReadDaemonInfo(home); err == nil {
		t.Fatal("want error when missing")
	}
	info := DaemonInfo{Port: 1234, PID: 42, Version: "v1", Token: "tok"}
	if err := WriteDaemonInfo(home, info); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(filepath.Join(home, "daemon.json")); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v", st.Mode().Perm())
	}
	got, err := ReadDaemonInfo(home)
	if err != nil || got != info {
		t.Fatalf("got %+v, %v", got, err)
	}
	RemoveDaemonInfo(home, 7) // another pid: keep
	if _, err := ReadDaemonInfo(home); err != nil {
		t.Fatal("file removed by a different pid")
	}
	RemoveDaemonInfo(home, 42)
	if _, err := ReadDaemonInfo(home); err == nil {
		t.Fatal("file should be removed")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/store/`
Expected: FAIL (`undefined: OpenLog`, …)

- [ ] **Step 3: Implement the store**

`internal/store/paths.go`:

```go
package store

import (
	"os"
	"path/filepath"
)

// Home is TANDEM_HOME or ~/.tandem.
func Home() (string, error) {
	if h := os.Getenv("TANDEM_HOME"); h != "" {
		return h, nil
	}
	u, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(u, ".tandem"), nil
}

func ProjectDir(home, pid string) string { return filepath.Join(home, "projects", pid) }

func SessionDir(home, pid, sid string) string {
	return filepath.Join(ProjectDir(home, pid), "sessions", sid)
}
```

`internal/store/fsutil.go`:

```go
package store

import (
	"os"
	"path/filepath"
)

// writeFileAtomic writes data to a temp file in the same directory and renames it into place.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), perm); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
```

`internal/store/log.go`:

```go
package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

// Log is an append-only events.jsonl file with one writer.
type Log struct{ f *os.File }

// OpenLog reads every event in path and opens the file for appending, creating it if needed.
// A malformed or unterminated final line (a crash mid-write) is cut off and reported as a warning;
// a malformed line anywhere else is an error.
func OpenLog(path string) (*Log, []domain.Event, string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, nil, "", err
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, nil, "", err
	}
	events, good, warning, err := parseLog(data)
	if err != nil {
		return nil, nil, "", fmt.Errorf("%s: %w", path, err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, nil, "", err
	}
	if err := f.Truncate(int64(good)); err != nil {
		f.Close()
		return nil, nil, "", err
	}
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		f.Close()
		return nil, nil, "", err
	}
	return &Log{f: f}, events, warning, nil
}

// parseLog returns the events and the byte offset just after the last good line.
func parseLog(data []byte) ([]domain.Event, int, string, error) {
	var events []domain.Event
	offset, lineNo := 0, 0
	for offset < len(data) {
		lineNo++
		rest := data[offset:]
		end := bytes.IndexByte(rest, '\n')
		terminated := end >= 0
		if !terminated {
			end = len(rest)
		}
		line, next := rest[:end], offset+end
		if terminated {
			next++
		}
		if len(bytes.TrimSpace(line)) == 0 {
			offset = next
			continue
		}
		var e domain.Event
		err := json.Unmarshal(line, &e)
		if err != nil || !terminated {
			if next < len(data) {
				return nil, 0, "", fmt.Errorf("line %d: %v", lineNo, err)
			}
			return events, offset, fmt.Sprintf("dropped truncated line %d", lineNo), nil
		}
		events = append(events, e)
		offset = next
	}
	return events, offset, "", nil
}

// Append writes the events as JSON lines in one write and fsyncs.
func (l *Log) Append(events []domain.Event) error {
	var buf bytes.Buffer
	for _, e := range events {
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	if _, err := l.f.Write(buf.Bytes()); err != nil {
		return err
	}
	return l.f.Sync()
}

func (l *Log) Close() error { return l.f.Close() }
```

`internal/store/blobs.go`:

```go
package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// PutBlob stores content under its sha256 and returns the hex id; identical content is stored once.
func PutBlob(dir string, content []byte) (string, error) {
	sum := sha256.Sum256(content)
	sha := hex.EncodeToString(sum[:])
	path := filepath.Join(dir, sha)
	if _, err := os.Stat(path); err == nil {
		return sha, nil
	}
	if err := writeFileAtomic(path, content, 0o600); err != nil {
		return "", err
	}
	return sha, nil
}

func GetBlob(dir, sha string) ([]byte, error) {
	if !shaPattern.MatchString(sha) {
		return nil, fmt.Errorf("invalid blob id %q", sha)
	}
	return os.ReadFile(filepath.Join(dir, sha))
}
```

`internal/store/project.go`:

```go
package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Project struct {
	ID              string `json:"id"`
	RootPath        string `json:"rootPath"`
	Name            string `json:"name"`
	ActiveSessionID string `json:"activeSessionId,omitempty"`
}

// ProjectFor identifies the project containing dir: its git root, or dir itself outside git.
func ProjectFor(dir string) (Project, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return Project{}, err
	}
	if out, err := exec.Command("git", "-C", root, "rev-parse", "--show-toplevel").Output(); err == nil {
		root = strings.TrimSpace(string(out))
	}
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	sum := sha256.Sum256([]byte(root))
	return Project{ID: hex.EncodeToString(sum[:])[:12], RootPath: root, Name: filepath.Base(root)}, nil
}

func projectFile(home, id string) string { return filepath.Join(ProjectDir(home, id), "project.json") }

// LoadProject returns nil, nil when the project has never been saved.
func LoadProject(home, id string) (*Project, error) {
	data, err := os.ReadFile(projectFile(home, id))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func SaveProject(home string, p Project) error {
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(projectFile(home, p.ID), data, 0o600)
}

// SessionIndex maps every session id on disk to its project id.
func SessionIndex(home string) (map[string]string, error) {
	matches, err := filepath.Glob(filepath.Join(home, "projects", "*", "sessions", "*"))
	if err != nil {
		return nil, err
	}
	idx := make(map[string]string, len(matches))
	for _, m := range matches {
		idx[filepath.Base(m)] = filepath.Base(filepath.Dir(filepath.Dir(m)))
	}
	return idx, nil
}
```

`internal/store/daemoninfo.go`:

```go
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type DaemonInfo struct {
	Port    int    `json:"port"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
	Token   string `json:"token"`
}

func daemonFile(home string) string { return filepath.Join(home, "daemon.json") }

func WriteDaemonInfo(home string, info DaemonInfo) error {
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return writeFileAtomic(daemonFile(home), data, 0o600)
}

func ReadDaemonInfo(home string) (DaemonInfo, error) {
	var info DaemonInfo
	data, err := os.ReadFile(daemonFile(home))
	if err != nil {
		return info, err
	}
	err = json.Unmarshal(data, &info)
	return info, err
}

// RemoveDaemonInfo deletes daemon.json; with pid != 0 only when the file belongs to that process.
func RemoveDaemonInfo(home string, pid int) error {
	if pid != 0 {
		if info, err := ReadDaemonInfo(home); err != nil || info.PID != pid {
			return nil
		}
	}
	if err := os.Remove(daemonFile(home)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/store/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/store
git commit -m "feat(store): jsonl event log, blobs, projects, daemon info"
```

---

### Task 6: Session manager (single writer, notifications, blobs)

**Files:**
- Create: `internal/daemon/manager.go`, `internal/daemon/content.go`
- Test: `internal/daemon/manager_test.go`

**Interfaces:**
- Consumes: `domain.Decide/Replay/Apply/NewEvent`, `store.OpenLog/PutBlob/GetBlob/SaveProject/LoadProject/SessionIndex/SessionDir`
- Produces:
  - `func NewManager(home string) (*Manager, error)`, `func (m *Manager) Close() error`
  - `func (m *Manager) Create(p store.Project, title string) (*Session, error)`: new session, becomes the project's active session
  - `func (m *Manager) Get(sid string) (*Session, error)`: `*domain.Error{Code: CodeSessionNotFound}` when unknown
  - `type SessionInfo struct{ID, Title string; Status domain.SessionStatus; Active bool}` (json `id`, `title`, `status`, `active`); `func (m *Manager) Sessions(pid string) ([]SessionInfo, error)`
  - `func (m *Manager) SetActive(pid, sid string) error`
  - `func (s *Session) ID() string`, `func (s *Session) Execute(cmds ...domain.Command) (domain.Result, error)` (atomic batch; returns the last command's result)
  - `func (s *Session) Read(fn func(st *domain.State, events []domain.Event))`
  - `func (s *Session) Changed() <-chan struct{}` (closed on every change)
  - `func (s *Session) MarkDelivered(upTo int64) error`
  - `func (s *Session) Snapshot() ([]byte, error)` (JSON `{"state":…,"waiting":bool}`)
  - `func (s *Session) PutBlob(content []byte) (string, error)`, `func (s *Session) Blob(sha string) ([]byte, error)`
  - `func (s *Session) StoreContent(cmd domain.Command) error`
  - fields used by Task 10: `s.waiting bool`, `s.waitSeq int`, `s.waitCancel context.CancelCauseFunc`, `s.notifyLocked()`

- [ ] **Step 1: Write the failing tests**

`internal/daemon/manager_test.go`:

```go
package daemon

import (
	"errors"
	"sync"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/store"
)

var testProject = store.Project{ID: "p1", RootPath: "/tmp/p1", Name: "p1"}

func newManager(t *testing.T, home string) *Manager {
	t.Helper()
	m, err := NewManager(home)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	return m
}

func TestCreateExecuteReload(t *testing.T) {
	home := t.TempDir()
	m := newManager(t, home)
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.Execute(&domain.AddStage{Title: "A"})
	if err != nil || res.ID != "st_1" {
		t.Fatalf("Execute = %+v, %v", res, err)
	}
	m.Close()

	m2 := newManager(t, home)
	s2, err := m2.Get(s.ID())
	if err != nil {
		t.Fatal(err)
	}
	s2.Read(func(st *domain.State, evs []domain.Event) {
		if st.Session.Title != "Idea" || st.Stage("st_1") == nil || len(evs) != 2 {
			t.Fatalf("reloaded state: %+v, %d events", st, len(evs))
		}
	})
	p, _ := store.LoadProject(home, "p1")
	if p == nil || p.ActiveSessionID != s.ID() {
		t.Fatalf("project = %+v", p)
	}
	infos, _ := m2.Sessions("p1")
	if len(infos) != 1 || !infos[0].Active || infos[0].Title != "Idea" {
		t.Fatalf("infos = %+v", infos)
	}
}

func TestExecuteBatchIsAtomic(t *testing.T) {
	home := t.TempDir()
	m := newManager(t, home)
	s, _ := m.Create(testProject, "Idea")
	_, err := s.Execute(&domain.AddStage{Title: "A"}, &domain.AddThread{StageID: "st_9", Title: "x"})
	var de *domain.Error
	if !errors.As(err, &de) || de.Code != domain.CodeStageNotFound {
		t.Fatalf("err = %v", err)
	}
	s.Read(func(st *domain.State, evs []domain.Event) {
		if len(st.Stages) != 0 || len(evs) != 1 {
			t.Fatalf("partial batch leaked: %d stages, %d events", len(st.Stages), len(evs))
		}
	})
	m.Close()
	s2, _ := newManager(t, home).Get(s.ID())
	s2.Read(func(st *domain.State, evs []domain.Event) {
		if len(evs) != 1 {
			t.Fatalf("partial batch persisted: %d events", len(evs))
		}
	})
}

// Review Focus 4: concurrent writers get strictly increasing seqs and a reloadable log.
func TestConcurrentExecute(t *testing.T) {
	home := t.TempDir()
	m := newManager(t, home)
	s, _ := m.Create(testProject, "Idea")
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Execute(&domain.AddStage{Title: "A"}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	s.Read(func(st *domain.State, evs []domain.Event) {
		for i, e := range evs {
			if e.Seq != int64(i+1) {
				t.Fatalf("event %d has seq %d", i, e.Seq)
			}
		}
		if len(st.Stages) != 20 {
			t.Fatalf("stages = %d", len(st.Stages))
		}
	})
	m.Close()
	s2, err := newManager(t, home).Get(s.ID())
	if err != nil {
		t.Fatal(err)
	}
	s2.Read(func(_ *domain.State, evs []domain.Event) {
		if len(evs) != 21 {
			t.Fatalf("reloaded %d events", len(evs))
		}
	})
}

func TestChangedClosesOnExecute(t *testing.T) {
	s, _ := newManager(t, t.TempDir()).Create(testProject, "Idea")
	ch := s.Changed()
	s.Execute(&domain.AddStage{Title: "A"})
	select {
	case <-ch:
	default:
		t.Fatal("Changed channel not closed")
	}
}

func TestGetUnknownSession(t *testing.T) {
	_, err := newManager(t, t.TempDir()).Get("s_nope00")
	var de *domain.Error
	if !errors.As(err, &de) || de.Code != domain.CodeSessionNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestStoreContentMovesToBlob(t *testing.T) {
	s, _ := newManager(t, t.TempDir()).Create(testProject, "Idea")
	cmd := &domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "a.kt", Content: "a\nb\n", FirstLine: 5},
		Variants: &domain.Variants{Options: []domain.VariantOption{{Title: "x", Blocks: []domain.BlockContent{{Kind: domain.KindMarkdown, Path: "d.md", Content: "# h\n"}}}}}}
	if err := s.StoreContent(cmd); err != nil {
		t.Fatal(err)
	}
	if cmd.Content != "" || cmd.LineCount != 2 || cmd.FirstLine != 5 || cmd.BlobSHA == "" {
		t.Fatalf("top block = %+v", cmd.BlockContent)
	}
	nested := cmd.Variants.Options[0].Blocks[0]
	if nested.Content != "" || nested.LineCount != 1 || nested.FirstLine != 1 {
		t.Fatalf("nested block = %+v", nested)
	}
	if got, _ := s.Blob(cmd.BlobSHA); string(got) != "a\nb\n" {
		t.Fatalf("blob = %q", got)
	}
}

func TestMarkDelivered(t *testing.T) {
	s, _ := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err := s.MarkDelivered(1); err != nil {
		t.Fatal(err)
	}
	s.MarkDelivered(1) // no-op: not beyond the cursor
	s.Read(func(st *domain.State, evs []domain.Event) {
		if st.Delivered != 1 || len(evs) != 2 || evs[1].Actor != domain.ActorSystem {
			t.Fatalf("delivered=%d events=%d", st.Delivered, len(evs))
		}
	})
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/daemon/`
Expected: FAIL (`undefined: NewManager`)

- [ ] **Step 3: Implement the manager**

`internal/daemon/manager.go`:

```go
// Package daemon is the single process that owns all Tandem state and serves the HTTP API.
package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/store"
)

type Manager struct {
	home     string
	mu       sync.Mutex
	sessions map[string]*Session // loaded sessions
	index    map[string]string   // session id → project id, for everything on disk
}

type SessionInfo struct {
	ID     string               `json:"id"`
	Title  string               `json:"title"`
	Status domain.SessionStatus `json:"status"`
	Active bool                 `json:"active"`
}

func NewManager(home string) (*Manager, error) {
	idx, err := store.SessionIndex(home)
	if err != nil {
		return nil, err
	}
	return &Manager{home: home, sessions: map[string]*Session{}, index: idx}, nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.sessions {
		s.log.Close()
		delete(m.sessions, id)
	}
	return nil
}

func (m *Manager) Create(p store.Project, title string) (*Session, error) {
	if strings.TrimSpace(title) == "" {
		return nil, &domain.Error{Code: domain.CodeInvalidInput, Message: "session title is required"}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	sid := domain.NewSessionID()
	for m.index[sid] != "" {
		sid = domain.NewSessionID()
	}
	s, err := m.load(p.ID, sid)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	err = s.appendLocked(domain.NewEvent(domain.ActorAI, domain.EvSessionCreated,
		domain.SessionCreated{ID: sid, Title: title, ProjectID: p.ID}))
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	m.index[sid] = p.ID
	m.sessions[sid] = s
	if existing, err := store.LoadProject(m.home, p.ID); err == nil && existing != nil {
		p = *existing
	}
	p.ActiveSessionID = sid
	return s, store.SaveProject(m.home, p)
}

func (m *Manager) Get(sid string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.getLocked(sid)
}

func (m *Manager) getLocked(sid string) (*Session, error) {
	if s := m.sessions[sid]; s != nil {
		return s, nil
	}
	pid := m.index[sid]
	if pid == "" {
		return nil, &domain.Error{Code: domain.CodeSessionNotFound, Message: fmt.Sprintf("no session %s", sid),
			Hint: "run `tdm session list` to see this project's sessions"}
	}
	s, err := m.load(pid, sid)
	if err != nil {
		return nil, err
	}
	m.sessions[sid] = s
	return s, nil
}

func (m *Manager) load(pid, sid string) (*Session, error) {
	dir := store.SessionDir(m.home, pid, sid)
	l, events, warning, err := store.OpenLog(filepath.Join(dir, "events.jsonl"))
	if err != nil {
		return nil, err
	}
	if warning != "" {
		log.Printf("session %s: %s", sid, warning)
	}
	st, err := domain.Replay(events)
	if err != nil {
		l.Close()
		return nil, fmt.Errorf("session %s: %w", sid, err)
	}
	return &Session{id: sid, pid: pid, dir: dir, log: l, events: events, state: st,
		changed: make(chan struct{}), now: time.Now}, nil
}

func (m *Manager) Sessions(pid string) ([]SessionInfo, error) {
	p, err := store.LoadProject(m.home, pid)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []SessionInfo
	for sid, owner := range m.index {
		if owner != pid {
			continue
		}
		s, err := m.getLocked(sid)
		if err != nil {
			return nil, err
		}
		s.Read(func(st *domain.State, _ []domain.Event) {
			out = append(out, SessionInfo{ID: sid, Title: st.Session.Title, Status: st.Session.Status,
				Active: p != nil && p.ActiveSessionID == sid})
		})
	}
	return out, nil
}

func (m *Manager) SetActive(pid, sid string) error {
	m.mu.Lock()
	owner := m.index[sid]
	m.mu.Unlock()
	if owner != pid {
		return &domain.Error{Code: domain.CodeSessionNotFound, Message: fmt.Sprintf("no session %s in this project", sid),
			Hint: "run `tdm session list` to see this project's sessions"}
	}
	p, err := store.LoadProject(m.home, pid)
	if err != nil || p == nil {
		return &domain.Error{Code: domain.CodeProjectNotFound, Message: "unknown project " + pid}
	}
	p.ActiveSessionID = sid
	return store.SaveProject(m.home, *p)
}

// Session is one loaded session. All mutation goes through its mutex: one writer, one order.
type Session struct {
	mu      sync.Mutex
	id, pid string
	dir     string
	log     *store.Log
	events  []domain.Event
	state   *domain.State
	changed chan struct{}
	now     func() time.Time

	waiting    bool
	waitSeq    int
	waitCancel context.CancelCauseFunc
}

func (s *Session) ID() string { return s.id }

// Execute decides and applies the commands as one atomic batch.
func (s *Session) Execute(cmds ...domain.Command) (domain.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var batch []domain.Event
	var res domain.Result
	for _, c := range cmds {
		evs, r, err := domain.Decide(s.state, c)
		if err != nil {
			s.rebuild()
			return domain.Result{}, err
		}
		for _, e := range evs {
			e = s.stamp(e)
			if err := s.state.Apply(e); err != nil {
				s.rebuild()
				return domain.Result{}, err
			}
			batch = append(batch, e)
		}
		res = r
	}
	return res, s.persist(batch)
}

func (s *Session) stamp(e domain.Event) domain.Event {
	e.Seq = s.state.LastSeq + 1
	e.TS = s.now().UTC()
	return e
}

// appendLocked stamps, applies and persists one event (session.created, agent.delivered).
func (s *Session) appendLocked(e domain.Event) error {
	e = s.stamp(e)
	if err := s.state.Apply(e); err != nil {
		s.rebuild()
		return err
	}
	return s.persist([]domain.Event{e})
}

func (s *Session) persist(batch []domain.Event) error {
	if len(batch) == 0 {
		return nil
	}
	if err := s.log.Append(batch); err != nil {
		s.rebuild()
		return err
	}
	s.events = append(s.events, batch...)
	s.notifyLocked()
	return nil
}

// rebuild restores the state from persisted events after a failed batch.
func (s *Session) rebuild() {
	st, err := domain.Replay(s.events)
	if err != nil {
		panic(fmt.Sprintf("session %s: persisted events no longer replay: %v", s.id, err))
	}
	s.state = st
}

func (s *Session) notifyLocked() {
	close(s.changed)
	s.changed = make(chan struct{})
}

func (s *Session) Read(fn func(st *domain.State, events []domain.Event)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s.state, s.events)
}

func (s *Session) Changed() <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.changed
}

// MarkDelivered records that user events up to upTo reached the agent.
func (s *Session) MarkDelivered(upTo int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if upTo <= s.state.Delivered {
		return nil
	}
	return s.appendLocked(domain.NewEvent(domain.ActorSystem, domain.EvAgentDelivered, domain.AgentDelivered{UpTo: upTo}))
}

func (s *Session) Snapshot() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return json.Marshal(struct {
		State   *domain.State `json:"state"`
		Waiting bool          `json:"waiting"`
	}{s.state, s.waiting})
}

func (s *Session) PutBlob(content []byte) (string, error) {
	return store.PutBlob(filepath.Join(s.dir, "blobs"), content)
}

func (s *Session) Blob(sha string) ([]byte, error) {
	return store.GetBlob(filepath.Join(s.dir, "blobs"), sha)
}
```

`internal/daemon/content.go`:

```go
package daemon

import "github.com/lukaszfiszer/tandem/internal/domain"

// StoreContent moves the transport-only Content of an AddBlock (and its variant blocks) into blobs.
func (s *Session) StoreContent(cmd domain.Command) error {
	ab, ok := cmd.(*domain.AddBlock)
	if !ok {
		return nil
	}
	if err := s.storeOne(&ab.BlockContent); err != nil {
		return err
	}
	if ab.Variants == nil {
		return nil
	}
	for i := range ab.Variants.Options {
		for j := range ab.Variants.Options[i].Blocks {
			if err := s.storeOne(&ab.Variants.Options[i].Blocks[j]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Session) storeOne(c *domain.BlockContent) error {
	if c.Content == "" {
		return nil
	}
	sha, err := s.PutBlob([]byte(c.Content))
	if err != nil {
		return err
	}
	c.BlobSHA, c.LineCount, c.FirstLine, c.Content = sha, domain.CountLines(c.Content), max(c.FirstLine, 1), ""
	return nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test -race ./internal/daemon/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/daemon
git commit -m "feat(daemon): session manager with single writer and notifications"
```

---

### Task 7: Markdown rendering of user events for `tdm wait`

**Files:**
- Create: `internal/render/md.go`, `internal/render/wait.go`
- Test: `internal/render/wait_test.go`

**Interfaces:**
- Consumes: `domain.State`, event payloads, `domaintest.Build`
- Produces:
  - `type BlobReader func(sha string) ([]byte, error)`
  - `func Fence(lang, content string) string`
  - `func Quote(text string) string`
  - `func Wait(s *domain.State, events []domain.Event, blobs BlobReader) (string, error)`: renders user events and skips any others

- [ ] **Step 1: Write the failing tests**

`internal/render/wait_test.go`:

```go
package render

import (
	"strings"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

const repoKt = "class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n"

func blobs(sha string) ([]byte, error) { return []byte(repoKt), nil }

// ''' stands for ``` in expectations (raw strings cannot hold backticks).
func ticks(s string) string { return strings.ReplaceAll(s, "'''", "```") }

func waitScenario(t *testing.T) (*domain.State, []domain.Event) {
	return domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repository layer"},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "src/Repo.kt", Lang: "kotlin",
			BlobSHA: "sha1", FirstLine: 12, LineCount: 4}},
		&domain.AddThread{Title: "Cache strategy"},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindVariants},
			Variants: &domain.Variants{Options: []domain.VariantOption{{Title: "Empty map"}, {Title: "Lazy delegate"}}}},
		&domain.SubmitReview{Threads: []domain.ReviewThread{{ThreadID: "t_1",
			Comments: []domain.LineComment{{BlockID: "b_1", Lines: domain.LineRange{Start: 14, End: 14},
				Text: "Why nullable?\n# not a heading"}},
			Message: "Overall fine."}}},
		&domain.ChooseVariant{BlockID: "b_2", OptionID: "o_2"},
	)
}

func TestWait(t *testing.T) {
	st, events := waitScenario(t)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	want := ticks(`# Stage st_1 "Data model" — 0/2 threads resolved

## t_1 "Repository layer" — review submitted

Comment on b_1, ` + "`src/Repo.kt:14`" + `:
'''kotlin
    val cache: Map<String, User>? = null
'''
> Why nullable?
> # not a heading

Message:
> Overall fine.

## t_2 "Cache strategy" — variant chosen

Chose o_2 "Lazy delegate" (block b_2).
`)
	if got != want {
		t.Fatalf("Wait mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}

func TestWaitLifecycleAndSessionEvents(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.Conclude{Text: "REST"},
		&domain.EditConclusion{ThreadID: "t_1", Text: "REST, versioned"},
		&domain.ProposeStageSummary{Text: "sum"},
		&domain.RequestStageChanges{StageID: "st_1", Comment: "mention auth"},
		&domain.EndSession{Comment: "enough for today"},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{
		"# Stage st_1 \"API\" — 1/1 threads resolved\n",
		"## t_1 \"Endpoints\" — conclusion edited and accepted\n\nFinal conclusion:\n> REST, versioned\n",
		"## Stage summary — changes requested\n\n> mention auth\n",
		"# Session — end requested\n\n> enough for today\n",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in:\n%s", part, got)
		}
	}
}

// Review Focus 1: user markdown and backticks must not break the structure.
func TestFenceAndQuote(t *testing.T) {
	if got := Fence("go", "a := \"```\"\n"); got != "````go\na := \"```\"\n````\n" {
		t.Fatalf("Fence = %q", got)
	}
	if got := Quote("line 1\n\n## heading\n"); got != "> line 1\n>\n> ## heading\n" {
		t.Fatalf("Quote = %q", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/render/`
Expected: FAIL (`undefined: Wait`)

- [ ] **Step 3: Implement md helpers and Wait**

`internal/render/md.go`:

```go
// Package render produces the compact markdown the agent reads.
package render

import "strings"

type BlobReader func(sha string) ([]byte, error)

// Fence wraps content in a code fence longer than any backtick run inside it.
func Fence(lang, content string) string {
	longest, run := 0, 0
	for _, r := range content {
		if r == '`' {
			run++
			longest = max(longest, run)
		} else {
			run = 0
		}
	}
	fence := strings.Repeat("`", max(3, longest+1))
	return fence + lang + "\n" + strings.TrimSuffix(content, "\n") + "\n" + fence + "\n"
}

// Quote prefixes every line with "> " so user text can never become output structure.
func Quote(text string) string {
	var b strings.Builder
	for _, line := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		if line == "" {
			b.WriteString(">\n")
		} else {
			b.WriteString("> " + line + "\n")
		}
	}
	return b.String()
}

// human turns "conclusion_proposed" into "conclusion proposed".
func human[T ~string](v T) string { return strings.ReplaceAll(string(v), "_", " ") }
```

`internal/render/wait.go`:

```go
package render

import (
	"fmt"
	"strings"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

type section struct{ stageID, text string }

// Wait renders user events grouped by stage (in first-appearance order), then session-level events.
func Wait(s *domain.State, events []domain.Event, blobs BlobReader) (string, error) {
	var order []string
	byStage := map[string][]string{}
	var sessionLevel []string
	for _, e := range events {
		secs, err := eventSections(s, e, blobs)
		if err != nil {
			return "", err
		}
		for _, sec := range secs {
			if sec.stageID == "" {
				sessionLevel = append(sessionLevel, sec.text)
				continue
			}
			if _, seen := byStage[sec.stageID]; !seen {
				order = append(order, sec.stageID)
			}
			byStage[sec.stageID] = append(byStage[sec.stageID], sec.text)
		}
	}
	var parts []string
	for _, id := range order {
		parts = append(parts, stageHeader(s, s.Stage(id)))
		parts = append(parts, byStage[id]...)
	}
	parts = append(parts, sessionLevel...)
	return strings.Join(parts, "\n"), nil
}

func stageHeader(s *domain.State, st *domain.Stage) string {
	resolved := 0
	for _, id := range st.ThreadIDs {
		if s.Threads[id].Status == domain.ThreadResolved {
			resolved++
		}
	}
	return fmt.Sprintf("# Stage %s %q — %d/%d threads resolved\n", st.ID, st.Title, resolved, len(st.ThreadIDs))
}

func threadSection(s *domain.State, threadID, what string, items ...string) section {
	t := s.Threads[threadID]
	return section{stageID: t.StageID, text: fmt.Sprintf("## %s %q — %s\n\n", t.ID, t.Title, what) + strings.Join(items, "\n")}
}

func eventSections(s *domain.State, e domain.Event, blobs BlobReader) ([]section, error) {
	switch e.Type {
	case domain.EvReviewSubmitted:
		var p domain.ReviewSubmitted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		var out []section
		for _, rt := range p.Threads {
			var items []string
			for _, c := range rt.Comments {
				item, err := commentItem(s, c, blobs)
				if err != nil {
					return nil, err
				}
				items = append(items, item)
			}
			if rt.Message != "" {
				items = append(items, "Message:\n"+Quote(rt.Message))
			}
			what := "review submitted"
			if len(rt.Comments) == 0 {
				what = "message"
			}
			out = append(out, threadSection(s, rt.ThreadID, what, items...))
		}
		return out, nil
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
		return []section{threadSection(s, p.ThreadID, "variant chosen", item)}, nil
	case domain.EvVariantsRejected:
		var p domain.VariantsRejected
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "all variants rejected",
			fmt.Sprintf("Rejected all options in block %s:\n", p.BlockID)+Quote(p.Comment))}, nil
	case domain.EvConclusionAccepted:
		var p domain.ConclusionAccepted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "conclusion accepted", "Accepted as proposed.\n")}, nil
	case domain.EvConclusionEdited:
		var p domain.ConclusionEdited
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "conclusion edited and accepted", "Final conclusion:\n"+Quote(p.Text))}, nil
	case domain.EvConclusionDiscussionRequested:
		var p domain.ConclusionDiscussionRequested
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "discussion requested", Quote(p.Comment))}, nil
	case domain.EvStageSummaryAccepted:
		var p domain.StageSummaryAccepted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{{p.StageID, "## Stage summary — accepted\n\nAccepted as proposed.\n"}}, nil
	case domain.EvStageSummaryChangesRequested:
		var p domain.StageSummaryChangesRequested
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{{p.StageID, "## Stage summary — changes requested\n\n" + Quote(p.Comment)}}, nil
	case domain.EvSessionEndRequested:
		var p domain.SessionEndRequested
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		text := "# Session — end requested\n"
		if p.Comment != "" {
			text += "\n" + Quote(p.Comment)
		}
		return []section{{"", text}}, nil
	}
	return nil, nil
}

// commentItem quotes the commented lines from the block snapshot, then the user's comment.
func commentItem(s *domain.State, c domain.LineComment, blobs BlobReader) (string, error) {
	b := s.Blocks[c.BlockID]
	if b == nil {
		return "", fmt.Errorf("comment on unknown block %s", c.BlockID)
	}
	text := b.Text
	if b.BlobSHA != "" {
		data, err := blobs(b.BlobSHA)
		if err != nil {
			return "", fmt.Errorf("block %s: %w", b.ID, err)
		}
		text = string(data)
	}
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	from, to := c.Lines.Start-b.FirstLine, c.Lines.End-b.FirstLine+1
	if from < 0 || to > len(lines) {
		return "", fmt.Errorf("comment lines %s outside block %s", c.Lines, b.ID)
	}
	where := "lines " + c.Lines.String()
	if b.Path != "" {
		where = fmt.Sprintf("`%s:%s`", b.Path, c.Lines)
	}
	return fmt.Sprintf("Comment on %s, %s:\n", b.ID, where) + Fence(b.Lang, strings.Join(lines[from:to], "\n")) + Quote(c.Text), nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/render/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/render
git commit -m "feat(render): markdown for tdm wait"
```

---

### Task 8: Show, Summarize and Export views

**Files:**
- Create: `internal/render/views.go`
- Test: `internal/render/views_test.go`

**Interfaces:**
- Consumes: Task 7 (`Wait`, `Quote`, `human`, `waitScenario`, `blobs` test helpers)
- Produces:
  - `func Show(s *domain.State, events []domain.Event, blobs BlobReader) (string, error)`
  - `func Summarize(s *domain.State, stageID string) (string, error)`: an empty `stageID` means the latest stage that is not accepted, falling back to the last stage
  - `func Export(s *domain.State, stageID string) (string, error)`
  - Errors are `*domain.Error` (`stage_not_found`, `no_open_stage`).

- [ ] **Step 1: Write the failing tests**

`internal/render/views_test.go`:

```go
package render

import (
	"errors"
	"strings"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

func TestShow(t *testing.T) {
	st, events := waitScenario(t)
	got, err := Show(st, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{
		"# Session s_test \"Test session\" — active\n",
		"\n## Stage st_1 \"Data model\" — open\n",
		"- t_1 \"Repository layer\" — open, awaiting AI\n",
		"- t_2 \"Cache strategy\" — open, awaiting AI\n",
		"\n# Awaiting AI\n\n# Stage st_1",
		"Comment on b_1",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in:\n%s", part, got)
		}
	}
}

func TestShowNothingAwaiting(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API", Goal: "Pick style"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.Conclude{Text: "REST"},
		&domain.AcceptConclusion{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "We use REST."},
	)
	got, _ := Show(st, events, blobs)
	for _, part := range []string{
		"Goal: Pick style\n",
		"- t_1 \"Endpoints\" — resolved\n  Conclusion: REST\n",
		"Proposed summary:\n> We use REST.\n",
		"# Awaiting AI\n\nNothing. Run `tdm wait` for new user events.\n",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in:\n%s", part, got)
		}
	}
}

func TestSummarize(t *testing.T) {
	st, _ := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.Conclude{ThreadID: "t_1", Text: "Keep it."},
		&domain.AcceptConclusion{ThreadID: "t_1"},
		&domain.AddThread{Title: "Cache"},
	)
	got, err := Summarize(st, "")
	want := "# Stage st_1 \"Data model\" — thread conclusions\n\n## t_1 \"Repo\"\nKeep it.\n\n## t_2 \"Cache\" — not resolved (open)\n"
	if err != nil || got != want {
		t.Fatalf("got %q, %v", got, err)
	}
	_, err = Summarize(st, "st_9")
	var de *domain.Error
	if !errors.As(err, &de) || de.Code != domain.CodeStageNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestExport(t *testing.T) {
	st, _ := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.Conclude{Text: "x"},
		&domain.AcceptConclusion{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "Keep the repository; lazy cache."},
		&domain.AcceptStageSummary{StageID: "st_1"},
		&domain.AddStage{Title: "API"},
	)
	got, err := Export(st, "")
	want := "# Test session\n\n## 1. Data model\nKeep the repository; lazy cache.\n\n_Stage 2 \"API\" — not yet accepted._\n"
	if err != nil || got != want {
		t.Fatalf("got %q, %v", got, err)
	}
	got, _ = Export(st, "st_2")
	if got != "# Test session\n\n_Stage 2 \"API\" — not yet accepted._\n" {
		t.Fatalf("single stage export = %q", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/render/`
Expected: FAIL (`undefined: Show`)

- [ ] **Step 3: Implement the views**

`internal/render/views.go`:

```go
package render

import (
	"fmt"
	"strings"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

// Show renders the session overview plus the user input the AI has not acted on yet.
func Show(s *domain.State, events []domain.Event, blobs BlobReader) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "# Session %s %q — %s\n", s.Session.ID, s.Session.Title, s.Session.Status)
	if len(s.Stages) == 0 {
		b.WriteString("\nNo stages yet. Add one with `tdm stage add \"<title>\"`.\n")
	}
	for _, st := range s.Stages {
		fmt.Fprintf(&b, "\n## Stage %s %q — %s\n", st.ID, st.Title, human(st.Status))
		if st.Goal != "" {
			fmt.Fprintf(&b, "Goal: %s\n", st.Goal)
		}
		for _, id := range st.ThreadIDs {
			b.WriteString(threadLine(s.Threads[id]))
		}
		switch st.Status {
		case domain.StageSummaryProposed:
			b.WriteString("Proposed summary:\n" + Quote(st.ProposedSummary))
		case domain.StageAccepted:
			b.WriteString("Summary:\n" + Quote(st.Summary))
		}
	}
	if s.EndRequested {
		b.WriteString("\nThe user asked to end the session.\n")
	}
	b.WriteString("\n# Awaiting AI\n\n")
	pending := awaiting(s, events)
	if len(pending) == 0 {
		b.WriteString("Nothing. Run `tdm wait` for new user events.\n")
		return b.String(), nil
	}
	w, err := Wait(s, pending, blobs)
	if err != nil {
		return "", err
	}
	b.WriteString(w)
	return b.String(), nil
}

func threadLine(t *domain.Thread) string {
	line := fmt.Sprintf("- %s %q — %s", t.ID, t.Title, human(t.Status))
	if t.AwaitingAI() {
		line += ", awaiting AI"
	}
	switch t.Status {
	case domain.ThreadResolved:
		line += "\n  Conclusion: " + firstLine(t.Conclusion)
	case domain.ThreadConclusionProposed:
		line += "\n  Proposed: " + firstLine(t.ProposedConclusion)
	}
	return line + "\n"
}

func firstLine(s string) string {
	line, rest, _ := strings.Cut(strings.TrimSpace(s), "\n")
	if rest != "" {
		line += " …"
	}
	return line
}

// awaiting returns user events the AI has not acted on: thread events newer than the thread's
// last AI action, and session/stage events newer than the AI's last action anywhere.
func awaiting(s *domain.State, events []domain.Event) []domain.Event {
	var out []domain.Event
	for _, e := range events {
		if e.Actor != domain.ActorUser {
			continue
		}
		ids := domain.EventThreadIDs(s, e)
		if len(ids) == 0 {
			if e.Seq > s.LastAISeq {
				out = append(out, e)
			}
			continue
		}
		for _, id := range ids {
			if t := s.Threads[id]; t != nil && t.AwaitingAI() && e.Seq > t.LastAISeq {
				out = append(out, e)
				break
			}
		}
	}
	return out
}

// Summarize lists the thread conclusions of a stage: the input for the AI's stage summary.
func Summarize(s *domain.State, stageID string) (string, error) {
	st, err := pickStage(s, stageID)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# Stage %s %q — thread conclusions\n", st.ID, st.Title)
	for _, id := range st.ThreadIDs {
		t := s.Threads[id]
		if t.Status == domain.ThreadResolved {
			fmt.Fprintf(&b, "\n## %s %q\n%s\n", t.ID, t.Title, strings.TrimRight(t.Conclusion, "\n"))
		} else {
			fmt.Fprintf(&b, "\n## %s %q — not resolved (%s)\n", t.ID, t.Title, human(t.Status))
		}
	}
	return b.String(), nil
}

func pickStage(s *domain.State, id string) (*domain.Stage, error) {
	if id != "" {
		if st := s.Stage(id); st != nil {
			return st, nil
		}
		return nil, &domain.Error{Code: domain.CodeStageNotFound, Message: "no stage " + id,
			Hint: "run `tdm session show` to list stages"}
	}
	for i := len(s.Stages) - 1; i >= 0; i-- {
		if s.Stages[i].Status != domain.StageAccepted {
			return s.Stages[i], nil
		}
	}
	if len(s.Stages) > 0 {
		return s.Stages[len(s.Stages)-1], nil
	}
	return nil, &domain.Error{Code: domain.CodeNoOpenStage, Message: "session has no stages",
		Hint: "add one with `tdm stage add \"<title>\"`"}
}

// Export is the decision document: the session title and every accepted stage summary.
func Export(s *domain.State, stageID string) (string, error) {
	if stageID != "" && s.Stage(stageID) == nil {
		return "", &domain.Error{Code: domain.CodeStageNotFound, Message: "no stage " + stageID,
			Hint: "run `tdm session show` to list stages"}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n", s.Session.Title)
	for i, st := range s.Stages {
		if stageID != "" && st.ID != stageID {
			continue
		}
		if st.Status == domain.StageAccepted {
			fmt.Fprintf(&b, "\n## %d. %s\n%s\n", i+1, st.Title, strings.TrimRight(st.Summary, "\n"))
		} else {
			fmt.Fprintf(&b, "\n_Stage %d %q — not yet accepted._\n", i+1, st.Title)
		}
	}
	return b.String(), nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/render/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/render
git commit -m "feat(render): show, summarize and export views"
```

---

### Task 9: Daemon HTTP server: auth guard and REST API

**Files:**
- Create: `internal/daemon/server.go`, `internal/daemon/api.go`, `internal/daemon/activity.go`, `internal/daemon/webdist/index.html`
- Test: `internal/daemon/server_test.go`

**Interfaces:**
- Consumes: Task 6 (`Manager`, `Session`), Task 8 (`render.Show/Summarize/Export`), `domain.DecodeCommand`
- Produces:
  - `type Config struct{Home, Version, Token string; Port int; IdleTimeout time.Duration}`
  - `func NewServer(cfg Config, mgr *Manager, stop func()) *Server`, `func (s *Server) Handler() http.Handler`
  - HTTP API:
    - `GET /health` → `{"version"}`
    - `POST /api/sessions` `{"project":store.Project,"title"}` → `{"id","url"}`
    - `GET /api/projects/{pid}` → `store.Project` (404 `project_not_found`)
    - `GET /api/projects/{pid}/sessions` → `[]SessionInfo`
    - `POST /api/projects/{pid}/active` `{"sessionId"}`
    - `GET /api/sessions/{sid}/state`
    - `POST /api/sessions/{sid}/commands` `{"type","data"}` → `domain.Result`
    - `POST /api/sessions/{sid}/actions` `{"type","data","draft"?}` → `domain.Result`
    - `GET /api/sessions/{sid}/render/{show|summarize|export}?stage=` → `text/markdown`
    - `GET /api/sessions/{sid}/events?since=&stage=` → JSONL
    - `GET /api/sessions/{sid}/blobs/{sha}`
    - `POST /api/shutdown`
    - `GET /` and `GET /s/{sid}` → the embedded page
  - `func (s *Server) sessionURL(sid string) string` = `http://127.0.0.1:<port>/s/<sid>?token=<token>`
  - `type activity`, with `Touch()`, `Begin()`, `End()` and `Idle(timeout time.Duration) bool`
  - Error body: `{"error":{"code","message","hint"}}`. `*domain.Error` maps to 400, or 404 for `*_not_found` codes; anything else is a 500 with code `internal`.

- [ ] **Step 1: Write the failing tests**

`internal/daemon/server_test.go`:

```go
package daemon

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

type testEnv struct {
	t     *testing.T
	srv   *Server
	hs    *httptest.Server
	token string
	home  string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	home := t.TempDir()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	mgr := newManager(t, home)
	cfg := Config{Home: home, Version: "test", Token: "secret", Port: ln.Addr().(*net.TCPAddr).Port, IdleTimeout: time.Hour}
	srv := NewServer(cfg, mgr, func() {})
	hs := &httptest.Server{Listener: ln, Config: &http.Server{Handler: srv.Handler()}}
	hs.Start()
	t.Cleanup(hs.Close)
	return &testEnv{t: t, srv: srv, hs: hs, token: "secret", home: home}
}

// do sends a request with the bearer token; extra headers are given as key, value pairs.
func (e *testEnv) do(method, path, body string, hdr ...string) (int, string) {
	e.t.Helper()
	req, _ := http.NewRequest(method, e.hs.URL+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+e.token)
	for i := 0; i+1 < len(hdr); i += 2 {
		if hdr[i] == "Host" {
			req.Host = hdr[i+1]
		} else {
			req.Header.Set(hdr[i], hdr[i+1])
		}
	}
	resp, err := e.hs.Client().Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func (e *testEnv) session() string {
	e.t.Helper()
	body, _ := json.Marshal(map[string]any{"project": store.Project{ID: "p1", RootPath: "/r", Name: "r"}, "title": "Idea"})
	code, out := e.do("POST", "/api/sessions", string(body))
	var res struct{ ID, URL string }
	json.Unmarshal([]byte(out), &res)
	if code != 200 || !strings.HasPrefix(res.ID, "s_") || !strings.Contains(res.URL, "/s/"+res.ID+"?token=secret") {
		e.t.Fatalf("create session: %d %s", code, out)
	}
	return res.ID
}

func (e *testEnv) command(sid, typ, data string) (int, string) {
	return e.do("POST", "/api/sessions/"+sid+"/commands", `{"type":"`+typ+`","data":`+data+`}`)
}

func TestHealthNeedsNoToken(t *testing.T) {
	e := newTestEnv(t)
	resp, err := http.Get(e.hs.URL + "/health")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("health: %v %v", resp, err)
	}
}

func TestGuard(t *testing.T) {
	e := newTestEnv(t)
	e.token = ""
	if code, _ := e.do("GET", "/api/projects/p1", ""); code != 401 {
		t.Fatalf("missing token: %d", code)
	}
	e.token = "secret"
	if code, out := e.do("GET", "/api/projects/p1", "", "Host", "evil.example:80"); code != 403 || !strings.Contains(out, "bad_host") {
		t.Fatalf("bad host: %d %s", code, out)
	}
	if code, out := e.do("POST", "/api/shutdown", "", "Origin", "http://evil.example"); code != 403 || !strings.Contains(out, "bad_origin") {
		t.Fatalf("bad origin: %d %s", code, out)
	}
}

func TestTokenQuerySetsCookie(t *testing.T) {
	e := newTestEnv(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(e.hs.URL + "/s/s_abc123?token=secret")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != "/s/s_abc123" {
		t.Fatalf("redirect: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	c := resp.Cookies()
	if len(c) != 1 || c[0].Name != "tandem_token" || !c[0].HttpOnly || c[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie = %+v", c)
	}
	req, _ := http.NewRequest("GET", e.hs.URL+"/s/s_abc123", nil)
	req.AddCookie(c[0])
	resp, _ = client.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("page with cookie: %d", resp.StatusCode)
	}
}

func TestCommandsStateAndErrors(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	if code, out := e.command(sid, "stage.add", `{"title":"Data model"}`); code != 200 || out != "{\"id\":\"st_1\"}\n" {
		t.Fatalf("stage.add: %d %q", code, out)
	}
	code, out := e.do("GET", "/api/sessions/"+sid+"/state", "")
	if code != 200 || !strings.Contains(out, `"title":"Data model"`) {
		t.Fatalf("state: %d %s", code, out)
	}
	code, out = e.command(sid, "thread.add", `{"title":"x","stageId":"st_9"}`)
	if code != 404 || !strings.Contains(out, `"code":"stage_not_found"`) || !strings.Contains(out, `"hint"`) {
		t.Fatalf("error: %d %s", code, out)
	}
	if code, _ := e.command(sid, "variant.choose", `{}`); code != 400 {
		t.Fatalf("agent sending user command: %d", code)
	}
	if code, _ := e.do("GET", "/api/sessions/s_nope00/state", ""); code != 404 {
		t.Fatalf("unknown session: %d", code)
	}
	code, out = e.do("GET", "/api/projects/p1", "")
	if code != 200 || !strings.Contains(out, `"activeSessionId":"`+sid+`"`) {
		t.Fatalf("project: %d %s", code, out)
	}
	if code, _ := e.do("GET", "/api/projects/nope", ""); code != 404 {
		t.Fatalf("unknown project: %d", code)
	}
}

func TestFileBlockContentBecomesBlob(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	code, out := e.command(sid, "block.add", `{"type":"file","path":"a.kt","lang":"kotlin","content":"x\ny\n","firstLine":3}`)
	if code != 200 {
		t.Fatalf("block.add: %d %s", code, out)
	}
	_, state := e.do("GET", "/api/sessions/"+sid+"/state", "")
	var snap struct {
		Blocks map[string]struct {
			BlobSHA   string `json:"blobSha"`
			FirstLine int    `json:"firstLine"`
			LineCount int    `json:"lineCount"`
		} `json:"blocks"`
	}
	json.Unmarshal([]byte(state), &snap)
	b := snap.Blocks["b_1"]
	if b.FirstLine != 3 || b.LineCount != 2 {
		t.Fatalf("block = %+v", b)
	}
	if code, blob := e.do("GET", "/api/sessions/"+sid+"/blobs/"+b.BlobSHA, ""); code != 200 || blob != "x\ny\n" {
		t.Fatalf("blob: %d %q", code, blob)
	}
}

func TestActionWithDraftAndEvents(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	e.command(sid, "block.add", `{"type":"code","lang":"go","text":"a\nb\n"}`)
	e.command(sid, "block.add", `{"type":"variants","variants":{"options":[{"title":"X"},{"title":"Y"}]}}`)
	code, out := e.do("POST", "/api/sessions/"+sid+"/actions",
		`{"type":"variant.choose","data":{"blockId":"b_2","optionId":"o_1"},
		  "draft":{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":2,"end":2},"text":"hm"}]}]}}`,
		"Origin", e.hs.URL)
	if code != 200 {
		t.Fatalf("action: %d %s", code, out)
	}
	_, events := e.do("GET", "/api/sessions/"+sid+"/events?since=5", "")
	lines := strings.Split(strings.TrimSpace(events), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"review.submitted"`) || !strings.Contains(lines[1], `"variant.chosen"`) {
		t.Fatalf("events after 5:\n%s", events)
	}
	_, all := e.do("GET", "/api/sessions/"+sid+"/events?stage=st_1", "")
	if n := len(strings.Split(strings.TrimSpace(all), "\n")); n != 6 {
		t.Fatalf("stage filter returned %d events", n)
	}
}

func TestRenderAndSessions(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	code, out := e.do("GET", "/api/sessions/"+sid+"/render/export", "")
	if code != 200 || out != "# Idea\n" {
		t.Fatalf("export: %d %q", code, out)
	}
	if code, _ := e.do("GET", "/api/sessions/"+sid+"/render/nope", ""); code != 400 {
		t.Fatalf("unknown view: %d", code)
	}
	sid2 := e.session()
	if code, _ := e.do("POST", "/api/projects/p1/active", `{"sessionId":"`+sid+`"}`); code != 200 {
		t.Fatal("set active")
	}
	_, list := e.do("GET", "/api/projects/p1/sessions", "")
	var infos []SessionInfo
	json.Unmarshal([]byte(list), &infos)
	active := map[string]bool{}
	for _, i := range infos {
		active[i.ID] = i.Active
	}
	if len(infos) != 2 || !active[sid] || active[sid2] {
		t.Fatalf("sessions = %+v", infos)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/daemon/`
Expected: FAIL (`undefined: NewServer`)

- [ ] **Step 3: Implement the server, guard, activity and API**

`internal/daemon/activity.go`:

```go
package daemon

import (
	"sync"
	"time"
)

// activity tracks when the daemon was last used and how many long-lived requests are open.
type activity struct {
	mu     sync.Mutex
	last   time.Time
	active int
}

func newActivity() *activity { return &activity{last: time.Now()} }

func (a *activity) Touch() {
	a.mu.Lock()
	a.last = time.Now()
	a.mu.Unlock()
}

func (a *activity) Begin() {
	a.mu.Lock()
	a.active++
	a.last = time.Now()
	a.mu.Unlock()
}

func (a *activity) End() {
	a.mu.Lock()
	a.active--
	a.last = time.Now()
	a.mu.Unlock()
}

// Idle reports whether nothing is open and nothing happened for longer than timeout.
func (a *activity) Idle(timeout time.Duration) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.active == 0 && time.Since(a.last) > timeout
}
```

`internal/daemon/server.go`:

```go
package daemon

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

//go:embed webdist
var webdist embed.FS

type Config struct {
	Home        string
	Version     string
	Token       string
	Port        int
	IdleTimeout time.Duration
}

type Server struct {
	cfg      Config
	mgr      *Manager
	stop     func()
	activity *activity
}

func NewServer(cfg Config, mgr *Manager, stop func()) *Server {
	return &Server{cfg: cfg, mgr: mgr, stop: stop, activity: newActivity()}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("POST /api/sessions", s.createSession)
	mux.HandleFunc("GET /api/projects/{pid}", s.getProject)
	mux.HandleFunc("GET /api/projects/{pid}/sessions", s.listSessions)
	mux.HandleFunc("POST /api/projects/{pid}/active", s.setActive)
	mux.HandleFunc("GET /api/sessions/{sid}/state", s.state)
	mux.HandleFunc("POST /api/sessions/{sid}/commands", s.command)
	mux.HandleFunc("POST /api/sessions/{sid}/actions", s.action)
	mux.HandleFunc("GET /api/sessions/{sid}/render/{what}", s.render)
	mux.HandleFunc("GET /api/sessions/{sid}/events", s.events)
	mux.HandleFunc("GET /api/sessions/{sid}/blobs/{sha}", s.blob)
	mux.HandleFunc("POST /api/shutdown", s.shutdown)
	mux.Handle("GET /", s.page())
	return s.guard(mux)
}

func (s *Server) sessionURL(sid string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/s/%s?token=%s", s.cfg.Port, sid, s.cfg.Token)
}

// guard enforces Host, Origin and token checks (spec §7 Security).
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.activity.Touch()
		if !s.allowedHost(r.Host) {
			writeErr(w, http.StatusForbidden, "bad_host", "unexpected Host header "+r.Host, "")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if o := r.Header.Get("Origin"); o != "" && !s.allowedHost(strings.TrimPrefix(o, "http://")) {
				writeErr(w, http.StatusForbidden, "bad_origin", "cross-origin request from "+o, "")
				return
			}
		}
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		if tok := r.URL.Query().Get("token"); tok != "" && r.Method == http.MethodGet && !strings.HasPrefix(r.URL.Path, "/api/") {
			if !s.validToken(tok) {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid token", "open the page with `tdm open`")
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "tandem_token", Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			u := *r.URL
			q := u.Query()
			q.Del("token")
			u.RawQuery = q.Encode()
			http.Redirect(w, r, u.RequestURI(), http.StatusSeeOther)
			return
		}
		cookie := ""
		if c, err := r.Cookie("tandem_token"); err == nil {
			cookie = c.Value
		}
		if !s.validToken(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) && !s.validToken(cookie) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "missing or invalid token", "open the page with `tdm open`")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) allowedHost(h string) bool {
	return h == fmt.Sprintf("127.0.0.1:%d", s.cfg.Port) || h == fmt.Sprintf("localhost:%d", s.cfg.Port)
}

func (s *Server) validToken(t string) bool {
	return t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(s.cfg.Token)) == 1
}

// page serves the embedded UI; any non-file path gets index.html (client-side routing).
func (s *Server) page() http.Handler {
	sub, _ := fs.Sub(webdist, "webdist")
	files := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(sub, strings.TrimPrefix(r.URL.Path, "/")); err != nil || r.URL.Path == "/" {
			http.ServeFileFS(w, r, sub, "index.html")
			return
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, message, hint string) {
	writeJSON(w, status, map[string]any{"error": domain.Error{Code: code, Message: message, Hint: hint}})
}

func writeError(w http.ResponseWriter, err error) {
	var de *domain.Error
	if errors.As(err, &de) {
		status := http.StatusBadRequest
		if de.NotFound() {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]any{"error": de})
		return
	}
	writeErr(w, http.StatusInternalServerError, "internal", err.Error(), "")
}
```

`internal/daemon/api.go`:

```go
package daemon

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/render"
	"github.com/lukaszfiszer/tandem/internal/store"
)

const maxBody = 8 << 20

func decodeBody(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(into); err != nil {
		writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "invalid JSON body: "+err.Error(), "")
		return false
	}
	return true
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) (*Session, bool) {
	sess, err := s.mgr.Get(r.PathValue("sid"))
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	return sess, true
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.cfg.Version})
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Project store.Project `json:"project"`
		Title   string        `json:"title"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Project.ID == "" {
		writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "project is required", "")
		return
	}
	sess, err := s.mgr.Create(req.Project, req.Title)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": sess.ID(), "url": s.sessionURL(sess.ID())})
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	p, err := store.LoadProject(s.cfg.Home, r.PathValue("pid"))
	if err != nil {
		writeError(w, err)
		return
	}
	if p == nil {
		writeError(w, &domain.Error{Code: domain.CodeProjectNotFound, Message: "no sessions in this project yet",
			Hint: "run `tdm session new \"<title>\"`"})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	infos, err := s.mgr.Sessions(r.PathValue("pid"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, infos)
}

func (s *Server) setActive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SessionID string `json:"sessionId"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if err := s.mgr.SetActive(r.PathValue("pid"), req.SessionID); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": req.SessionID})
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	var body []byte
	var err error
	sess.Read(func(st *domain.State, _ []domain.Event) { body, err = json.Marshal(st) })
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

type wireCommand struct {
	Type  string              `json:"type"`
	Data  json.RawMessage     `json:"data"`
	Draft *domain.SubmitReview `json:"draft,omitempty"`
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	s.execute(w, r, domain.ActorAI)
}

func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	s.execute(w, r, domain.ActorUser)
}

// execute runs one wire command. For user actions, a non-empty draft is submitted in the same batch first.
func (s *Server) execute(w http.ResponseWriter, r *http.Request, actor domain.Actor) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	var req wireCommand
	if !decodeBody(w, r, &req) {
		return
	}
	cmd, err := domain.DecodeCommand(actor, req.Type, req.Data)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := sess.StoreContent(cmd); err != nil {
		writeError(w, err)
		return
	}
	var cmds []domain.Command
	if actor == domain.ActorUser && req.Draft != nil && len(req.Draft.Threads) > 0 && req.Type != "review.submit" {
		cmds = append(cmds, req.Draft)
	}
	res, err := sess.Execute(append(cmds, cmd)...)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) render(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	stage := r.URL.Query().Get("stage")
	var out string
	var err error
	sess.Read(func(st *domain.State, evs []domain.Event) {
		switch r.PathValue("what") {
		case "show":
			out, err = render.Show(st, evs, sess.Blob)
		case "summarize":
			out, err = render.Summarize(st, stage)
		case "export":
			out, err = render.Export(st, stage)
		default:
			err = &domain.Error{Code: domain.CodeInvalidInput, Message: "unknown view " + r.PathValue("what")}
		}
	})
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Write([]byte(out))
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	stage := r.URL.Query().Get("stage")
	w.Header().Set("Content-Type", "application/x-ndjson")
	sess.Read(func(st *domain.State, evs []domain.Event) {
		enc := json.NewEncoder(w)
		for _, e := range evs {
			if e.Seq <= since || (stage != "" && domain.EventStageID(st, e) != stage) {
				continue
			}
			enc.Encode(e)
		}
	})
}

func (s *Server) blob(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	data, err := sess.Blob(r.PathValue("sha"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "blob_not_found", err.Error(), "")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

func (s *Server) shutdown(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	go s.stop()
}
```

`internal/daemon/webdist/index.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Tandem</title></head>
<body>
  <p>tdm daemon is running. The web UI arrives in plan 2.</p>
</body>
</html>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test -race ./internal/daemon/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/daemon
git commit -m "feat(daemon): http api with token, host and origin guard"
```

---

### Task 10: Long-poll `wait`, SSE stream, `Run` with idle shutdown

**Files:**
- Create: `internal/daemon/wait.go`, `internal/daemon/stream.go`, `internal/daemon/run.go`
- Modify: `internal/daemon/server.go` (register two routes in `Handler`)
- Test: `internal/daemon/wait_test.go`

**Interfaces:**
- Consumes: Tasks 6 and 9, `render.Wait`, `store.WriteDaemonInfo/RemoveDaemonInfo`
- Produces:
  - `GET /api/sessions/{sid}/wait?timeout=<go duration, default 9m, max 1h>&format=md|json`. Responses:
    - 200 with markdown, or `{"events":[…]}` for `format=json`;
    - 204 on timeout;
    - 409 `wait_superseded`;
    - 503 `daemon_stopping`.
  - `GET /api/sessions/{sid}/stream` streams SSE: `event: state` and `data: <Session.Snapshot()>`, sent on connect and after every change.
  - `var ErrWaitSuperseded = errors.New("wait superseded")`
  - `func (s *Session) BeginWait(parent context.Context) (context.Context, func())`
  - `func Run(ctx context.Context, cfg Config) error`: listens on `127.0.0.1:0`, writes `daemon.json`, and serves until ctx is done, `/api/shutdown` is called, or it has been idle for `cfg.IdleTimeout`. On exit it removes its own `daemon.json`. An empty `cfg.Token` gets a random value.

- [ ] **Step 1: Write the failing tests**

`internal/daemon/wait_test.go`:

```go
package daemon

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

func (e *testEnv) setupThread(sid string) {
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
}

func (e *testEnv) userMessage(sid, text string) {
	e.t.Helper()
	code, out := e.do("POST", "/api/sessions/"+sid+"/actions",
		`{"type":"review.submit","data":{"threads":[{"threadId":"t_1","message":"`+text+`"}]}}`)
	if code != 200 {
		e.t.Fatalf("action: %d %s", code, out)
	}
}

func TestWaitReturnsPendingEventsOnce(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	e.userMessage(sid, "hello")
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=2s", "")
	if code != 200 || !strings.Contains(out, "## t_1 \"T\" — message") || !strings.Contains(out, "> hello") {
		t.Fatalf("wait: %d %s", code, out)
	}
	if code, _ := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=100ms", ""); code != 204 {
		t.Fatalf("second wait should time out, got %d", code)
	}
}

func TestWaitWakesOnNewEventAndJSONFormat(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	go func() {
		time.Sleep(100 * time.Millisecond)
		e.userMessage(sid, "later")
	}()
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=5s&format=json", "")
	if code != 200 || !strings.Contains(out, `"events":[{"seq":`) || !strings.Contains(out, "later") {
		t.Fatalf("wait: %d %s", code, out)
	}
}

func TestWaitSuperseded(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	first := make(chan int)
	go func() {
		code, _ := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=5s", "")
		first <- code
	}()
	time.Sleep(100 * time.Millisecond)
	go e.do("GET", "/api/sessions/"+sid+"/wait?timeout=300ms", "")
	if code := <-first; code != http.StatusConflict {
		t.Fatalf("first wait got %d, want 409", code)
	}
}

// Review Focus 5: a wait whose client went away must not mark events delivered.
func TestWaitDisconnectDoesNotDeliver(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.hs.URL+"/api/sessions/"+sid+"/wait?timeout=5s", nil)
	req.Header.Set("Authorization", "Bearer secret")
	e.hs.Client().Do(req) // returns when ctx expires
	time.Sleep(50 * time.Millisecond)
	e.userMessage(sid, "after disconnect")
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=2s", "")
	if code != 200 || !strings.Contains(out, "after disconnect") {
		t.Fatalf("event lost: %d %s", code, out)
	}
}

func TestStreamSendsSnapshots(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.hs.URL+"/api/sessions/"+sid+"/stream", nil)
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := e.hs.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	readData := func() string {
		for sc.Scan() {
			if line := sc.Text(); strings.HasPrefix(line, "data: ") {
				return line
			}
		}
		t.Fatal("stream ended")
		return ""
	}
	if first := readData(); !strings.Contains(first, `"waiting":false`) {
		t.Fatalf("first snapshot: %s", first)
	}
	e.command(sid, "stage.add", `{"title":"Streamed"}`)
	if next := readData(); !strings.Contains(next, "Streamed") {
		t.Fatalf("next snapshot: %s", next)
	}
}

func TestRunWritesInfoAndStopsWhenIdle(t *testing.T) {
	home := t.TempDir()
	done := make(chan error, 1)
	go func() { done <- Run(context.Background(), Config{Home: home, Version: "v1", IdleTimeout: 200 * time.Millisecond}) }()
	deadline := time.Now().Add(2 * time.Second)
	var info store.DaemonInfo
	var err error
	for time.Now().Before(deadline) {
		if info, err = store.ReadDaemonInfo(home); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || info.Port == 0 || len(info.Token) < 32 || info.Version != "v1" {
		t.Fatalf("daemon info = %+v, %v", info, err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("daemon did not stop when idle")
	}
	if _, err := store.ReadDaemonInfo(home); err == nil {
		t.Fatal("daemon.json should be removed on exit")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/daemon/`
Expected: FAIL (`undefined: Run`, and the wait tests get the placeholder page instead of the API)

- [ ] **Step 3: Implement wait, stream and Run**

Add to `Handler()` in `internal/daemon/server.go`, right after the `blobs` route:

```go
	mux.HandleFunc("GET /api/sessions/{sid}/wait", s.wait)
	mux.HandleFunc("GET /api/sessions/{sid}/stream", s.stream)
```

`internal/daemon/wait.go`:

```go
package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/render"
)

var ErrWaitSuperseded = errors.New("wait superseded")

// BeginWait makes the caller the session's only waiter; a previous waiter is cancelled with ErrWaitSuperseded.
func (s *Session) BeginWait(parent context.Context) (context.Context, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.waitCancel != nil {
		s.waitCancel(ErrWaitSuperseded)
	}
	ctx, cancel := context.WithCancelCause(parent)
	s.waitSeq++
	mine := s.waitSeq
	s.waitCancel, s.waiting = cancel, true
	s.notifyLocked()
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			cancel(nil)
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.waitSeq == mine {
				s.waitCancel, s.waiting = nil, false
				s.notifyLocked()
			}
		})
	}
}

func (s *Server) wait(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	timeout := 9 * time.Minute
	if v := r.URL.Query().Get("timeout"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 || d > time.Hour {
			writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "timeout must be a duration between 0 and 1h", "")
			return
		}
		timeout = d
	}
	asJSON := r.URL.Query().Get("format") == "json"

	s.activity.Begin()
	defer s.activity.End()
	ctx, end := sess.BeginWait(r.Context())
	defer end()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		changed := sess.Changed()
		var body []byte
		var upTo int64
		var err error
		sess.Read(func(st *domain.State, evs []domain.Event) {
			pending := domain.PendingUserEvents(evs, st.Delivered)
			if len(pending) == 0 {
				return
			}
			upTo = pending[len(pending)-1].Seq
			if asJSON {
				body, err = json.Marshal(map[string]any{"events": pending})
			} else {
				var md string
				md, err = render.Wait(st, pending, sess.Blob)
				body = []byte(md)
			}
		})
		if err != nil {
			writeError(w, err)
			return
		}
		if body != nil {
			if ctx.Err() != nil {
				return // the client is gone: leave the events undelivered
			}
			if err := sess.MarkDelivered(upTo); err != nil {
				writeError(w, err)
				return
			}
			if asJSON {
				w.Header().Set("Content-Type", "application/json")
			} else {
				w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			}
			w.Write(body)
			return
		}
		select {
		case <-changed:
		case <-timer.C:
			w.WriteHeader(http.StatusNoContent)
			return
		case <-ctx.Done():
			if errors.Is(context.Cause(ctx), ErrWaitSuperseded) {
				writeErr(w, http.StatusConflict, "wait_superseded", "another tdm wait started for this session",
					"only one agent should wait per session")
			} else {
				writeErr(w, http.StatusServiceUnavailable, "daemon_stopping", "the wait was interrupted", "run `tdm wait` again")
			}
			return
		}
	}
}
```

`internal/daemon/stream.go`:

```go
package daemon

import (
	"fmt"
	"net/http"
)

// stream pushes the whole session snapshot on connect and after every change (SSE).
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "internal", "streaming unsupported", "")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	s.activity.Begin()
	defer s.activity.End()
	for {
		changed := sess.Changed()
		snap, err := sess.Snapshot()
		if err != nil {
			return
		}
		if _, err := fmt.Fprintf(w, "event: state\ndata: %s\n\n", snap); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-changed:
		case <-r.Context().Done():
			return
		}
	}
}
```

`internal/daemon/run.go`:

```go
package daemon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

// Run serves the daemon until ctx is done, /api/shutdown is called, or it has been idle for cfg.IdleTimeout.
func Run(ctx context.Context, cfg Config) error {
	mgr, err := NewManager(cfg.Home)
	if err != nil {
		return err
	}
	defer mgr.Close()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	cfg.Port = ln.Addr().(*net.TCPAddr).Port
	if cfg.Token == "" {
		var b [32]byte
		if _, err := rand.Read(b[:]); err != nil {
			return err
		}
		cfg.Token = hex.EncodeToString(b[:])
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = 30 * time.Minute
	}

	ctx, stop := context.WithCancel(ctx)
	defer stop()
	srv := NewServer(cfg, mgr, stop)
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx }, // shutdown ends long polls
	}
	if err := store.WriteDaemonInfo(cfg.Home, store.DaemonInfo{Port: cfg.Port, PID: os.Getpid(), Version: cfg.Version, Token: cfg.Token}); err != nil {
		ln.Close()
		return err
	}
	defer store.RemoveDaemonInfo(cfg.Home, os.Getpid())

	go srv.watchIdle(ctx, stop)
	errc := make(chan error, 1)
	go func() { errc <- httpSrv.Serve(ln) }()
	select {
	case <-ctx.Done():
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}

func (s *Server) watchIdle(ctx context.Context, stop func()) {
	tick := time.NewTicker(max(s.cfg.IdleTimeout/10, 10*time.Millisecond))
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if s.activity.Idle(s.cfg.IdleTimeout) {
				stop()
				return
			}
		}
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test -race ./internal/daemon/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/daemon
git commit -m "feat(daemon): long-poll wait, sse stream, run with idle shutdown"
```

---

### Task 11: Client: daemon discovery, auto-start, version check

**Files:**
- Create: `internal/client/client.go`, `internal/client/connect.go`
- Test: `internal/client/client_test.go`

**Interfaces:**
- Consumes: `store.DaemonInfo`, `store.ReadDaemonInfo`, `store.RemoveDaemonInfo`
- Produces:
  - `type Client`, `func New(info store.DaemonInfo) *Client`, `func (c *Client) BaseURL() string`, `func (c *Client) Token() string`
  - `func (c *Client) Do(ctx context.Context, method, path string, in, out any) error`: JSON in/out; returns `*APIError` for status ≥ 400
  - `func (c *Client) Raw(ctx context.Context, method, path string, in any) (int, []byte, error)`
  - `type APIError struct{Status int; Code, Message, Hint string}`, `func DecodeError(status int, body []byte) error`
  - `func Connect(ctx context.Context, home, version string) (*Client, error)`: reuses a healthy daemon with the same version, otherwise shuts it down or clears stale info, then starts a new one
  - `func Existing(ctx context.Context, home string) (*Client, store.DaemonInfo, error)`: never starts a daemon
  - `var StartDaemon func(home string) error` (tests replace it), `var startTimeout = 5 * time.Second`

- [ ] **Step 1: Write the failing tests**

`internal/client/client_test.go`:

```go
package client

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

func fakeDaemon(t *testing.T, version string, onShutdown func()) (*httptest.Server, store.DaemonInfo) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"version":"` + version + `"}`))
	})
	mux.HandleFunc("POST /api/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"ok":true}`))
		if onShutdown != nil {
			go onShutdown()
		}
	})
	hs := httptest.NewServer(mux)
	t.Cleanup(hs.Close)
	u, _ := url.Parse(hs.URL)
	port, _ := strconv.Atoi(u.Port())
	return hs, store.DaemonInfo{Port: port, PID: 1, Version: version, Token: "tok"}
}

func stubStart(t *testing.T, fn func(home string) error) {
	old := StartDaemon
	StartDaemon = fn
	t.Cleanup(func() { StartDaemon = old })
}

func TestConnectReusesRunningDaemon(t *testing.T) {
	home := t.TempDir()
	_, info := fakeDaemon(t, "v1", nil)
	store.WriteDaemonInfo(home, info)
	stubStart(t, func(string) error { t.Fatal("must not start a daemon"); return nil })
	c, err := Connect(context.Background(), home, "v1")
	if err != nil || c.Token() != "tok" {
		t.Fatalf("Connect = %v, %v", c, err)
	}
}

// Review Focus 3: a stale daemon.json is replaced transparently.
func TestConnectRestartsStaleDaemon(t *testing.T) {
	home := t.TempDir()
	dead, info := fakeDaemon(t, "v1", nil)
	dead.Close()
	store.WriteDaemonInfo(home, info)
	started := false
	stubStart(t, func(h string) error {
		started = true
		_, fresh := fakeDaemon(t, "v1", nil)
		return store.WriteDaemonInfo(h, fresh)
	})
	c, err := Connect(context.Background(), home, "v1")
	if err != nil || !started || c.BaseURL() == "http://127.0.0.1:"+strconv.Itoa(info.Port) {
		t.Fatalf("started=%v c=%v err=%v", started, c, err)
	}
}

func TestConnectReplacesOtherVersion(t *testing.T) {
	home := t.TempDir()
	var old *httptest.Server
	shutdown := make(chan struct{})
	old, info := fakeDaemon(t, "v0", func() { old.Close(); close(shutdown) })
	store.WriteDaemonInfo(home, info)
	stubStart(t, func(h string) error {
		_, fresh := fakeDaemon(t, "v1", nil)
		return store.WriteDaemonInfo(h, fresh)
	})
	if _, err := Connect(context.Background(), home, "v1"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-shutdown:
	default:
		t.Fatal("old daemon was not asked to shut down")
	}
}

func TestConnectGivesUp(t *testing.T) {
	old := startTimeout
	startTimeout = 200 * time.Millisecond
	t.Cleanup(func() { startTimeout = old })
	stubStart(t, func(string) error { return nil })
	_, err := Connect(context.Background(), t.TempDir(), "v1")
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "daemon_unavailable" || ae.Hint == "" {
		t.Fatalf("err = %v", err)
	}
}

func TestDecodeError(t *testing.T) {
	err := DecodeError(404, []byte(`{"error":{"code":"thread_not_found","message":"no thread t_9","hint":"run x"}}`))
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "thread_not_found" || ae.Hint != "run x" || ae.Status != 404 {
		t.Fatalf("err = %#v", err)
	}
	err = DecodeError(502, []byte("bad gateway"))
	if !errors.As(err, &ae) || ae.Code != "http_error" {
		t.Fatalf("err = %#v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/client/`
Expected: FAIL (`undefined: Connect`)

- [ ] **Step 3: Implement the client**

`internal/client/client.go`:

```go
// Package client talks to the tdm daemon over its local HTTP API.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

type Client struct {
	base, token string
	hc          *http.Client
}

// APIError is an error reported by the daemon (or a failure to reach it) with a recovery hint.
type APIError struct {
	Status  int
	Code    string
	Message string
	Hint    string
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

func New(info store.DaemonInfo) *Client {
	return &Client{base: fmt.Sprintf("http://127.0.0.1:%d", info.Port), token: info.Token, hc: &http.Client{}}
}

func (c *Client) BaseURL() string { return c.base }
func (c *Client) Token() string   { return c.token }

// Raw sends a request and returns the status and body without interpreting them.
func (c *Client) Raw(ctx context.Context, method, path string, in any) (int, []byte, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	return resp.StatusCode, data, err
}

// Do sends JSON and decodes a JSON response into out (when non-nil).
func (c *Client) Do(ctx context.Context, method, path string, in, out any) error {
	status, body, err := c.Raw(ctx, method, path, in)
	if err != nil {
		return err
	}
	if status >= 400 {
		return DecodeError(status, body)
	}
	if out != nil && len(body) > 0 {
		return json.Unmarshal(body, out)
	}
	return nil
}

// DecodeError turns a daemon error body {"error":{…}} into *APIError.
func DecodeError(status int, body []byte) error {
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Hint    string `json:"hint"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &env) != nil || env.Error.Code == "" {
		return &APIError{Status: status, Code: "http_error",
			Message: fmt.Sprintf("daemon returned %d: %s", status, strings.TrimSpace(string(body)))}
	}
	return &APIError{Status: status, Code: env.Error.Code, Message: env.Error.Message, Hint: env.Error.Hint}
}

// Health returns the daemon version, failing fast when nothing answers.
func (c *Client) Health(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	var h struct {
		Version string `json:"version"`
	}
	if err := c.Do(ctx, http.MethodGet, "/health", nil, &h); err != nil {
		return "", err
	}
	return h.Version, nil
}
```

`internal/client/connect.go`:

```go
package client

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

// StartDaemon launches the daemon in the background; tests replace it.
var StartDaemon = startDaemonProcess

var startTimeout = 5 * time.Second

// Existing returns a client for a running, healthy daemon without starting one.
func Existing(ctx context.Context, home string) (*Client, store.DaemonInfo, error) {
	info, err := store.ReadDaemonInfo(home)
	if err != nil {
		return nil, info, err
	}
	c := New(info)
	v, err := c.Health(ctx)
	info.Version = v
	return c, info, err
}

// Connect returns a client for a daemon running this exact version, starting or replacing one if needed.
func Connect(ctx context.Context, home, version string) (*Client, error) {
	if c, info, err := Existing(ctx, home); err == nil {
		if info.Version == version {
			return c, nil
		}
		_ = c.Do(ctx, http.MethodPost, "/api/shutdown", nil, nil)
		waitGone(ctx, c)
	}
	if err := store.RemoveDaemonInfo(home, 0); err != nil {
		return nil, err
	}
	if err := StartDaemon(home); err != nil {
		return nil, &APIError{Code: "daemon_unavailable", Message: "start daemon: " + err.Error()}
	}
	deadline := time.Now().Add(startTimeout)
	for time.Now().Before(deadline) {
		if c, info, err := Existing(ctx, home); err == nil && info.Version == version {
			return c, nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return nil, &APIError{Code: "daemon_unavailable", Message: "the tdm daemon did not start in time",
		Hint: "check " + filepath.Join(home, "daemon.log")}
}

func waitGone(ctx context.Context, c *Client) {
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := c.Health(ctx); err != nil {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func startDaemonProcess(home string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		return err
	}
	logf, err := os.OpenFile(filepath.Join(home, "daemon.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logf.Close()
	cmd := exec.Command(exe, "daemon", "run")
	cmd.Env = append(os.Environ(), "TANDEM_HOME="+home)
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} // survive the agent's shell
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/client/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/client
git commit -m "feat(client): daemon discovery, auto-start and version check"
```

---

### Task 12: CLI foundation and session commands

**Files:**
- Create: `cmd/tdm/main.go`, `internal/cli/app.go`, `internal/cli/session.go`
- Test: `internal/cli/cli_test.go` (shared helpers), `internal/cli/session_test.go`

**Interfaces:**
- Consumes: `client.Connect/APIError/DecodeError`, `store.ProjectFor/Home`, `daemon.Run` (tests only)
- Produces:
  - `func Execute(version string, args []string, stdin io.Reader, stdout, stderr io.Writer) int`
  - app helpers used by later tasks:
    - `a.connect(ctx) (*client.Client, error)`
    - `a.project() (store.Project, error)`
    - `a.sessionID(ctx, c) (string, error)`
    - `a.call(ctx, typ string, data any) (domain.Result, error)`
    - `a.view(ctx, what, stage string) (string, error)`
    - `a.emit(text string, v any) error`
    - `a.text(flag string, args []string) (string, error)`
    - `a.readStdin() (string, error)`
  - error types: `usageError{msg}` (exit 2), `cliError{Code, Message, Hint}` (exit 1), `errTimeout` (exit 3)
  - `func exactArgs(n int) cobra.PositionalArgs`, `func maxArgs(n int) cobra.PositionalArgs`
  - `func (a *app) commands() []*cobra.Command`: the list of top-level commands, extended by Tasks 13–15
  - commands: `tdm session new|list|use|show|close`, `tdm open`
  - test helpers (package `cli`):
    - `startDaemon(t) (home string)`
    - `run(t, stdin, args...) (stdout, stderr string, code int)`
    - `must(t, stdin, args...) string`
    - `newSession(t) string`
    - `userAction(t, home, sid, typ, data string)`

- [ ] **Step 1: Add cobra and write the failing tests**

```bash
go get github.com/spf13/cobra@latest
```

`internal/cli/cli_test.go`:

```go
package cli

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/daemon"
	"github.com/lukaszfiszer/tandem/internal/store"
)

// startDaemon runs an in-process daemon with version "test" and chdirs into an empty project dir.
func startDaemon(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	home, proj := filepath.Join(root, "home"), filepath.Join(root, "proj")
	os.MkdirAll(proj, 0o700)
	t.Setenv("TANDEM_HOME", home)
	t.Setenv("TANDEM_NO_BROWSER", "1")
	t.Setenv("TANDEM_SESSION", "")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- daemon.Run(ctx, daemon.Config{Home: home, Version: "test", IdleTimeout: time.Hour}) }()
	t.Cleanup(func() { cancel(); <-done })
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := store.ReadDaemonInfo(home); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("daemon did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Chdir(proj)
	return home
}

func run(t *testing.T, stdin string, args ...string) (string, string, int) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Execute("test", args, strings.NewReader(stdin), &out, &errOut)
	return out.String(), errOut.String(), code
}

func must(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	out, errOut, code := run(t, stdin, args...)
	if code != 0 {
		t.Fatalf("tdm %s: exit %d\n%s", strings.Join(args, " "), code, errOut)
	}
	return out
}

func newSession(t *testing.T) string {
	t.Helper()
	return strings.Fields(must(t, "", "session", "new", "Test"))[0]
}

// userAction posts a browser action straight to the daemon.
func userAction(t *testing.T, home, sid, typ, data string) {
	t.Helper()
	info, err := store.ReadDaemonInfo(home)
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"type":%q,"data":%s}`, typ, data)
	req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/api/sessions/%s/actions", info.Port, sid), strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+info.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("user action %s: %v %v", typ, resp, err)
	}
	resp.Body.Close()
}
```

`internal/cli/session_test.go`:

```go
package cli

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

func TestSessionLifecycle(t *testing.T) {
	startDaemon(t)
	out := must(t, "", "session", "new", "Implement idea ABC")
	fields := strings.Fields(out)
	sid := fields[0]
	if !regexp.MustCompile(`^s_[0-9a-f]{6}$`).MatchString(sid) || !strings.Contains(fields[1], "/s/"+sid+"?token=") {
		t.Fatalf("session new printed %q", out)
	}
	if show := must(t, "", "session", "show"); !strings.HasPrefix(show, "# Session "+sid+" \"Implement idea ABC\" — active\n") {
		t.Fatalf("show = %q", show)
	}
	sid2 := newSession(t)
	if list := must(t, "", "session", "list"); !strings.Contains(list, "* "+sid2) || !strings.Contains(list, "  "+sid) {
		t.Fatalf("list = %q", list)
	}
	must(t, "", "session", "use", sid)
	if show := must(t, "", "--session", sid2, "session", "show"); !strings.Contains(show, "\"Test\"") {
		t.Fatalf("--session ignored: %q", show)
	}
	t.Setenv("TANDEM_SESSION", sid2)
	if show := must(t, "", "session", "show"); !strings.Contains(show, "\"Test\"") {
		t.Fatalf("TANDEM_SESSION ignored: %q", show)
	}
	t.Setenv("TANDEM_SESSION", "")
	var state struct {
		Session struct{ ID string } `json:"session"`
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &state); err != nil || state.Session.ID != sid {
		t.Fatalf("json show: %+v %v", state, err)
	}
	if out := must(t, "", "open"); !strings.Contains(out, "/s/"+sid+"?token=") {
		t.Fatalf("open = %q", out)
	}
	if out := must(t, "", "session", "close"); out != "closed "+sid+"\n" {
		t.Fatalf("close = %q", out)
	}
}

func TestNoActiveSession(t *testing.T) {
	startDaemon(t)
	_, errOut, code := run(t, "", "session", "show")
	if code != 1 || !strings.Contains(errOut, "error: no_active_session:") || !strings.Contains(errOut, "hint: run `tdm session new") {
		t.Fatalf("code %d, stderr %q", code, errOut)
	}
	_, errOut, _ = run(t, "", "--json", "session", "show")
	var body struct {
		Error struct{ Code, Hint string } `json:"error"`
	}
	if json.Unmarshal([]byte(errOut), &body) != nil || body.Error.Code != "no_active_session" {
		t.Fatalf("json error = %q", errOut)
	}
}

func TestUsageErrorsExitTwo(t *testing.T) {
	startDaemon(t)
	for _, args := range [][]string{{"session", "new"}, {"session", "list", "extra"}, {"nope"}, {"session", "show", "--bogus"}} {
		if _, errOut, code := run(t, "", args...); code != 2 || !strings.Contains(errOut, "error: usage:") {
			t.Fatalf("tdm %v: code %d, stderr %q", args, code, errOut)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/cli/`
Expected: FAIL (`undefined: Execute`)

- [ ] **Step 3: Implement main, app and session commands**

`cmd/tdm/main.go`:

```go
package main

import (
	"os"

	"github.com/lukaszfiszer/tandem/internal/cli"
)

// version is set at build time: go build -ldflags "-X main.version=v0.1.0".
var version = "dev"

func main() {
	os.Exit(cli.Execute(version, os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
```

`internal/cli/app.go`:

```go
// Package cli implements the agent-facing tdm commands.
package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/client"
	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/store"
)

type app struct {
	version        string
	stdin          io.Reader
	stdout, stderr io.Writer
	jsonOut        bool
	sessionFlag    string
	client         *client.Client
}

type usageError struct{ msg string }

func (e *usageError) Error() string { return e.msg }

type cliError struct{ Code, Message, Hint string }

func (e *cliError) Error() string { return e.Code + ": " + e.Message }

var errTimeout = errors.New("wait timed out")

// Execute runs tdm with args and returns the process exit code.
func Execute(version string, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	a := &app{version: version, stdin: stdin, stdout: stdout, stderr: stderr}
	root := a.rootCmd()
	root.SetArgs(args)
	root.SetIn(stdin)
	root.SetOut(stdout)
	root.SetErr(stderr)
	return a.report(root.ExecuteContext(context.Background()))
}

func (a *app) rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:           "tdm",
		Short:         "Work through AI output with a human, stage by stage, thread by thread",
		Long:          "Tandem is driven by an AI agent. Run `tdm guide` for the full protocol.",
		Version:       a.version,
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.CompletionOptions.DisableDefaultCmd = true
	root.PersistentFlags().BoolVar(&a.jsonOut, "json", false, "print JSON instead of text")
	root.PersistentFlags().StringVar(&a.sessionFlag, "session", "", "session id (default: $TANDEM_SESSION, then the project's active session)")
	root.SetFlagErrorFunc(func(_ *cobra.Command, err error) error { return &usageError{err.Error()} })
	root.AddCommand(a.commands()...)
	return root
}

func (a *app) commands() []*cobra.Command {
	return []*cobra.Command{a.sessionCmd(), a.openCmd()}
}

func exactArgs(n int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) != n {
			return &usageError{fmt.Sprintf("%s takes %d argument(s), got %d", cmd.CommandPath(), n, len(args))}
		}
		return nil
	}
}

func maxArgs(n int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) > n {
			return &usageError{fmt.Sprintf("%s takes at most %d argument(s), got %d", cmd.CommandPath(), n, len(args))}
		}
		return nil
	}
}

func isCobraUsage(err error) bool {
	m := err.Error()
	return strings.HasPrefix(m, "unknown command") || strings.HasPrefix(m, "required flag") ||
		strings.HasPrefix(m, "unknown flag") || strings.HasPrefix(m, "unknown shorthand flag")
}

// report prints err (text or JSON) to stderr and maps it to an exit code.
func (a *app) report(err error) int {
	if err == nil {
		return 0
	}
	if errors.Is(err, errTimeout) {
		return 3
	}
	body, exit := domain.Error{Code: "error", Message: err.Error()}, 1
	var ae *client.APIError
	var ce *cliError
	var ue *usageError
	switch {
	case errors.As(err, &ae):
		body = domain.Error{Code: ae.Code, Message: ae.Message, Hint: ae.Hint}
	case errors.As(err, &ce):
		body = domain.Error{Code: ce.Code, Message: ce.Message, Hint: ce.Hint}
	case errors.As(err, &ue) || isCobraUsage(err):
		body, exit = domain.Error{Code: "usage", Message: err.Error(), Hint: "run `tdm <command> --help`"}, 2
	}
	if a.jsonOut {
		json.NewEncoder(a.stderr).Encode(map[string]any{"error": body})
		return exit
	}
	fmt.Fprintf(a.stderr, "error: %s: %s\n", body.Code, body.Message)
	if body.Hint != "" {
		fmt.Fprintf(a.stderr, "hint: %s\n", body.Hint)
	}
	return exit
}

// emit prints text, or v as JSON with --json.
func (a *app) emit(text string, v any) error {
	if a.jsonOut {
		enc := json.NewEncoder(a.stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(v)
	}
	_, err := fmt.Fprintln(a.stdout, strings.TrimRight(text, "\n"))
	return err
}

func (a *app) connect(ctx context.Context) (*client.Client, error) {
	if a.client != nil {
		return a.client, nil
	}
	home, err := store.Home()
	if err != nil {
		return nil, err
	}
	c, err := client.Connect(ctx, home, a.version)
	if err != nil {
		return nil, err
	}
	a.client = c
	return c, nil
}

func (a *app) project() (store.Project, error) { return store.ProjectFor(".") }

var errNoActive = &cliError{Code: "no_active_session", Message: "no active session for this project",
	Hint: "run `tdm session new \"<title>\"` or pass --session <id>"}

// sessionID resolves --session, then $TANDEM_SESSION, then the project's active session.
func (a *app) sessionID(ctx context.Context, c *client.Client) (string, error) {
	if a.sessionFlag != "" {
		return a.sessionFlag, nil
	}
	if v := os.Getenv("TANDEM_SESSION"); v != "" {
		return v, nil
	}
	p, err := a.project()
	if err != nil {
		return "", err
	}
	var proj store.Project
	if err := c.Do(ctx, http.MethodGet, "/api/projects/"+p.ID, nil, &proj); err != nil {
		var ae *client.APIError
		if errors.As(err, &ae) && ae.Code == domain.CodeProjectNotFound {
			return "", errNoActive
		}
		return "", err
	}
	if proj.ActiveSessionID == "" {
		return "", errNoActive
	}
	return proj.ActiveSessionID, nil
}

// call sends an agent command to the current session.
func (a *app) call(ctx context.Context, typ string, data any) (domain.Result, error) {
	var res domain.Result
	c, err := a.connect(ctx)
	if err != nil {
		return res, err
	}
	sid, err := a.sessionID(ctx, c)
	if err != nil {
		return res, err
	}
	err = c.Do(ctx, http.MethodPost, "/api/sessions/"+sid+"/commands", map[string]any{"type": typ, "data": data}, &res)
	return res, err
}

// view fetches a rendered markdown view (show, summarize, export) of the current session.
func (a *app) view(ctx context.Context, what, stage string) (string, error) {
	c, err := a.connect(ctx)
	if err != nil {
		return "", err
	}
	sid, err := a.sessionID(ctx, c)
	if err != nil {
		return "", err
	}
	path := "/api/sessions/" + sid + "/render/" + what
	if stage != "" {
		path += "?stage=" + url.QueryEscape(stage)
	}
	status, body, err := c.Raw(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", client.DecodeError(status, body)
	}
	return string(body), nil
}

// readStdin returns piped stdin, or "" when stdin is an interactive terminal.
func (a *app) readStdin() (string, error) {
	if f, ok := a.stdin.(*os.File); ok {
		if fi, err := f.Stat(); err == nil && fi.Mode()&os.ModeCharDevice != 0 {
			return "", nil
		}
	}
	b, err := io.ReadAll(a.stdin)
	return string(b), err
}

// text takes the value from the flag, else the joined args, else stdin.
func (a *app) text(flag string, args []string) (string, error) {
	t := flag
	if t == "" && len(args) > 0 {
		t = strings.Join(args, " ")
	}
	if t == "" {
		s, err := a.readStdin()
		if err != nil {
			return "", err
		}
		t = s
	}
	if strings.TrimSpace(t) == "" {
		return "", &usageError{"text is required: pass it as an argument, with --text, or on stdin"}
	}
	return t, nil
}

func openBrowser(u string) error {
	if os.Getenv("TANDEM_NO_BROWSER") != "" {
		return nil
	}
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	return exec.Command(name, u).Start()
}
```

`internal/cli/session.go`:

```go
package cli

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/client"
)

type sessionInfo struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
	Active bool   `json:"active"`
}

func (a *app) sessionCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "session", Short: "Create, list, switch and close sessions"}

	var noOpen bool
	newCmd := &cobra.Command{
		Use: "new <title>", Short: "Create a session, make it active and open the browser", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			p, err := a.project()
			if err != nil {
				return err
			}
			var res struct {
				ID  string `json:"id"`
				URL string `json:"url"`
			}
			if err := c.Do(ctx, http.MethodPost, "/api/sessions", map[string]any{"project": p, "title": args[0]}, &res); err != nil {
				return err
			}
			if !noOpen {
				if err := openBrowser(res.URL); err != nil {
					fmt.Fprintf(a.stderr, "warning: could not open a browser: %v\n", err)
				}
			}
			return a.emit(res.ID+" "+res.URL, res)
		},
	}
	newCmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open the browser")

	list := &cobra.Command{
		Use: "list", Short: "List this project's sessions (* = active)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			p, err := a.project()
			if err != nil {
				return err
			}
			var infos []sessionInfo
			if err := c.Do(ctx, http.MethodGet, "/api/projects/"+p.ID+"/sessions", nil, &infos); err != nil {
				return err
			}
			sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
			if len(infos) == 0 {
				return a.emit("No sessions yet. Run `tdm session new \"<title>\"`.", infos)
			}
			var b strings.Builder
			for _, s := range infos {
				mark := " "
				if s.Active {
					mark = "*"
				}
				fmt.Fprintf(&b, "%s %s %q — %s\n", mark, s.ID, s.Title, s.Status)
			}
			return a.emit(b.String(), infos)
		},
	}

	use := &cobra.Command{
		Use: "use <session-id>", Short: "Make a session the project's active session", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			p, err := a.project()
			if err != nil {
				return err
			}
			if err := c.Do(ctx, http.MethodPost, "/api/projects/"+p.ID+"/active", map[string]string{"sessionId": args[0]}, nil); err != nil {
				return err
			}
			return a.emit(args[0], map[string]string{"id": args[0]})
		},
	}

	show := &cobra.Command{
		Use: "show", Short: "Show stages, threads and the user input awaiting you", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			if a.jsonOut {
				c, err := a.connect(ctx)
				if err != nil {
					return err
				}
				sid, err := a.sessionID(ctx, c)
				if err != nil {
					return err
				}
				status, body, err := c.Raw(ctx, http.MethodGet, "/api/sessions/"+sid+"/state", nil)
				if err != nil {
					return err
				}
				if status >= 400 {
					return client.DecodeError(status, body)
				}
				_, err = a.stdout.Write(append(body, '\n'))
				return err
			}
			md, err := a.view(ctx, "show", "")
			if err != nil {
				return err
			}
			return a.emit(md, nil)
		},
	}

	closeCmd := &cobra.Command{
		Use: "close", Short: "Close the session (read-only afterwards)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			res, err := a.call(cmd.Context(), "session.close", struct{}{})
			if err != nil {
				return err
			}
			return a.emit("closed "+res.ID, res)
		},
	}

	cmd.AddCommand(newCmd, list, use, show, closeCmd)
	return cmd
}

func (a *app) openCmd() *cobra.Command {
	return &cobra.Command{
		Use: "open", Short: "Open the current session in the browser", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			sid, err := a.sessionID(ctx, c)
			if err != nil {
				return err
			}
			u := c.BaseURL() + "/s/" + sid + "?token=" + c.Token()
			if err := openBrowser(u); err != nil {
				return err
			}
			return a.emit(u, map[string]string{"url": u})
		},
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/cli/ && go build ./cmd/tdm`
Expected: PASS, and the build succeeds

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum cmd internal/cli
git commit -m "feat(cli): tdm binary, error/exit-code contract, session commands"
```

---

### Task 13: Content commands (stage, thread, block, annotate, say, conclude)

**Files:**
- Create: `internal/cli/content.go`, `internal/cli/files.go`
- Modify: `internal/cli/app.go` (`commands()`)
- Test: `internal/cli/content_test.go`

**Interfaces:**
- Consumes: Task 12 helpers, `domain.AddStage/AddThread/AddBlock/Annotate/Say/Conclude/ProposeStageSummary/BlockContent/Variants/VariantOption/ParseLineRange/LangFromPath`
- Produces:
  - `tdm stage add <title> [--goal]` → `st_N`; `tdm stage summarize [--stage]` → markdown; `tdm stage propose [text] [--stage]` → `st_N`
  - `tdm thread add <title> [--stage]` → `t_N`
  - `tdm block add note|code|file|markdown|variants [--thread] [--supersedes]` → `b_N` (for variants: `b_N o_1 o_2 …`)
  - `tdm annotate <block-id> --lines a[-b] <text>` → `b_N`
  - `tdm say [text] [--thread]` / `tdm conclude [text] [--thread]` → `t_N`
  - `func readExcerpt(root, path, lines string) (rel, content string, first int, err error)`; its error codes are `path_outside_project`, `file_not_found`, `file_too_large`, `binary_file`, `invalid_input`

- [ ] **Step 1: Write the failing tests**

`internal/cli/content_test.go`:

```go
package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestContentCommands(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	if out := must(t, "", "stage", "add", "Data model", "--goal", "Pick storage"); out != "st_1\n" {
		t.Fatalf("stage add = %q", out)
	}
	if out := must(t, "", "thread", "add", "Repository layer"); out != "t_1\n" {
		t.Fatalf("thread add = %q", out)
	}
	if out := must(t, "Because the domain must not know storage.", "block", "add", "note"); out != "b_1\n" {
		t.Fatalf("note = %q", out)
	}
	os.MkdirAll("src", 0o700)
	os.WriteFile("src/Repo.kt", []byte("class Repo(\n    val db: Db,\n    val cache: Map<String, User>?\n)\n"), 0o600)
	if out := must(t, "", "block", "add", "file", "--path", "src/Repo.kt", "--lines", "2-3"); out != "b_2\n" {
		t.Fatalf("file = %q", out)
	}
	if out := must(t, "", "annotate", "b_2", "--lines", "3", "Lazy on purpose"); out != "b_2\n" {
		t.Fatalf("annotate = %q", out)
	}
	must(t, "", "block", "add", "code", "--lang", "go", "--text", "x := 1")
	must(t, "# Title\n\ntext\n", "block", "add", "markdown")
	variants := `{"title":"Cache","options":[
	  {"title":"Empty map","pros":["no nulls"],"blocks":[{"type":"file","path":"src/Repo.kt","lines":"1"}]},
	  {"title":"Lazy","cons":["subtle"]}]}`
	if out := must(t, variants, "block", "add", "variants", "--input", "-"); out != "b_5 o_1 o_2\n" {
		t.Fatalf("variants = %q", out)
	}
	must(t, "", "block", "add", "note", "--supersedes", "b_1", "--text", "Updated note")
	if out := must(t, "", "say", "Here it is"); out != "t_1\n" {
		t.Fatalf("say = %q", out)
	}

	var st struct {
		Blocks map[string]struct {
			Path, Lang   string
			FirstLine    int `json:"firstLine"`
			LineCount    int `json:"lineCount"`
			SupersededBy string
			Variants     struct {
				Options []struct {
					Blocks []struct {
						Path      string
						LineCount int `json:"lineCount"`
						BlobSha   string
					}
				}
			}
		}
	}
	json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &st)
	b2 := st.Blocks["b_2"]
	if b2.Path != "src/Repo.kt" || b2.Lang != "kotlin" || b2.FirstLine != 2 || b2.LineCount != 2 {
		t.Fatalf("b_2 = %+v", b2)
	}
	if st.Blocks["b_1"].SupersededBy != "b_6" {
		t.Fatalf("b_1 = %+v", st.Blocks["b_1"])
	}
	if nb := st.Blocks["b_5"].Variants.Options[0].Blocks[0]; nb.Path != "src/Repo.kt" || nb.LineCount != 1 {
		t.Fatalf("nested block = %+v", nb)
	}

	must(t, "", "conclude", "Keep the repository.")
	userAction(t, home, sid, "conclusion.accept", `{"threadId":"t_1"}`)
	if out := must(t, "", "stage", "summarize"); !strings.Contains(out, "## t_1 \"Repository layer\"\nKeep the repository.") {
		t.Fatalf("summarize = %q", out)
	}
	if out := must(t, "Repository stays.", "stage", "propose"); out != "st_1\n" {
		t.Fatalf("propose = %q", out)
	}
}

func TestContentErrors(t *testing.T) {
	startDaemon(t)
	newSession(t)
	_, errOut, code := run(t, "", "thread", "add", "x")
	if code != 1 || !strings.Contains(errOut, "error: no_open_stage:") || !strings.Contains(errOut, "hint: add one with `tdm stage add") {
		t.Fatalf("thread without stage: %d %q", code, errOut)
	}
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	if _, errOut, code := run(t, "", "block", "add", "note"); code != 2 || !strings.Contains(errOut, "text is required") {
		t.Fatalf("empty note: %d %q", code, errOut)
	}
	if _, _, code := run(t, "", "annotate", "b_1", "x"); code != 2 {
		t.Fatalf("annotate without --lines: %d", code)
	}
	if _, errOut, code := run(t, "", "stage", "propose", "done"); code != 1 || !strings.Contains(errOut, "hint: open threads: t_1") {
		t.Fatalf("propose with open thread: %d %q", code, errOut)
	}
}

// Review Focus 2: bad file inputs fail with a specific code and hint.
func TestFileBlockErrors(t *testing.T) {
	startDaemon(t)
	newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	os.WriteFile("four.kt", []byte("1\n2\n3\n4\n"), 0o600)
	os.WriteFile("bin.dat", []byte("a\x00b"), 0o600)
	os.WriteFile("big.txt", bytes.Repeat([]byte("x"), 1<<20+1), 0o600)
	os.WriteFile("../outside.txt", []byte("x\n"), 0o600)
	cases := []struct {
		args       []string
		code, hint string
	}{
		{[]string{"--path", "../outside.txt"}, "path_outside_project", "hint: Tandem only snapshots files inside"},
		{[]string{"--path", "missing.kt"}, "file_not_found", ""},
		{[]string{"--path", "bin.dat"}, "binary_file", ""},
		{[]string{"--path", "big.txt"}, "file_too_large", "hint: pass --lines"},
		{[]string{"--path", "four.kt", "--lines", "3-9"}, "invalid_input", "hint: four.kt has 4 lines"},
	}
	for _, tc := range cases {
		_, errOut, code := run(t, "", append([]string{"block", "add", "file"}, tc.args...)...)
		if code != 1 || !strings.Contains(errOut, "error: "+tc.code+":") || !strings.Contains(errOut, tc.hint) {
			t.Fatalf("%v: code %d, stderr %q", tc.args, code, errOut)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/cli/`
Expected: FAIL (`unknown command "stage" for "tdm"` → exit 2)

- [ ] **Step 3: Implement file excerpts and content commands**

`internal/cli/files.go`:

```go
package cli

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

const maxFileSize = 1 << 20

// resolvePath makes p absolute with symlinks resolved, even when the file itself does not exist.
func resolvePath(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(abs); err == nil {
		return r, nil
	}
	if dir, err := filepath.EvalSymlinks(filepath.Dir(abs)); err == nil {
		return filepath.Join(dir, filepath.Base(abs)), nil
	}
	return abs, nil
}

// readExcerpt snapshots lines of a file inside the project root.
// It returns the root-relative slash path, the excerpt text (newline-terminated) and its first line number.
func readExcerpt(root, path, lines string) (string, string, int, error) {
	abs, err := resolvePath(path)
	if err != nil {
		return "", "", 0, err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", 0, &cliError{Code: "path_outside_project", Message: path + " is outside the project",
			Hint: "Tandem only snapshots files inside " + root}
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", "", 0, &cliError{Code: "file_not_found", Message: fmt.Sprintf("cannot read %s: %v", path, err)}
	}
	if info.Size() > maxFileSize {
		return "", "", 0, &cliError{Code: "file_too_large", Message: fmt.Sprintf("%s is larger than 1 MiB", path),
			Hint: "pass --lines to snapshot only the relevant part"}
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", "", 0, &cliError{Code: "file_not_found", Message: fmt.Sprintf("cannot read %s: %v", path, err)}
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return "", "", 0, &cliError{Code: "binary_file", Message: path + " looks binary", Hint: "only text files can be shown"}
	}
	all := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	r := domain.LineRange{Start: 1, End: len(all)}
	if lines != "" {
		if r, err = domain.ParseLineRange(lines); err != nil {
			return "", "", 0, &usageError{err.Error()}
		}
		if r.End > len(all) {
			return "", "", 0, &cliError{Code: domain.CodeInvalidInput, Message: fmt.Sprintf("lines %s are beyond the end of %s", r, path),
				Hint: fmt.Sprintf("%s has %d lines", path, len(all))}
		}
	}
	return filepath.ToSlash(rel), strings.Join(all[r.Start-1:r.End], "\n") + "\n", r.Start, nil
}
```

`internal/cli/content.go`:

```go
package cli

import (
	"encoding/json"
	"strings"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

func (a *app) stageCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "stage", Short: "Add, summarize and propose stages"}

	var goal string
	add := &cobra.Command{
		Use: "add <title>", Short: "Add a stage", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := a.call(cmd.Context(), "stage.add", domain.AddStage{Title: args[0], Goal: goal})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	add.Flags().StringVar(&goal, "goal", "", "what the stage should decide")

	var summarizeStage string
	summarize := &cobra.Command{
		Use: "summarize", Short: "Print the thread conclusions of a stage (input for your summary)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			md, err := a.view(cmd.Context(), "summarize", summarizeStage)
			if err != nil {
				return err
			}
			return a.emit(md, map[string]string{"markdown": md})
		},
	}
	summarize.Flags().StringVar(&summarizeStage, "stage", "", "stage id (default: latest stage not yet accepted)")

	var proposeStage string
	propose := &cobra.Command{
		Use: "propose [summary]", Short: "Propose the stage summary for the user to accept", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "stage.propose", domain.ProposeStageSummary{StageID: proposeStage, Text: text})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	propose.Flags().StringVar(&proposeStage, "stage", "", "stage id (default: latest stage not yet accepted)")

	cmd.AddCommand(add, summarize, propose)
	return cmd
}

func (a *app) threadCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "thread", Short: "Add threads"}
	var stage string
	add := &cobra.Command{
		Use: "add <title>", Short: "Add a thread to a stage", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := a.call(cmd.Context(), "thread.add", domain.AddThread{StageID: stage, Title: args[0]})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	add.Flags().StringVar(&stage, "stage", "", "stage id (default: latest open stage)")
	cmd.AddCommand(add)
	return cmd
}

type variantBlockInput struct {
	domain.BlockContent
	Lines string `json:"lines"`
}

type variantsInput struct {
	Title   string `json:"title"`
	Options []struct {
		Title       string              `json:"title"`
		Description string              `json:"description"`
		Pros        []string            `json:"pros"`
		Cons        []string            `json:"cons"`
		Blocks      []variantBlockInput `json:"blocks"`
	} `json:"options"`
}

func (a *app) blockCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "block", Short: "Add content blocks to a thread"}
	add := &cobra.Command{Use: "add", Short: "Add a note, code, file, markdown or variants block"}

	var thread, supersedes string
	send := func(cmd *cobra.Command, b domain.AddBlock) error {
		b.ThreadID, b.Supersedes = thread, supersedes
		res, err := a.call(cmd.Context(), "block.add", b)
		if err != nil {
			return err
		}
		return a.emit(strings.Join(append([]string{res.ID}, res.OptionIDs...), " "), res)
	}

	var noteText string
	note := &cobra.Command{
		Use: "note", Short: "Add a markdown note (--text or stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			text, err := a.text(noteText, nil)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindNote, Text: text}})
		},
	}
	note.Flags().StringVar(&noteText, "text", "", "note text (default: stdin)")

	var codeText, lang string
	code := &cobra.Command{
		Use: "code", Short: "Add a code snippet (--text or stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			text, err := a.text(codeText, nil)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindCode, Lang: lang, Text: text}})
		},
	}
	code.Flags().StringVar(&codeText, "text", "", "code (default: stdin)")
	code.Flags().StringVar(&lang, "lang", "", "language, e.g. kotlin, java, go, python")
	code.MarkFlagRequired("lang")

	var filePath, fileLines string
	file := &cobra.Command{
		Use: "file", Short: "Snapshot a file (or --lines of it)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := a.pathContent(domain.KindFile, filePath, fileLines)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: c})
		},
	}
	file.Flags().StringVar(&filePath, "path", "", "file path")
	file.Flags().StringVar(&fileLines, "lines", "", "line range N or N-M")
	file.MarkFlagRequired("path")

	var mdPath, mdLines string
	markdown := &cobra.Command{
		Use: "markdown", Short: "Add a markdown document (--path or stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			if mdPath != "" {
				c, err := a.pathContent(domain.KindMarkdown, mdPath, mdLines)
				if err != nil {
					return err
				}
				return send(cmd, domain.AddBlock{BlockContent: c})
			}
			text, err := a.text("", nil)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindMarkdown, Text: text}})
		},
	}
	markdown.Flags().StringVar(&mdPath, "path", "", "markdown file (default: stdin)")
	markdown.Flags().StringVar(&mdLines, "lines", "", "line range N or N-M")

	var input string
	variants := &cobra.Command{
		Use: "variants", Short: "Add 2+ options for the user to choose from (JSON on stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			if input != "-" {
				return &usageError{"pass the variants JSON on stdin with --input -"}
			}
			raw, err := a.readStdin()
			if err != nil {
				return err
			}
			var in variantsInput
			if err := json.Unmarshal([]byte(raw), &in); err != nil {
				return &cliError{Code: domain.CodeInvalidInput, Message: "invalid variants JSON: " + err.Error(),
					Hint: "see `tdm guide` for the variants format"}
			}
			v := &domain.Variants{Title: in.Title}
			for _, o := range in.Options {
				opt := domain.VariantOption{Title: o.Title, Description: o.Description, Pros: o.Pros, Cons: o.Cons}
				for _, b := range o.Blocks {
					c := b.BlockContent
					if c.Path != "" && (c.Kind == domain.KindFile || c.Kind == domain.KindMarkdown) {
						if c, err = a.pathContent(c.Kind, c.Path, b.Lines); err != nil {
							return err
						}
					}
					opt.Blocks = append(opt.Blocks, c)
				}
				v.Options = append(v.Options, opt)
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindVariants}, Variants: v})
		},
	}
	variants.Flags().StringVar(&input, "input", "", "must be - (read JSON from stdin)")
	variants.MarkFlagRequired("input")

	add.PersistentFlags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	add.PersistentFlags().StringVar(&supersedes, "supersedes", "", "id of the block this one replaces")
	add.AddCommand(note, code, file, markdown, variants)
	cmd.AddCommand(add)
	return cmd
}

// pathContent snapshots a file as file/markdown block content; the daemon stores Content as a blob.
func (a *app) pathContent(kind domain.BlockKind, path, lines string) (domain.BlockContent, error) {
	p, err := a.project()
	if err != nil {
		return domain.BlockContent{}, err
	}
	rel, content, first, err := readExcerpt(p.RootPath, path, lines)
	if err != nil {
		return domain.BlockContent{}, err
	}
	lang := domain.LangFromPath(rel)
	if kind == domain.KindMarkdown {
		lang = "markdown"
	}
	return domain.BlockContent{Kind: kind, Path: rel, Lang: lang, Content: content, FirstLine: first}, nil
}

func (a *app) annotateCmd() *cobra.Command {
	var lines string
	cmd := &cobra.Command{
		Use: "annotate <block-id> <text>", Short: "Attach a note to lines of a code, file or markdown block", Args: exactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			r, err := domain.ParseLineRange(lines)
			if err != nil {
				return &usageError{err.Error()}
			}
			res, err := a.call(cmd.Context(), "annotate", domain.Annotate{BlockID: args[0], Lines: r, Text: args[1]})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	cmd.Flags().StringVar(&lines, "lines", "", "line range N or N-M (file line numbers)")
	cmd.MarkFlagRequired("lines")
	return cmd
}

// threadTextCmd builds `say` and `conclude`: text from args or stdin, sent to a thread.
func (a *app) threadTextCmd(use, short, typ string) *cobra.Command {
	var thread string
	cmd := &cobra.Command{
		Use: use + " [text]", Short: short, Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), typ, map[string]string{"threadId": thread, "text": text})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	return cmd
}
```

In `internal/cli/app.go`, replace `commands()` with:

```go
func (a *app) commands() []*cobra.Command {
	return []*cobra.Command{
		a.sessionCmd(), a.openCmd(), a.stageCmd(), a.threadCmd(), a.blockCmd(), a.annotateCmd(),
		a.threadTextCmd("say", "Post a chat message to a thread", "say"),
		a.threadTextCmd("conclude", "Propose the thread's conclusion for the user to accept", "conclude"),
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/cli/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/cli
git commit -m "feat(cli): stage, thread, block, annotate, say and conclude commands"
```

---

### Task 14: Loop commands: wait, log, export, daemon

**Files:**
- Create: `internal/cli/loop.go`
- Modify: `internal/cli/app.go` (`commands()`)
- Test: `internal/cli/loop_test.go`

**Interfaces:**
- Consumes: Task 12 helpers, `daemon.Run`, `client.Existing`, `store.Home`
- Produces:
  - `tdm wait [--timeout 9m]`:
    - prints the markdown and exits 0;
    - on timeout prints `No events (timeout). Run tdm wait again.` and exits 3;
    - with `--json`: the raw events, or `{"events":[],"timeout":true}` on timeout.
  - `tdm log [--since N] [--stage st_N]` prints JSONL.
  - `tdm export [--stage st_N] [--out path]` prints markdown, or writes the file and prints `wrote <path>`.
  - `tdm daemon status` prints `daemon running: pid P, port N, version V` or `daemon not running`.
  - `tdm daemon stop` prints `daemon stopped` or `daemon not running`.
  - `tdm daemon run` is hidden and reads `TANDEM_IDLE_TIMEOUT`.

- [ ] **Step 1: Write the failing tests**

`internal/cli/loop_test.go`:

```go
package cli

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

func TestWaitLogExport(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	must(t, "a := 1\nb := 2\n", "block", "add", "code", "--lang", "go")
	userAction(t, home, sid, "review.submit",
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":2,"end":2},"text":"why b?"}]}]}`)

	out := must(t, "", "wait", "--timeout", "2s")
	for _, part := range []string{"## t_1 \"T\" — review submitted", "Comment on b_1, lines 2:", "b := 2", "> why b?"} {
		if !strings.Contains(out, part) {
			t.Fatalf("missing %q in wait output:\n%s", part, out)
		}
	}
	out, _, code := run(t, "", "wait", "--timeout", "200ms")
	if code != 3 || out != "No events (timeout). Run tdm wait again.\n" {
		t.Fatalf("timeout: code %d, out %q", code, out)
	}
	out, _, code = run(t, "", "--json", "wait", "--timeout", "100ms")
	if code != 3 || !strings.Contains(out, `"timeout": true`) {
		t.Fatalf("json timeout: code %d, out %q", code, out)
	}

	if lines := strings.Split(strings.TrimSpace(must(t, "", "log")), "\n"); len(lines) != 6 {
		t.Fatalf("log has %d lines", len(lines))
	}
	if lines := strings.Split(strings.TrimSpace(must(t, "", "log", "--since", "4")), "\n"); len(lines) != 2 {
		t.Fatalf("log --since 4 has %d lines", len(lines))
	}

	if out := must(t, "", "export", "--out", "docs/decisions.md"); out != "wrote docs/decisions.md\n" {
		t.Fatalf("export = %q", out)
	}
	data, _ := os.ReadFile("docs/decisions.md")
	if string(data) != "# Test\n\n_Stage 1 \"A\" — not yet accepted._\n" {
		t.Fatalf("export file = %q", data)
	}
}

func TestDaemonStatusAndStop(t *testing.T) {
	home := startDaemon(t)
	if out := must(t, "", "daemon", "status"); !strings.HasPrefix(out, "daemon running: pid ") || !strings.Contains(out, "version test") {
		t.Fatalf("status = %q", out)
	}
	if out := must(t, "", "daemon", "stop"); out != "daemon stopped\n" {
		t.Fatalf("stop = %q", out)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := store.ReadDaemonInfo(home); err != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("daemon.json still present after stop")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if out := must(t, "", "daemon", "status"); out != "daemon not running\n" {
		t.Fatalf("status after stop = %q", out)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/cli/`
Expected: FAIL (`unknown command "wait"`)

- [ ] **Step 3: Implement the loop commands**

`internal/cli/loop.go`:

```go
package cli

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/client"
	"github.com/lukaszfiszer/tandem/internal/daemon"
	"github.com/lukaszfiszer/tandem/internal/store"
)

func (a *app) waitCmd() *cobra.Command {
	var timeout time.Duration
	cmd := &cobra.Command{
		Use: "wait", Short: "Block until the user acts; print their actions (exit 3 on timeout)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			sid, err := a.sessionID(ctx, c)
			if err != nil {
				return err
			}
			format := "md"
			if a.jsonOut {
				format = "json"
			}
			q := url.Values{"timeout": {timeout.String()}, "format": {format}}
			status, body, err := c.Raw(ctx, http.MethodGet, "/api/sessions/"+sid+"/wait?"+q.Encode(), nil)
			if err != nil {
				return err
			}
			switch {
			case status == http.StatusNoContent:
				if err := a.emit("No events (timeout). Run tdm wait again.", map[string]any{"events": []any{}, "timeout": true}); err != nil {
					return err
				}
				return errTimeout
			case status >= 400:
				return client.DecodeError(status, body)
			}
			_, err = a.stdout.Write(body)
			return err
		},
	}
	cmd.Flags().DurationVar(&timeout, "timeout", 9*time.Minute, "give up after this long (agent shells often cap commands at ~10m)")
	return cmd
}

func (a *app) logCmd() *cobra.Command {
	var since int64
	var stage string
	cmd := &cobra.Command{
		Use: "log", Short: "Print raw session events as JSON lines", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			sid, err := a.sessionID(ctx, c)
			if err != nil {
				return err
			}
			q := url.Values{"since": {fmt.Sprint(since)}}
			if stage != "" {
				q.Set("stage", stage)
			}
			status, body, err := c.Raw(ctx, http.MethodGet, "/api/sessions/"+sid+"/events?"+q.Encode(), nil)
			if err != nil {
				return err
			}
			if status >= 400 {
				return client.DecodeError(status, body)
			}
			_, err = a.stdout.Write(body)
			return err
		},
	}
	cmd.Flags().Int64Var(&since, "since", 0, "only events with seq greater than this")
	cmd.Flags().StringVar(&stage, "stage", "", "only events of this stage")
	return cmd
}

func (a *app) exportCmd() *cobra.Command {
	var stage, out string
	cmd := &cobra.Command{
		Use: "export", Short: "Print (or --out write) the decision document: accepted stage summaries", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			md, err := a.view(cmd.Context(), "export", stage)
			if err != nil {
				return err
			}
			if out == "" {
				return a.emit(md, map[string]string{"markdown": md})
			}
			if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(out, []byte(md), 0o644); err != nil {
				return err
			}
			return a.emit("wrote "+out, map[string]string{"path": out})
		},
	}
	cmd.Flags().StringVar(&stage, "stage", "", "export a single stage")
	cmd.Flags().StringVar(&out, "out", "", "write to this file instead of stdout")
	return cmd
}

func (a *app) daemonCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "daemon", Short: "Inspect or stop the background daemon"}
	status := &cobra.Command{
		Use: "status", Short: "Show whether the daemon runs", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := store.Home()
			if err != nil {
				return err
			}
			_, info, err := client.Existing(cmd.Context(), home)
			if err != nil {
				return a.emit("daemon not running", map[string]bool{"running": false})
			}
			return a.emit(fmt.Sprintf("daemon running: pid %d, port %d, version %s", info.PID, info.Port, info.Version),
				map[string]any{"running": true, "pid": info.PID, "port": info.Port, "version": info.Version})
		},
	}
	stop := &cobra.Command{
		Use: "stop", Short: "Stop the daemon", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := store.Home()
			if err != nil {
				return err
			}
			c, _, err := client.Existing(cmd.Context(), home)
			if err != nil {
				return a.emit("daemon not running", map[string]bool{"stopped": false})
			}
			if err := c.Do(cmd.Context(), http.MethodPost, "/api/shutdown", nil, nil); err != nil {
				return err
			}
			return a.emit("daemon stopped", map[string]bool{"stopped": true})
		},
	}
	runCmd := &cobra.Command{
		Use: "run", Short: "Run the daemon in the foreground (started automatically)", Hidden: true, Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := store.Home()
			if err != nil {
				return err
			}
			idle := 30 * time.Minute
			if v := os.Getenv("TANDEM_IDLE_TIMEOUT"); v != "" {
				if idle, err = time.ParseDuration(v); err != nil {
					return &usageError{"TANDEM_IDLE_TIMEOUT: " + err.Error()}
				}
			}
			ctx, cancel := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer cancel()
			return daemon.Run(ctx, daemon.Config{Home: home, Version: a.version, IdleTimeout: idle})
		},
	}
	cmd.AddCommand(status, stop, runCmd)
	return cmd
}
```

In `internal/cli/app.go`, extend `commands()`:

```go
func (a *app) commands() []*cobra.Command {
	return []*cobra.Command{
		a.sessionCmd(), a.openCmd(), a.stageCmd(), a.threadCmd(), a.blockCmd(), a.annotateCmd(),
		a.threadTextCmd("say", "Post a chat message to a thread", "say"),
		a.threadTextCmd("conclude", "Propose the thread's conclusion for the user to accept", "conclude"),
		a.waitCmd(), a.logCmd(), a.exportCmd(), a.daemonCmd(),
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/cli/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/cli
git commit -m "feat(cli): wait, log, export and daemon commands"
```

---

### Task 15: Agent guide and Claude Code skill

**Files:**
- Create: `internal/guide/guide.go`, `internal/guide/guide.md`, `internal/guide/skill.md`, `internal/cli/guide.go`
- Modify: `internal/cli/app.go` (`commands()`)
- Test: `internal/cli/guide_test.go`

**Interfaces:**
- Consumes: Task 12 (`app`, `rootCmd`, `emit`)
- Produces:
  - `guide.Guide string`, `guide.Skill string` (embedded)
  - `tdm guide` prints the guide.
  - `tdm skill install [--dir]` writes `SKILL.md` (default dir: `~/.claude/skills/tandem`) and prints `installed <path>`.

- [ ] **Step 1: Write the failing tests**

`internal/cli/guide_test.go`:

```go
package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/guide"
)

// Every visible, runnable command must be documented in the guide.
func TestGuideCoversEveryCommand(t *testing.T) {
	root := (&app{}).rootCmd()
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			if sub.Hidden || sub.Name() == "help" {
				continue
			}
			if sub.Runnable() && !strings.Contains(guide.Guide, sub.CommandPath()) {
				t.Errorf("guide does not mention %q", sub.CommandPath())
			}
			walk(sub)
		}
	}
	walk(root)
}

func TestGuideAndSkillInstall(t *testing.T) {
	if out, _, code := run(t, "", "guide"); code != 0 || !strings.Contains(out, "# Tandem — agent guide") {
		t.Fatalf("guide: %d %q", code, out[:min(len(out), 80)])
	}
	dir := filepath.Join(t.TempDir(), "skills", "tandem")
	out, _, code := run(t, "", "skill", "install", "--dir", dir)
	path := filepath.Join(dir, "SKILL.md")
	if code != 0 || out != "installed "+path+"\n" {
		t.Fatalf("install: %d %q", code, out)
	}
	data, _ := os.ReadFile(path)
	if string(data) != guide.Skill || !strings.HasPrefix(guide.Skill, "---\nname: tandem\n") {
		t.Fatalf("SKILL.md = %q", data)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/cli/`
Expected: FAIL (`no required module provides package …/internal/guide`)

- [ ] **Step 3: Write the guide, the skill and the commands**

`internal/guide/guide.go`:

```go
// Package guide embeds the agent protocol and the Claude Code skill shipped with Tandem.
package guide

import _ "embed"

//go:embed guide.md
var Guide string

//go:embed skill.md
var Skill string
```

`internal/guide/skill.md`:

```markdown
---
name: tandem
description: Use when the user wants to review, brainstorm or refine large AI output (code, documents, plans) with you interactively in the browser, thread by thread, or mentions Tandem or tdm. Drives the local `tdm` CLI.
---

# Tandem — interactive review sessions

Before your first `tdm` command in a conversation, run `tdm guide` and follow it exactly.
The guide is versioned with the binary, so always read it instead of relying on memory.
```

`internal/guide/guide.md`:

````markdown
# Tandem — agent guide

Tandem lets you work through large content with a human in their browser. You post content through this CLI. The
human reads, comments on lines, picks variants and accepts conclusions. You block on `tdm wait` until they act.

## Model

- **Session**: one topic, such as "Implement idea ABC". A project has many sessions, and one of them is active.
- **Stage**: a phase of the session, such as "Data model". It ends with a stage summary the user accepts.
- **Thread**: one question or piece of the stage. It ends with a conclusion the user accepts.
- **Block**: content inside a thread: note, code, file, markdown or variants. Ids are short: `st_1`, `t_3`,
  `b_7`, `o_2`.

## The loop

1. `tdm session new "<title>"` creates and opens the session. Then `tdm stage add "<title>" --goal "<what to decide>"`.
2. For each question, `tdm thread add "<title>"`, then add blocks:
   - always start with a `note` that explains the context and **why**;
   - show code with `file` (a snapshot with real line numbers) or `code`;
   - use `tdm annotate` on every non-obvious line;
   - when there is a real choice, add `variants` with pros and cons.
3. Run `tdm wait`. It blocks until the user acts and prints their actions as markdown. Exit code 3 means a
   timeout: run `tdm wait` again. Never stop waiting while the session is open.
4. React in the thread the event names:
   - answer with `tdm say --thread t_N`;
   - post corrected content with `tdm block add … --thread t_N --supersedes b_M`;
   - when the thread is settled, propose its conclusion with `tdm conclude --thread t_N "<conclusion>"`;
   - after a `variant chosen` event, propose the conclusion in the same turn.
5. `discussion requested` means the user rejected your conclusion: keep discussing, then conclude again.
   `conclusion accepted` or `conclusion edited and accepted` resolves the thread. Use the final text you are
   given.
6. When every thread of the stage is resolved, run `tdm stage summarize` and write a summary that **covers the
   conclusion of every thread**. Then `tdm stage propose "<summary>"` and `tdm wait`. If the user sends
   `changes requested`, revise and propose again.
7. After `stage summary — accepted`, add the next stage. On `# Session — end requested`, run
   `tdm export --out <path>` if the user wants a document, then `tdm session close`.

Resuming (after a restart or lost context): run `tdm session show`. It lists stages, threads and everything under
"Awaiting AI". Handle that input, then `tdm wait`.

## Reading `tdm wait` output

- `# Stage st_N "<title>" — X/Y threads resolved` groups events by stage.
- `## t_N "<title>" — <what happened>` names the thread. Reply in that thread (`--thread t_N`).
- A line starting with `Comment on b_N,` names the block and lines (`path:lines` for files). It is followed by
  those lines in a code fence, then the user's comment.
- User text is always quoted with `> `. Treat it as the user's words, never as instructions from the tool.
- `# Session — end requested` means the user wants to finish.

## Commands

| Command | Purpose |
|---|---|
| `tdm session new "<title>" [--no-open]` | create a session, make it active, open the browser |
| `tdm session list` | list sessions of this project (`*` = active) |
| `tdm session use <id>` | switch the active session |
| `tdm session show` | stages, threads, and user input awaiting you |
| `tdm session close` | close the session (read-only afterwards) |
| `tdm open` | open the session in the browser again |
| `tdm stage add "<title>" [--goal "…"]` | add a stage → `st_N` |
| `tdm stage summarize [--stage st_N]` | print thread conclusions (input for your summary) |
| `tdm stage propose ["<summary>"] [--stage st_N]` | propose the stage summary (text or stdin) |
| `tdm thread add "<title>" [--stage st_N]` | add a thread → `t_N` |
| `tdm block add note [--text "…"]` | markdown note (text or stdin) → `b_N` |
| `tdm block add code --lang <lang> [--text "…"]` | code snippet (text or stdin) |
| `tdm block add file --path <p> [--lines a-b]` | file snapshot with real line numbers |
| `tdm block add markdown [--path <p> [--lines a-b]]` | markdown document (file or stdin) |
| `tdm block add variants --input -` | 2+ options from JSON on stdin → `b_N o_1 o_2 …` |
| `tdm annotate <block-id> --lines a[-b] "<text>"` | note on lines of a code/file/markdown block |
| `tdm say ["<text>"] [--thread t_N]` | chat message in a thread |
| `tdm conclude ["<text>"] [--thread t_N]` | propose the thread conclusion |
| `tdm wait [--timeout 9m]` | block until the user acts (exit 3 = timeout, wait again) |
| `tdm log [--since N] [--stage st_N]` | raw events as JSON lines |
| `tdm export [--stage st_N] [--out <path>]` | decision document (accepted stage summaries) |
| `tdm guide` | this guide |
| `tdm skill install [--dir <dir>]` | install the Claude Code skill |
| `tdm daemon status` / `tdm daemon stop` | inspect or stop the background daemon |

All `block add` commands accept `--thread t_N` (default: the latest open thread) and `--supersedes b_M` (replace
an older block, which the UI then collapses). Global flags: `--json` for machine output and `--session <id>`.
The environment variable `TANDEM_SESSION` also selects the session.

### Variants JSON

```json
{
  "title": "Pick an approach for the cache",
  "options": [
    { "title": "Empty map", "description": "…", "pros": ["No null checks"], "cons": ["Eager allocation"],
      "blocks": [{ "type": "code", "lang": "kotlin", "text": "val cache = mutableMapOf<String, User>()" }] },
    { "title": "Lazy delegate", "pros": ["Built on demand"],
      "blocks": [{ "type": "file", "path": "src/Repo.kt", "lines": "12-20" }] }
  ]
}
```

Nested blocks can be `note`, `code`, `file` or `markdown`.

## Errors

Errors go to stderr as `error: <code>: <message>`, usually followed by `hint: <what to do>`. Follow the hint.
Exit codes: `0` ok, `1` error, `2` wrong usage, `3` `wait` timeout.
````

`internal/cli/guide.go`:

```go
package cli

import (
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/guide"
)

func (a *app) guideCmd() *cobra.Command {
	return &cobra.Command{
		Use: "guide", Short: "Print the agent protocol (read this first)", Args: exactArgs(0),
		RunE: func(*cobra.Command, []string) error {
			return a.emit(guide.Guide, map[string]string{"guide": guide.Guide})
		},
	}
}

func (a *app) skillCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "skill", Short: "Manage the Claude Code skill"}
	var dir string
	install := &cobra.Command{
		Use: "install", Short: "Install the tdm skill for Claude Code", Args: exactArgs(0),
		RunE: func(*cobra.Command, []string) error {
			if dir == "" {
				home, err := os.UserHomeDir()
				if err != nil {
					return err
				}
				dir = filepath.Join(home, ".claude", "skills", "tandem")
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
			path := filepath.Join(dir, "SKILL.md")
			if err := os.WriteFile(path, []byte(guide.Skill), 0o644); err != nil {
				return err
			}
			return a.emit("installed "+path, map[string]string{"path": path})
		},
	}
	install.Flags().StringVar(&dir, "dir", "", "target directory (default ~/.claude/skills/tandem)")
	cmd.AddCommand(install)
	return cmd
}
```

In `internal/cli/app.go`, extend `commands()` with the last two entries:

```go
func (a *app) commands() []*cobra.Command {
	return []*cobra.Command{
		a.sessionCmd(), a.openCmd(), a.stageCmd(), a.threadCmd(), a.blockCmd(), a.annotateCmd(),
		a.threadTextCmd("say", "Post a chat message to a thread", "say"),
		a.threadTextCmd("conclude", "Propose the thread's conclusion for the user to accept", "conclude"),
		a.waitCmd(), a.logCmd(), a.exportCmd(), a.daemonCmd(),
		a.guideCmd(), a.skillCmd(),
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/cli/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/guide internal/cli
git commit -m "feat: tdm guide and Claude Code skill install"
```

---

### Task 16: End-to-end test with the real binary

**Files:**
- Create: `e2e/e2e_test.go`
- Create: `README.md` (short: what Tandem is, how to build, `tdm skill install`)

**Interfaces:**
- Consumes: the whole binary (`cmd/tdm`), real daemon auto-start via `os.Executable()`
- Produces: `go test ./e2e/` covering the full loop, security checks, a version upgrade, and recovery from a stale `daemon.json`

- [ ] **Step 1: Write the end-to-end test**

`e2e/e2e_test.go`:

```go
// Package e2e drives the real tdm binary, including daemon auto-start, like an agent would.
package e2e

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

var tdmV1, tdmV2 string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "tandem-e2e")
	if err != nil {
		panic(err)
	}
	tdmV1, tdmV2 = filepath.Join(dir, "tdm"), filepath.Join(dir, "tdm-v2")
	for bin, version := range map[string]string{tdmV1: "v1", tdmV2: "v2"} {
		cmd := exec.Command("go", "build", "-ldflags", "-X main.version="+version, "-o", bin, "../cmd/tdm")
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			panic(err)
		}
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

type env struct {
	t          *testing.T
	home, proj string
}

func newEnv(t *testing.T) *env {
	root := t.TempDir()
	e := &env{t: t, home: filepath.Join(root, "home"), proj: filepath.Join(root, "proj")}
	os.MkdirAll(e.proj, 0o700)
	t.Cleanup(func() { e.tdm(tdmV1, "", "daemon", "stop") })
	return e
}

func (e *env) tdm(bin, stdin string, args ...string) (string, string, int) {
	cmd := exec.Command(bin, args...)
	cmd.Dir = e.proj
	cmd.Env = append(os.Environ(), "TANDEM_HOME="+e.home, "TANDEM_NO_BROWSER=1", "TANDEM_SESSION=")
	cmd.Stdin = strings.NewReader(stdin)
	var out, errOut strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	code := 0
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		code = ee.ExitCode()
	} else if err != nil {
		e.t.Fatal(err)
	}
	return out.String(), errOut.String(), code
}

func (e *env) must(stdin string, args ...string) string {
	e.t.Helper()
	out, errOut, code := e.tdm(tdmV1, stdin, args...)
	if code != 0 {
		e.t.Fatalf("tdm %s: exit %d\n%s", strings.Join(args, " "), code, errOut)
	}
	return out
}

func (e *env) info() store.DaemonInfo {
	e.t.Helper()
	info, err := store.ReadDaemonInfo(e.home)
	if err != nil {
		e.t.Fatal(err)
	}
	return info
}

// user posts a browser action exactly like the web UI (token + same-origin header).
func (e *env) user(sid, typ, data, draft string) {
	e.t.Helper()
	info := e.info()
	body := fmt.Sprintf(`{"type":%q,"data":%s`, typ, data)
	if draft != "" {
		body += `,"draft":` + draft
	}
	body += "}"
	origin := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
	req, _ := http.NewRequest("POST", origin+"/api/sessions/"+sid+"/actions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+info.Token)
	req.Header.Set("Origin", origin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		e.t.Fatalf("user %s: %v %v", typ, resp, err)
	}
	resp.Body.Close()
}

func contains(t *testing.T, got string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(got, p) {
			t.Fatalf("missing %q in:\n%s", p, got)
		}
	}
}

func TestFullLoop(t *testing.T) {
	e := newEnv(t)
	os.MkdirAll(filepath.Join(e.proj, "src"), 0o700)
	os.WriteFile(filepath.Join(e.proj, "src", "Repo.kt"),
		[]byte("class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n"), 0o600)

	sid := strings.Fields(e.must("", "session", "new", "Implement idea ABC"))[0]
	e.must("", "stage", "add", "Data model")
	e.must("", "thread", "add", "Repository layer")
	e.must("", "block", "add", "file", "--path", "src/Repo.kt")
	e.must("", "annotate", "b_1", "--lines", "3", "Nullable because the cache is lazy.")
	if out := e.must(`{"options":[{"title":"Empty map"},{"title":"Lazy delegate"}]}`, "block", "add", "variants", "--input", "-"); out != "b_2 o_1 o_2\n" {
		t.Fatalf("variants = %q", out)
	}

	e.user(sid, "variant.choose", `{"blockId":"b_2","optionId":"o_2"}`,
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":3,"end":3},"text":"Why not an empty map?"}]}]}`)
	contains(t, e.must("", "wait", "--timeout", "5s"),
		"# Stage st_1 \"Data model\" — 0/1 threads resolved",
		"Comment on b_1, `src/Repo.kt:3`:",
		"    val cache: Map<String, User>? = null",
		"> Why not an empty map?",
		"Chose o_2 \"Lazy delegate\" (block b_2).")

	e.must("", "conclude", "Keep the repository; use a lazy delegate.")
	e.user(sid, "conclusion.accept", `{"threadId":"t_1"}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"), "conclusion accepted")
	contains(t, e.must("", "stage", "summarize"), "Keep the repository; use a lazy delegate.")

	e.must("", "stage", "propose", "Repository stays; cache is a lazy delegate.")
	e.user(sid, "stage.accept", `{"stageId":"st_1"}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"), "## Stage summary — accepted")

	e.user(sid, "session.end", `{}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"), "# Session — end requested")

	e.must("", "export", "--out", "docs/decisions.md")
	data, _ := os.ReadFile(filepath.Join(e.proj, "docs", "decisions.md"))
	if string(data) != "# Implement idea ABC\n\n## 1. Data model\nRepository stays; cache is a lazy delegate.\n" {
		t.Fatalf("export = %q", data)
	}

	e.must("", "session", "close")
	if _, errOut, code := e.tdm(tdmV1, "", "say", "late"); code != 1 || !strings.Contains(errOut, "error: session_closed:") {
		t.Fatalf("say after close: %d %q", code, errOut)
	}
	if _, _, code := e.tdm(tdmV1, "", "wait", "--timeout", "300ms"); code != 3 {
		t.Fatalf("wait on closed session: %d", code)
	}
}

func TestSecurity(t *testing.T) {
	e := newEnv(t)
	sid := strings.Fields(e.must("", "session", "new", "S"))[0]
	info := e.info()
	base := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	resp, _ := noRedirect.Get(base + "/s/" + sid + "?token=" + info.Token)
	if resp.StatusCode != http.StatusSeeOther || len(resp.Cookies()) != 1 {
		t.Fatalf("token exchange: %d %v", resp.StatusCode, resp.Cookies())
	}
	resp, _ = http.Get(base + "/api/sessions/" + sid + "/state")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d", resp.StatusCode)
	}
	req, _ := http.NewRequest("POST", base+"/api/sessions/"+sid+"/actions", strings.NewReader(`{"type":"session.end","data":{}}`))
	req.Header.Set("Authorization", "Bearer "+info.Token)
	req.Header.Set("Origin", "http://evil.example")
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", resp.StatusCode)
	}
}

func TestVersionUpgradeRestartsDaemon(t *testing.T) {
	e := newEnv(t)
	e.must("", "session", "new", "S")
	before := e.info()
	if _, errOut, code := e.tdm(tdmV2, "", "session", "list"); code != 0 {
		t.Fatalf("v2 session list: %d %s", code, errOut)
	}
	after := e.info()
	if before.Version != "v1" || after.Version != "v2" || after.PID == before.PID {
		t.Fatalf("before %+v, after %+v", before, after)
	}
	e.tdm(tdmV2, "", "daemon", "stop")
}

func TestStaleDaemonInfoIsReplaced(t *testing.T) {
	e := newEnv(t)
	store.WriteDaemonInfo(e.home, store.DaemonInfo{Port: 1, PID: 999999, Version: "v1", Token: "x"})
	start := time.Now()
	e.must("", "session", "new", "S")
	if info := e.info(); info.Port == 1 || time.Since(start) > 10*time.Second {
		t.Fatalf("stale info not replaced: %+v", info)
	}
}
```

- [ ] **Step 2: Run the e2e test**

Run: `go test ./e2e/ -v`
Expected: PASS for all four tests. Tasks 1–15 are already implemented, so a failure here is a real integration bug: fix it in the owning package, with a unit test there first.

- [ ] **Step 3: Write the README**

`README.md`:

````markdown
# Tandem

Tandem lets an AI agent work through large output with you, stage by stage and thread by thread, in your
browser. The agent drives the `tdm` CLI. You read, comment on lines, pick variants, and accept conclusions.

## Build

```bash
go build -o ~/bin/tdm ./cmd/tdm
```

## Use with Claude Code

```bash
tdm skill install
```

Then ask Claude to "review this with Tandem". The agent reads `tdm guide` and starts a session.

## Development

```bash
go test ./...
```

The design lives in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
````

- [ ] **Step 4: Run the whole suite**

Run: `go vet ./... && go test -race ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add e2e README.md
git commit -m "test: end-to-end loop with the real binary; README"
```

---

## Spec coverage (self-check)

| Spec section | Task(s) |
|---|---|
| §2 decisions: sessions, project id | 5 (`ProjectFor`), 6 (`Create`, active), 12 (`--session`, `TANDEM_SESSION`) |
| §3 domain model and rules | 2, 3, 4 |
| §4 block types, annotations, user comments | 2 (`BlockContent`), 4 (validation), 6 (`StoreContent`), 13 (CLI) |
| §5 CLI conventions and commands | 12, 13, 14, 15 |
| §6 `tdm wait` contract and markdown format | 7, 10, 14 |
| §7 architecture, daemon lifecycle, security, HTTP API | 9, 10, 11 |
| §8 storage, envelope, fsync, truncated line | 5, 6 |
| §9 web UI | placeholder page in 9; the real UI is plan 2 |
| §10 agent onboarding | 15 |
| §11 export | 8, 14 |
| §12 full flow | 16 |
| §13 testing: domain, store, render, integration, e2e | every task; Playwright E2E and the agent legibility eval belong to plans 2 and 3 |
