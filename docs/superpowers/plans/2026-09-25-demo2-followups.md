# Demo 2 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven follow-ups from the second Tandem demo session:
1. the Resolve note editor scrolls fully into view when it opens;
2. unsent composer text and an unsent Resolve note are kept per thread;
3. the composer's Send works with draft comments alone;
4. `t_N` / `st_N` in agent text shows as a titled chip;
5. "waiting for the stage summary" animates like the typing bubble;
6. a new stage summary is shown from its start;
7. a proposed stage summary can be edited and accepted.

**Architecture:** Go first (#7). `stage.accept` gains an optional `text`, and the existing `stage.summary.accepted` payload gains an `omitempty` `original`, set only when the user changed the text. That mirrors `conclusion.edited {original, text}`, which is how thread "Edit" is modelled today. The reducer already uses the payload's `text` as the stage summary, so `tdm export` needs no change. `tdm wait` renders an event with `original` as `stage summary — edited and accepted` and quotes the final text. Old logs replay unchanged, and the snapshot JSON does not change.

The web UI then adds the stage summary's Edit mode (#7) and reuses `TypingBubble` for the waiting-for-summary state (#5). `useFollowBottom` gains an optional landing target, so a new proposed summary is scrolled to its start (#6). The composer enables Send on draft comments alone (#3). A small `draft/threadText.ts` module keeps composer text and Resolve notes in `localStorage` (#2). `ResolveThread` scrolls its editor into view with a shared `scrollFullyIntoView` helper (#1). One pure tokenizer, `splitIds`, feeds both a markdown-it `text` rule (for `Prose`) and an `AgentText` React component (for plain-text agent strings). Chips are `<a href="#t_N">` links, so a click goes through the existing hash routing (`useCurrentItem`) (#4).

**Tech Stack:** Go 1.x (stdlib, `encoding/json`), React 19 + TypeScript + Vite, markdown-it 15, Vitest + Testing Library, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-25-demo2-followups.md` (committed as e455d8e). Conventions: `docs/superpowers/plans/2026-09-25-followups-comments-resolve.md` (the previous plan), `docs/superpowers/specs/2026-09-25-tandem-design.md`.

## Global Constraints

- Module path: `github.com/lukaszfiszer/tandem`. Go tests: `go test ./...` from the repo root. Web tests: `cd web && npm test`. Web typecheck: `cd web && npm run typecheck`.
- No new dependencies (Go or npm).
- No new event types. `stage.summary.accepted` gains `original` (`omitempty`, set only when the user changed the text). The `stage.accept` action gains `text?` (`omitempty`). Old `events.jsonl` logs must replay unchanged, and a plain accept must still marshal to the old shape `{"stageId","text"}`. The snapshot JSON does not change, so `web/src/test/fixtures/snapshot.json` is not regenerated. If `go test ./internal/daemon -run TestSnapshotContractFixture` ever fails, regenerate with `-update` and commit the fixture.
- UI copy, verbatim:
  - Proposed stage summary buttons: `Accept summary`, `Edit`, `Request changes`. Edit editor: label `Edit summary`, submit `Accept edited`, `Cancel` (same words as the conclusion's Edit, except the label).
  - `tdm wait` for an edited summary: header `## Stage summary — edited and accepted`, then `Final summary:` and the text quoted with `> `. A plain accept keeps `## Stage summary — accepted` / `Accepted as proposed.`
  - Waiting for the summary: `All threads resolved — waiting for the AI's stage summary.` (unchanged text). It is static while the agent is in `tdm wait` and on a read-only session. Otherwise it gets the typing dots. When quiet: `All threads resolved — waiting for the AI's stage summary. AI quiet for <N>m, it may have stopped`.
  - Id chip: the item's title as the link text, `title="id: t_N"` (or `id: st_N`), `href="#t_N"`, class `id-chip`.
- Re-proposal while editing: if the proposed summary text changes (the AI re-proposes) while the stage summary Edit editor is open, the editor closes and the new proposal is shown (Task 3 pins this with a test), so an accept never records a stale `original`.
- Id syntax: `\b(?:st|t)_\d+\b` (a whole word). Only ids that exist in the session state become chips. Ids inside backtick code spans, code blocks, and link text stay as written. Markdown **documents** (`MarkdownBlock`, rendered through `splitSections`) get no chips. Only agent prose rendered by `Prose`, and the plain-text agent strings listed in Task 7, get chips.
- `localStorage` keys: `tdm:composer:<sid>:<threadId>` and `tdm:note:<sid>:<threadId>`. Every access is wrapped in `try/catch`, and a blank value removes the key. An entry is cleared by a successful send (composer), by a successful Resolve (note), or by Cancel (note).
- Motion: every new automatic scroll (#1, #6) uses `prefersReducedMotion()` from `web/src/shell/motion.ts`: `behavior: 'auto'` under reduced motion, `'smooth'` otherwise, like `showSentComments` (commit 6cf8c3e). The stage bubble reuses `.typing-dot`, whose animation is already switched off under `prefers-reduced-motion` in `app.css`.
- `internal/daemon/webdist/` is rebuilt and committed **only in Task 8**. Earlier UI tasks do not commit it. If a build touched it, discard with `git checkout internal/daemon/webdist`.
- Commit messages use conventional style (`feat(web): …`, `feat(domain): …`, `build(web): …`) and carry **no** `Co-Authored-By` or other co-author trailer.
- Run the tasks in order. Shared files:
  - `web/src/stage/StageView.tsx` and `web/src/stage/StageView.test.tsx`: Tasks 3, 4, 7;
  - `web/src/styles/app.css`: Tasks 4, 7;
  - `web/src/thread/Composer.tsx` and `Composer.test.tsx`: Tasks 5, 6;
  - `web/src/thread/ThreadView.test.tsx`: Tasks 6, 7;
  - `docs/superpowers/specs/2026-09-25-tandem-design.md`: Tasks 2, 6.

## Review Focus

1. **Unsent text when storage fails or the thread changes.** `localStorage` can throw (private mode, blocked site data, quota). Typing must keep working in memory, and nothing may throw. Switching threads mid-draft must restore each thread's own composer text and note. A saved note reopens the editor without stealing focus or scroll. Pinned in Task 6 (`threadText.test.ts`, the ThreadView switching and restore tests).
2. **Ids that are not ids.** `st_1x`, `xt_1`, `t_1_2`, `t_12` (unknown), `b_1`, an id in `` `code` ``, in a fenced block, in link text or a URL: all stay plain text. `t_1` next to punctuation or inside `**bold**` becomes a chip. Titles are HTML-escaped. Pinned in Task 7 (`ids.test.ts`, `markdown.test.ts`).
3. **An "edited" summary that equals the proposal.** Unchanged text (after trimming) or a blank text is a plain accept: no `original`, and `tdm wait` says `accepted`, not `edited and accepted`. A changed text is stored trimmed and is what `tdm export` writes. Pinned in Task 2.
4. **Old logs.** A `stage.summary.accepted` line written before this change has no `original`. It must replay to the same accepted summary, and a plain accept must marshal byte-for-byte to that old shape. Pinned in Task 2 (`TestOldStageSummaryAcceptedReplays`).
5. **Composer with whitespace and comments.** Whitespace-only text plus draft comments sends only the comments (`sendReview(undefined)`) and clears the whitespace. No text and no comments keeps Send disabled. A pending send still blocks a second one. Pinned in Task 5.

---

### Task 1: Commit this plan

**Files:**
- Add: `docs/superpowers/plans/2026-09-25-demo2-followups.md` (this file; the spec is already committed as e455d8e)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Commit the plan**

```bash
git add docs/superpowers/plans/2026-09-25-demo2-followups.md
git commit -m "docs: demo2 follow-ups implementation plan"
```

---

### Task 2: Domain, `tdm wait`, export and guide: accept an edited stage summary (#7, Go side)

Today `AcceptStageSummary` has only `StageID`, and `decide.go` always accepts `st.ProposedSummary`. Thread Edit is modelled as `conclusion.edited {threadId, original, text}`. For the stage we keep the single `stage.summary.accepted` event and add `original` to it, set only when the text changed. The reducer already stores `p.Text` as `Stage.Summary`, which `render.Export` prints, so the reducer and export need no code change, only tests.

**Files:**
- Modify: `internal/domain/commands.go` (`AcceptStageSummary.Text`)
- Modify: `internal/domain/events.go` (`StageSummaryAccepted.Original`)
- Modify: `internal/domain/decide.go` (the `*AcceptStageSummary` case)
- Modify: `internal/render/wait.go` (the `EvStageSummaryAccepted` case)
- Modify: `internal/guide/guide.md` (step 7, the id paragraph)
- Modify: `docs/superpowers/specs/2026-09-25-tandem-design.md` (user event table)
- Test: `internal/domain/decide_test.go`, `internal/domain/lifecycle_test.go`, `internal/render/wait_test.go`, `internal/render/views_test.go`, `internal/guide/guide_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `domain.AcceptStageSummary{StageID string "stageId"; Text string "text,omitempty"}`, the user action `stage.accept {stageId, text?}`;
  - `domain.StageSummaryAccepted{StageID "stageId"; Text "text"; Original "original,omitempty"}`. `Original` is the proposal when the user changed it. `Text` is the final (trimmed) text;
  - `tdm wait` block: `## Stage summary — edited and accepted\n\nFinal summary:\n> <text>\n`.

- [ ] **Step 1: Write the failing domain tests**

Append to `internal/domain/decide_test.go`:

```go
// Demo2 follow-up 7: Edit on a proposed stage summary accepts the user's text. The event keeps the
// proposal as Original, so the agent reads "stage summary — edited and accepted". Review Focus 3:
// a text equal to the proposal (after trimming) or a blank text is a plain accept.
func TestAcceptEditedStageSummary(t *testing.T) {
	cases := []struct{ name, text, want, original string }{
		{"edited", "Keep the log; blobs by hash.", "Keep the log; blobs by hash.", "Keep the log."},
		{"edited, trimmed", "  Keep the log; blobs by hash.\n", "Keep the log; blobs by hash.", "Keep the log."},
		{"same as proposed", "Keep the log.\n", "Keep the log.", ""},
		{"blank", "  ", "Keep the log.", ""},
		{"no text", "", "Keep the log.", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, events := domaintest.Build(t, stage, thread, conclude, accept,
				&ProposeStageSummary{Text: "Keep the log."},
				&AcceptStageSummary{StageID: "st_1", Text: tc.text})
			st := s.Stage("st_1")
			if st.Status != StageAccepted || st.Summary != tc.want || st.ProposedSummary != "" {
				t.Fatalf("stage = %+v", st)
			}
			last := events[len(events)-1]
			var p StageSummaryAccepted
			if last.Type != EvStageSummaryAccepted || last.Actor != ActorUser || last.Decode(&p) != nil || p.Text != tc.want || p.Original != tc.original {
				t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
			}
		})
	}
}
```

In `TestDecodeCommand` (same file), before the final `thread.resolve` agent check, add:

```go
	cmd, err = DecodeCommand(ActorUser, "stage.accept", json.RawMessage(`{"stageId":"st_1","text":"edited"}`))
	if err != nil || *cmd.(*AcceptStageSummary) != (AcceptStageSummary{StageID: "st_1", Text: "edited"}) {
		t.Fatalf("stage.accept = %#v, %v", cmd, err)
	}
```

Append to `internal/domain/lifecycle_test.go` (`encoding/json` is already imported):

```go
// Demo2 follow-up 7, Review Focus 4: a stage.summary.accepted line written before summaries could be
// edited has no "original". It replays as before, and a plain accept still marshals to that exact
// shape; an edited accept replays to the edited text.
func TestOldStageSummaryAcceptedReplays(t *testing.T) {
	old := Event{Actor: ActorUser, Type: EvStageSummaryAccepted, V: 1, Data: json.RawMessage(`{"stageId":"st_1","text":"sum"}`)}
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum"}),
		old,
	)
	st := replay(t, evs...).Stage("st_1")
	if st.Status != StageAccepted || st.Summary != "sum" || st.ProposedSummary != "" {
		t.Fatalf("old accept: %+v", st)
	}
	b, err := json.Marshal(StageSummaryAccepted{StageID: "st_1", Text: "sum"})
	if err != nil || string(b) != string(old.Data) {
		t.Fatalf("plain accept json = %s (%v), want %s", b, err, old.Data)
	}

	evs[len(evs)-1] = NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: "st_1", Text: "sum, edited", Original: "sum"})
	if st := replay(t, evs...).Stage("st_1"); st.Status != StageAccepted || st.Summary != "sum, edited" {
		t.Fatalf("edited accept: %+v", st)
	}
}
```

- [ ] **Step 2: Write the failing render tests**

Append to `internal/render/wait_test.go`:

```go
// Demo2 follow-up 7: an edited stage summary reaches the agent as "edited and accepted" with the
// final text quoted; accepting an unchanged text keeps the plain "accepted" output.
func TestWaitStageSummaryEdited(t *testing.T) {
	build := func(text string) string {
		st, events := domaintest.Build(t,
			&domain.AddStage{Title: "API"},
			&domain.AddThread{Title: "Endpoints"},
			&domain.ResolveThread{ThreadID: "t_1"},
			&domain.ProposeStageSummary{Text: "REST."},
			&domain.AcceptStageSummary{StageID: "st_1", Text: text},
		)
		got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	got := build("REST, versioned under /v1.")
	if want := "## Stage summary — edited and accepted\n\nFinal summary:\n> REST, versioned under /v1.\n"; !strings.Contains(got, want) || strings.Contains(got, "Accepted as proposed.") {
		t.Fatalf("missing %q in:\n%s", want, got)
	}
	got = build("REST.")
	if want := "## Stage summary — accepted\n\nAccepted as proposed.\n"; !strings.Contains(got, want) || strings.Contains(got, "edited and accepted\n\nFinal summary") {
		t.Fatalf("missing %q in:\n%s", want, got)
	}
}
```

(`## t_1 "Endpoints" — conclusion edited and accepted` from the Resolve is also in `got`, which is why the second check looks for the stage's `Final summary` form and not the bare phrase.)

Append to `internal/render/views_test.go`:

```go
// Demo2 follow-up 7: the decision document uses the user's edited stage summary.
func TestExportUsesEditedSummary(t *testing.T) {
	st, _ := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.ResolveThread{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "Keep the repository."},
		&domain.AcceptStageSummary{StageID: "st_1", Text: "Keep the repository; the cache is lazy."},
	)
	got, err := Export(st, "")
	if want := "# Test session\n\n## 1. Data model\nKeep the repository; the cache is lazy.\n"; err != nil || got != want {
		t.Fatalf("got %q, %v", got, err)
	}
}
```

Append to `internal/guide/guide_test.go`:

```go
// Demo2 follow-ups 4 and 7: the agent keeps writing short ids (the page shows titles), and it must
// recognise an edited stage summary and treat the quoted text as the summary tdm export writes.
func TestGuideCoversEditedStageSummaryAndIds(t *testing.T) {
	for _, s := range []string{"stage summary — edited and accepted", "is what `tdm export` writes", "chip with its title"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/domain/ ./internal/render/ ./internal/guide/`
Expected: compile FAIL, `unknown field Text in struct literal of type AcceptStageSummary` and `unknown field Original in struct literal of type StageSummaryAccepted`.

- [ ] **Step 4: Implement the command and the payload**

In `internal/domain/commands.go`, replace `AcceptStageSummary`:

```go
// AcceptStageSummary accepts the proposed stage summary. A Text that differs from the proposal
// (after trimming) is the user's edit (demo2 follow-up 7): it becomes the summary, and the agent
// reads "stage summary — edited and accepted". A blank or unchanged Text is a plain accept.
type AcceptStageSummary struct {
	StageID string `json:"stageId"`
	Text    string `json:"text,omitempty"`
}
```

In `internal/domain/events.go`, replace `StageSummaryAccepted`:

```go
// StageSummaryAccepted is the accepted stage summary. Original is the AI's proposal when the user
// edited it before accepting; it is empty for a plain accept, and in every log written before
// summaries could be edited, which therefore replay unchanged.
type StageSummaryAccepted struct {
	StageID  string `json:"stageId"`
	Text     string `json:"text"`
	Original string `json:"original,omitempty"`
}
```

In `internal/domain/decide.go`, replace the `case *AcceptStageSummary:` block:

```go
	case *AcceptStageSummary:
		st, err := s.proposedStage(c.StageID)
		if err != nil {
			return nil, Result{}, err
		}
		p := StageSummaryAccepted{StageID: st.ID, Text: st.ProposedSummary}
		// Mirrors conclusion.edited: an edit keeps the proposal as the original (Review Focus 3).
		if text := strings.TrimSpace(c.Text); text != "" && text != strings.TrimSpace(st.ProposedSummary) {
			p.Text, p.Original = text, st.ProposedSummary
		}
		return one(NewEvent(ActorUser, EvStageSummaryAccepted, p), st.ID)
```

- [ ] **Step 5: Render the edited accept in `tdm wait`**

In `internal/render/wait.go`, replace the `case domain.EvStageSummaryAccepted:` block:

```go
	case domain.EvStageSummaryAccepted:
		var p domain.StageSummaryAccepted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		if p.Original != "" {
			return []section{{p.StageID, "## Stage summary — edited and accepted\n\nFinal summary:\n" + Quote(p.Text)}}, nil
		}
		return []section{{p.StageID, "## Stage summary — accepted\n\nAccepted as proposed.\n"}}, nil
```

- [ ] **Step 6: Update the agent guide**

In `internal/guide/guide.md`, directly after the `## Model` bullet list (after the line `` `b_7`, `o_2`. ``) and before `## The loop`, insert:

```markdown

Mention threads and stages by id (`t_3`, `st_1`) in notes, messages, conclusions and summaries. The page shows
each one as a chip with its title and opens it on click, so short ids are all you need to write.
```

Replace step 7 of `## The loop`:

```markdown
7. After `stage summary — accepted` or `stage summary — edited and accepted`, add the next stage. An edited
   summary quotes the user's final text: that text, not your proposal, is the stage summary, and it is what
   `tdm export` writes. On `# Session — end requested`, run `tdm export --out <path>` if the user wants a
   document, then `tdm session close`.
```

In `docs/superpowers/specs/2026-09-25-tandem-design.md`, in the user event table, replace the row

```
| `stage.summary.accepted` | `text` |
```

with

```
| `stage.summary.accepted` | `text`, `original?` (set when the user edited the summary before accepting: "edited and accepted") |
```

- [ ] **Step 7: Run the Go tests**

Run: `gofmt -l internal; go test ./...`
Expected: `gofmt` lists no files. PASS, including `TestSnapshotContractFixture` (the snapshot JSON is unchanged: `Stage` has no new field) and `e2e/TestFullLoop` (its `stage.accept {"stageId":"st_1"}` is still a plain accept).

- [ ] **Step 8: Commit**

```bash
git add internal/domain internal/render internal/guide docs/superpowers/specs/2026-09-25-tandem-design.md
git commit -m "feat(domain): accept an edited stage summary

stage.accept takes an optional text; stage.summary.accepted keeps the
proposal as original when the text changed. tdm wait reports it as
\"stage summary — edited and accepted\" with the final text, and export
uses that text. Old logs replay unchanged."
```

---

### Task 3: Web: Edit a proposed stage summary (#7, UI side)

**Files:**
- Modify: `web/src/api/types.ts` (the `stage.accept` action)
- Modify: `web/src/stage/StageView.tsx` (Edit mode)
- Test: `web/src/stage/StageView.test.tsx`

**Interfaces:**
- Consumes: the action `stage.accept {stageId, text?}` (Task 2).
- Produces:
  - `Action` member `{ type: 'stage.accept'; data: { stageId: string; text?: string } }`;
  - `StageView` proposed-summary section with buttons `Accept summary`, `Edit`, `Request changes`, and the editor `Edit summary` / `Accept edited` / `Cancel`.

- [ ] **Step 1: Write the failing tests**

In `web/src/stage/StageView.test.tsx`, change the vitest import to `import { describe, expect, it, vi } from 'vitest'` and append inside `describe('StageView', …)`:

```tsx
  // Demo2 follow-up 7: Edit a proposed summary, then accept the edited text.
  it('edits a proposed summary and accepts the edited text', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit summary' })
    expect(box).toHaveValue('We keep a JSONL log.')
    expect(screen.queryByRole('button', { name: 'Accept summary' })).toBeNull()
    await user.clear(box)
    await user.type(box, 'We keep a JSONL log and content-addressed blobs.')
    await user.click(screen.getByRole('button', { name: 'Accept edited' }))
    expect(ctx.run).toHaveBeenLastCalledWith({
      type: 'stage.accept',
      data: { stageId: 'st_1', text: 'We keep a JSONL log and content-addressed blobs.' },
    })
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
  })

  it('keeps the editor open when accepting fails, and cancels back to the proposal', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, run: vi.fn(async () => false) })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Accept edited' }))
    expect(screen.getByRole('textbox', { name: 'Edit summary' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveTextContent('We keep a JSONL log.')
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
  })

  it('offers no summary actions on a read-only session', () => {
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, readOnly: true })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept summary' })).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/stage/StageView.test.tsx`
Expected: FAIL, no button named `Edit`.

- [ ] **Step 3: Implement**

In `web/src/api/types.ts`, change the `stage.accept` member of `Action` to:

```ts
  | { type: 'stage.accept'; data: { stageId: string; text?: string } }
```

In `web/src/stage/StageView.tsx`, add above `function StageBody`:

```tsx
// view: the proposed summary and its buttons; edit: the summary in an editor, accepted as edited
// (demo2 follow-up 7, like Edit on a proposed conclusion); changes: the "Request changes" editor.
type SummaryMode = 'view' | 'edit' | 'changes'
```

In `StageBody`, replace `const [changing, setChanging] = useState(false)` with:

```tsx
  const [mode, setMode] = useState<SummaryMode>('view')
```

Replace the whole `{stage.status === 'summary_proposed' && ( … )}` block with:

```tsx
      {stage.status === 'summary_proposed' && (
        <section className="conclusion" aria-label="Proposed stage summary">
          <div className="kicker">Proposed stage summary</div>
          {!readOnly && mode === 'edit' ? (
            <CommentEditor
              label="Edit summary"
              initial={stage.proposedSummary ?? ''}
              submitLabel="Accept edited"
              onSave={async (text) => {
                if (await run({ type: 'stage.accept', data: { stageId: stage.id, text } })) setMode('view')
              }}
              onCancel={() => setMode('view')}
            />
          ) : (
            <Prose text={stage.proposedSummary ?? ''} />
          )}
          {!readOnly && mode === 'changes' && (
            <CommentEditor
              label="What should change?"
              submitLabel="Request changes"
              onSave={async (comment) => {
                if (await run({ type: 'stage.request_changes', data: { stageId: stage.id, comment } })) setMode('view')
              }}
              onCancel={() => setMode('view')}
            />
          )}
          {!readOnly && mode === 'view' && (
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => void run({ type: 'stage.accept', data: { stageId: stage.id } })}>
                Accept summary
              </button>
              <button type="button" className="btn" onClick={() => setMode('edit')}>
                Edit
              </button>
              <button type="button" className="btn" onClick={() => setMode('changes')}>
                Request changes
              </button>
            </div>
          )}
        </section>
      )}
```

The daemon decides whether the text is an edit (Task 2). The UI always sends the editor's (trimmed) text.

- [ ] **Step 4: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. The existing `accepts a proposed summary or requests changes` and `resets the request-changes editor…` tests still pass: `Request changes` still opens the `What should change?` editor, and `StageBody` is still keyed on `stageId`.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/stage/StageView.tsx web/src/stage/StageView.test.tsx
git commit -m "feat(web): edit a proposed stage summary and accept it"
```

---

### Task 4: Web: animated wait for the stage summary (#5) and landing on a new summary (#6)

**Files:**
- Modify: `web/src/thread/delivery.ts` (add `stageAwaitsSummary`)
- Modify: `web/src/thread/TypingBubble.tsx` (optional `label` and `text`)
- Modify: `web/src/stage/StageView.tsx` (the bubble; `data-land` on the proposed summary)
- Modify: `web/src/shell/useFollowBottom.ts` (optional `landOn`)
- Modify: `web/src/shell/SessionPage.tsx` (pass `landOn`)
- Modify: `web/src/styles/app.css` (`.typing-bubble.has-text`, `.stage .typing-bubble`)
- Test: `web/src/thread/delivery.test.ts`, `web/src/stage/StageView.test.tsx`, `web/src/shell/useFollowBottom.test.tsx`, `web/src/shell/SessionPage.followBottom.test.tsx`

**Interfaces:**
- Consumes: `SessionCtx.waiting`, `SessionCtx.quietMinutes`, `prefersReducedMotion()`.
- Produces:
  - `stageAwaitsSummary(stage: Stage, threads: Thread[]): boolean`;
  - `TypingBubble({ quietMinutes, label, text }: { quietMinutes?: number | null; label?: string; text?: string })`. `label` defaults to `'AI is replying'`. With `text`, the text is visible before the dots;
  - `useFollowBottom(containerRef, contentKey, landOn?: () => HTMLElement | null): FollowBottom`;
  - the proposed-summary section carries `data-land="proposed-summary"`.

- [ ] **Step 1: Write the failing unit tests**

In `web/src/thread/delivery.test.ts`, change the imports to:

```ts
import type { Stage, Thread } from '../api/types'
import { deliveryStatus, isReplying, stageAwaitsSummary, threadIsReplying } from './delivery'
```

and append:

```ts
describe('stageAwaitsSummary (demo2 follow-up 5)', () => {
  const stage: Stage = { id: 'st_1', title: 'Data model', status: 'open', threadIds: ['t_1', 't_2'] }
  const resolved: Thread = { ...thread, status: 'resolved' }

  it('is true while an open stage has every thread resolved', () => {
    expect(stageAwaitsSummary(stage, [resolved, { ...resolved, id: 't_2' }])).toBe(true)
  })

  it('is false with an unresolved thread, no threads, or a summary proposed or accepted', () => {
    expect(stageAwaitsSummary(stage, [resolved, thread])).toBe(false)
    expect(stageAwaitsSummary({ ...stage, threadIds: [] }, [])).toBe(false)
    expect(stageAwaitsSummary({ ...stage, status: 'summary_proposed' }, [resolved])).toBe(false)
    expect(stageAwaitsSummary({ ...stage, status: 'accepted' }, [resolved])).toBe(false)
  })
})
```

In `web/src/shell/useFollowBottom.test.tsx`, append at the end of the file:

```tsx
describe('useFollowBottom landOn (demo2 follow-up 6)', () => {
  function setupLanding(el: HTMLElement, contentKey: string, target: { current: HTMLElement | null }) {
    const ref = { current: el as HTMLElement | null }
    return renderHook(({ key }) => useFollowBottom(ref, key, () => target.current), { initialProps: { key: contentKey } })
  }
  function summary() {
    const s = document.createElement('section')
    s.scrollIntoView = vi.fn()
    return s
  }

  it('scrolls to the start of the landing target instead of the bottom', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 }) // near the bottom
    const target = { current: null as HTMLElement | null }
    const { result, rerender } = setupLanding(el, 'st_1:', target)
    target.current = summary()
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 'st_1:We keep a log.' })
    expect(target.current.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(false)
  })

  it('lands even when scrolled up, and jumps under prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    try {
      const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from the bottom
      const target = { current: null as HTMLElement | null }
      const { result, rerender } = setupLanding(el, 'st_1:', target)
      target.current = summary()
      rerender({ key: 'st_1:We keep a log.' })
      expect(target.current.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
      expect(result.current.showPill).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('follows the bottom as before when there is no landing target', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 })
    const { rerender } = setupLanding(el, 'st_1:', { current: null })
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 'st_1:' + 'x' })
    expect(el.scrollTo).toHaveBeenCalled()
  })

  it('does not land on an item switch', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    const target = { current: summary() }
    const { rerender } = setupLanding(el, 't_1:1:', target)
    rerender({ key: 'st_1:We keep a log.' })
    expect(target.current.scrollIntoView).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write the failing component tests**

In `web/src/stage/StageView.test.tsx`, add `import type { SessionCtx } from '../session/context'` and append a new top-level `describe`:

```tsx
describe('StageView waiting for the stage summary (demo2 follow-up 5)', () => {
  const PENDING = "All threads resolved — waiting for the AI's stage summary."
  function allResolved(over: Partial<SessionCtx> = {}) {
    const base = makeCtx(over)
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    return base
  }

  it('animates like the typing bubble while the AI works on it', () => {
    const { container } = renderStateful(<StageView stageId="st_1" />, allResolved())
    expect(screen.getByRole('status', { name: PENDING })).toHaveTextContent(PENDING)
    // The same .typing-dot elements as the thread's bubble, so the same reduced-motion rule applies.
    expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
  })

  it('stays still while the agent is idle in tdm wait, and on a read-only session', () => {
    const first = renderStateful(<StageView stageId="st_1" />, allResolved({ waiting: true }))
    expect(screen.getByText(PENDING)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(first.container.querySelector('.typing-dot')).toBeNull()
    first.unmount()

    const second = renderStateful(<StageView stageId="st_1" />, allResolved({ readOnly: true }))
    expect(screen.getByText(PENDING)).toBeInTheDocument()
    expect(second.container.querySelector('.typing-dot')).toBeNull()
  })

  it('says the AI went quiet after 10 minutes, without animation', () => {
    const { container } = renderStateful(<StageView stageId="st_1" />, allResolved({ quietMinutes: 12 }))
    expect(screen.getByRole('status')).toHaveTextContent(`${PENDING} AI quiet for 12m, it may have stopped`)
    expect(container.querySelector('.typing-dot')).toBeNull()
  })

  it('marks the proposed summary as the landing target (demo2 follow-up 6)', () => {
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveAttribute('data-land', 'proposed-summary')
  })
})
```

In `web/src/shell/SessionPage.followBottom.test.tsx`, append:

```tsx
describe('SessionPage lands on a new stage summary (demo2 follow-up 6)', () => {
  function withStage(over: Record<string, unknown>) {
    const next = structuredClone(fixture) as typeof fixture
    Object.assign(next.state.stages[0], over)
    return next
  }

  it('scrolls to the start of a proposed (and re-proposed) summary, not to the bottom', () => {
    const scrolled: { el: Element; arg: unknown }[] = []
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg })
    }
    try {
      window.location.hash = '#st_1'
      render(<SessionPage sid="s_fixture" />)
      load()
      const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 }) // near the bottom
      load(withStage({ status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }))
      const first = screen.getByRole('region', { name: 'Proposed stage summary' })
      expect(scrolled).toEqual([{ el: first, arg: { block: 'start', behavior: 'smooth' } }])
      expect(main.scrollTo).not.toHaveBeenCalled()

      load(withStage({ status: 'open' })) // changes requested
      load(withStage({ status: 'summary_proposed', proposedSummary: 'We keep a JSONL log and blobs.' }))
      const second = screen.getByRole('region', { name: 'Proposed stage summary' })
      expect(scrolled.at(-1)).toEqual({ el: second, arg: { block: 'start', behavior: 'smooth' } })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/delivery.test.ts src/stage/StageView.test.tsx src/shell/useFollowBottom.test.tsx src/shell/SessionPage.followBottom.test.tsx`
Expected: FAIL. `stageAwaitsSummary` is not exported, there is no `status` role on the stage, `scrollIntoView` is not called, and `data-land` is missing.

- [ ] **Step 4: Implement `stageAwaitsSummary` and the bubble's text**

In `web/src/thread/delivery.ts`, change the import to `import type { Stage, Thread } from '../api/types'` and append:

```ts
// stageAwaitsSummary is true while an open stage has every thread resolved: the next move is the
// AI's stage summary, after the last thread was resolved or after "Request changes" (demo2
// follow-up 5). StageView shows the typing bubble for it under threadIsReplying's rules: never
// while the agent is blocked in `tdm wait` (it is idle, not writing), and the quiet state after
// AGENT_QUIET_MS (SessionCtx.quietMinutes).
export function stageAwaitsSummary(stage: Stage, threads: Thread[]): boolean {
  return stage.status === 'open' && threads.length > 0 && threads.every((t) => t.status === 'resolved')
}
```

Replace `web/src/thread/TypingBubble.tsx`:

```tsx
// TypingBubble is the AI-side placeholder shown at the end of a thread's timeline while the AI
// is replying (round 3 #6): three dots that animate in sequence, static under
// prefers-reduced-motion (handled purely in CSS, see .typing-bubble in app.css). `role="status"`
// does not take its accessible name from its content (unlike, say, a button), so aria-label
// still supplies the name — but a visually hidden span with the same text is also present as the
// live region's actual content, since some assistive tech announces a live region's content on
// update rather than (or in addition to) its label (review round 3, Minor). The dots themselves
// stay decorative.
// With quietMinutes set, the agent has gone silent and the bubble says so in words instead (feature review t_6).
// `label` names the status (default "AI is replying"). With `text`, that text is shown before the
// dots instead of being visually hidden (the stage's "waiting for the summary", demo2 follow-up 5).
export function TypingBubble({
  quietMinutes = null,
  label = 'AI is replying',
  text,
}: {
  quietMinutes?: number | null
  label?: string
  text?: string
}) {
  if (quietMinutes !== null) {
    const quiet = `AI quiet for ${quietMinutes}m, it may have stopped`
    const full = text ? `${text} ${quiet}` : quiet
    return (
      <div className="typing-bubble is-quiet" role="status" aria-label={full}>
        {full}
      </div>
    )
  }
  return (
    <div className={text ? 'typing-bubble has-text' : 'typing-bubble'} role="status" aria-label={label}>
      {text ? <span className="typing-text">{text}</span> : <span className="visually-hidden">{label}</span>}
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
    </div>
  )
}
```

In `web/src/styles/app.css`, after the line `.typing-bubble.is-quiet { font: 0.8125rem var(--font-ui); color: var(--muted); }`, add:

```css
.typing-bubble.has-text { gap: 6px; font: 0.8125rem var(--font-ui); color: var(--muted); }
.typing-bubble.has-text .typing-text { margin-right: 4px; }
.stage .typing-bubble { width: fit-content; margin-top: 16px; }
```

- [ ] **Step 5: Use it in StageView and mark the landing target**

In `web/src/stage/StageView.tsx`:
- add `import { stageAwaitsSummary } from '../thread/delivery'` and `import { TypingBubble } from '../thread/TypingBubble'`;
- add below the imports:

```tsx
const SUMMARY_PENDING = "All threads resolved — waiting for the AI's stage summary."
```

- in `StageBody`, change the context line to `const { run, readOnly, waiting, quietMinutes } = useSessionCtx()`, and replace `const allResolved = threads.length > 0 && resolved === threads.length` with `const awaitsSummary = stageAwaitsSummary(stage, threads)`;
- change `<section className="conclusion" aria-label="Proposed stage summary">` to `<section className="conclusion" aria-label="Proposed stage summary" data-land="proposed-summary">`;
- replace the whole `{stage.status === 'open' && ( … )}` block with:

```tsx
      {stage.status === 'open' &&
        (awaitsSummary ? (
          // Demo2 follow-up 5: the typing bubble's rules. Still while the agent sits in tdm wait
          // (or the session is closed), the quiet state after 10 minutes of silence.
          readOnly || waiting ? (
            <p className="muted">{SUMMARY_PENDING}</p>
          ) : (
            <TypingBubble quietMinutes={quietMinutes} label={SUMMARY_PENDING} text={SUMMARY_PENDING} />
          )
        ) : (
          <p className="muted">
            The AI proposes a stage summary once every thread is resolved ({resolved}/{threads.length}).
          </p>
        ))}
```

- [ ] **Step 6: Land on the summary in useFollowBottom**

In `web/src/shell/useFollowBottom.ts`:
- change the signature to:

```ts
export function useFollowBottom(
  containerRef: RefObject<HTMLElement | null>,
  contentKey: string,
  landOn?: () => HTMLElement | null,
): FollowBottom {
```

- add this line to the comment above the function: `// landOn, when it returns an element for a same-item change, is scrolled to its start instead (demo2 follow-up 6).`;
- below `const armed = useRef(false)` add:

```ts
  // Read at effect time, so callers may pass a fresh closure on every render.
  const landOnRef = useRef(landOn)
  landOnRef.current = landOn
```

- in the content-key effect, directly before `if (armed.current || (wasNearBottom.current && !isBlockingFocus())) scrollToBottom()`, insert:

```ts
    // Demo2 follow-up 6: content that must be read from its start (a newly proposed stage
    // summary) lands on that start instead of following the bottom, wherever the user was.
    const target = landOnRef.current?.() ?? null
    if (target) {
      armed.current = false
      setShowPill(false)
      if (typeof target.scrollIntoView === 'function')
        target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      return
    }
```

In `web/src/shell/SessionPage.tsx`, replace `const follow = useFollowBottom(mainRef, contentKey)` with:

```tsx
  // Demo2 follow-up 6: a (re-)proposed stage summary is read from its start. The stage's content
  // key changes only with its summary text, so this fires on a new proposal, not on accepting.
  const landOn = useCallback(() => mainRef.current?.querySelector<HTMLElement>('[data-land="proposed-summary"]') ?? null, [])
  const follow = useFollowBottom(mainRef, contentKey, landOn)
```

(`useCallback` is already imported.)

- [ ] **Step 7: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. The ThreadView typing-bubble tests (`AI is replying`, `AI quiet for 12m, it may have stopped`) are unchanged: the defaults keep the old markup. `scale.test.ts` accepts the rem font sizes.

- [ ] **Step 8: Commit**

```bash
git add web/src/thread/delivery.ts web/src/thread/delivery.test.ts web/src/thread/TypingBubble.tsx web/src/stage web/src/shell/useFollowBottom.ts web/src/shell/useFollowBottom.test.tsx web/src/shell/SessionPage.tsx web/src/shell/SessionPage.followBottom.test.tsx web/src/styles/app.css
git commit -m "feat(web): animate the wait for a stage summary; land on the top of a new summary"
```

---

### Task 5: Web: Send with only draft comments (#3)

`Composer.tsx` renders Send with `disabled={sending || !text.trim()}`, so draft comments alone cannot be sent with the button. ⌘↵ already can (M7). Button and ⌘↵ now share one `submit`.

**Files:**
- Modify: `web/src/thread/Composer.tsx`
- Test: `web/src/thread/Composer.test.tsx`

**Interfaces:**
- Consumes: `SessionCtx.sendReview(extra?)`, `countDraft`.
- Produces: `Composer({ thread, onSent })`, same signature. Send is enabled when `!sending && (text.trim() !== '' || pending > 0)`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('Composer', …)` in `web/src/thread/Composer.test.tsx`:

```tsx
  // Demo2 follow-up 3: draft comments alone enable Send, and it sends only them.
  it('enables Send with draft comments and an empty box, and sends the draft alone', async () => {
    const user = userEvent.setup()
    const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const { ctx } = renderStateful(<Composer thread={thread} />, { draft })
    const send = screen.getByRole('button', { name: 'Send (1 comment)' })
    expect(send).toBeEnabled()
    await user.click(send)
    expect(ctx.sendReview).toHaveBeenCalledWith(undefined)
  })

  // Review Focus 5: whitespace is not a message; it is cleared along with the sent draft.
  it('sends only the comments when the box holds whitespace, and clears it', async () => {
    const user = userEvent.setup()
    const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const { ctx } = renderStateful(<Composer thread={thread} />, { draft })
    const box = screen.getByRole('textbox', { name: 'Reply' })
    await user.type(box, '   ')
    await user.click(screen.getByRole('button', { name: 'Send (1 comment)' }))
    expect(ctx.sendReview).toHaveBeenCalledWith(undefined)
    await vi.waitFor(() => expect(box).toHaveValue(''))
  })

  it('keeps Send disabled with neither text nor comments', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<Composer thread={thread} />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '  ')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(ctx.sendReview).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/thread/Composer.test.tsx`
Expected: FAIL. `Send (1 comment)` is disabled with an empty box.

- [ ] **Step 3: Implement**

Replace `web/src/thread/Composer.tsx`:

```tsx
import { useRef, useState } from 'react'
import type { Thread } from '../api/types'
import { countDraft } from '../draft/draft'
import { useSessionCtx } from '../session/context'
import { modKeyLabel } from './platform'

export function Composer({ thread, onSent }: { thread: Thread; onSent?: () => void }) {
  const { sendReview, readOnly, draft } = useSessionCtx()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Read inside the pending send's `.then` (not `text` from the closure) so a same-message
  // success clears the box, but an edit made while the send was in flight survives (M7).
  const textRef = useRef(text)
  textRef.current = text
  if (readOnly || thread.status === 'resolved') return null
  const pending = countDraft(draft)
  // Every draft comment goes out with the message (sendReview sends the whole draft).
  const sendLabel = pending ? `Send (${pending} comment${pending > 1 ? 's' : ''})` : 'Send'
  const send = async (extra?: { threadId: string; message: string }) => {
    if (sending) return
    const sentText = textRef.current
    setSending(true)
    try {
      if (await sendReview(extra)) {
        if (textRef.current === sentText) setText('')
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
    const message = text.trim()
    void send(message ? { threadId: thread.id, message } : undefined)
  }
  return (
    <div className="composer">
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

- [ ] **Step 4: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS, including the existing `disables Send and ignores the mod-key shortcut while a send is pending` and `clears the text on success only if it is unchanged…`.

- [ ] **Step 5: Commit**

```bash
git add web/src/thread/Composer.tsx web/src/thread/Composer.test.tsx
git commit -m "fix(web): enable the composer's Send for draft comments without text"
```

---

### Task 6: Web: keep unsent text per thread (#2), and scroll the Resolve note editor into view (#1)

Both change `ResolveThread`. The ROADMAP backlog item "Keep composer text per thread" is done here.

**Files:**
- Create: `web/src/draft/threadText.ts`, `web/src/draft/threadText.test.ts`
- Modify: `web/src/thread/Composer.tsx` (text from `useThreadText`)
- Modify: `web/src/thread/ResolveThread.tsx` (kept note, editor states, scroll into view)
- Modify: `web/src/blocks/CommentEditor.tsx` (`autoFocus`, `onChange` props)
- Modify: `web/src/shell/motion.ts` (add `scrollFullyIntoView`)
- Modify: `docs/ROADMAP.md`, `docs/superpowers/specs/2026-09-25-tandem-design.md`
- Test: `web/src/thread/Composer.test.tsx`, `web/src/thread/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `SessionCtx.sid`, `prefersReducedMotion()`, `RESOLVE_NOTE_EVENT`.
- Produces:
  - `type ThreadTextKind = 'composer' | 'note'`;
  - `loadThreadText(kind: ThreadTextKind, sid: string, threadId: string): string`;
  - `saveThreadText(kind: ThreadTextKind, sid: string, threadId: string, text: string): void`. A blank text removes the key;
  - `useThreadText(kind: ThreadTextKind, sid: string, threadId: string): [string, (text: string) => void]`;
  - `scrollFullyIntoView(el: Element): void`, which is `scrollIntoView({ block: 'nearest', behavior })` and a no-op when `scrollIntoView` is missing;
  - `CommentEditor` props gain `autoFocus?: boolean` (default `true`) and `onChange?(text: string): void`;
  - `ResolveThread({ thread, onResolved })`, same signature.

- [ ] **Step 1: Write the failing storage tests**

Create `web/src/draft/threadText.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { loadThreadText, saveThreadText, useThreadText } from './threadText'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('thread text (demo2 follow-up 2)', () => {
  it('keeps composer text and the Resolve note per session and thread', () => {
    saveThreadText('composer', 's_a', 't_1', 'reply 1')
    saveThreadText('note', 's_a', 't_1', 'note 1')
    saveThreadText('composer', 's_a', 't_2', 'reply 2')
    expect(loadThreadText('composer', 's_a', 't_1')).toBe('reply 1')
    expect(loadThreadText('note', 's_a', 't_1')).toBe('note 1')
    expect(loadThreadText('composer', 's_a', 't_2')).toBe('reply 2')
    expect(loadThreadText('composer', 's_b', 't_1')).toBe('')
    expect(loadThreadText('note', 's_a', 't_2')).toBe('')
    expect(localStorage.getItem('tdm:composer:s_a:t_1')).toBe('reply 1')
    expect(localStorage.getItem('tdm:note:s_a:t_1')).toBe('note 1')
  })

  it('removes the entry when the text is cleared or blank', () => {
    saveThreadText('composer', 's_a', 't_1', 'reply')
    saveThreadText('composer', 's_a', 't_1', '  \n')
    expect(localStorage.getItem('tdm:composer:s_a:t_1')).toBeNull()
    saveThreadText('note', 's_a', 't_1', 'note')
    saveThreadText('note', 's_a', 't_1', '')
    expect(localStorage.getItem('tdm:note:s_a:t_1')).toBeNull()
  })

  it('restores the text after a remount (a reload)', () => {
    const first = renderHook(() => useThreadText('composer', 's_a', 't_1'))
    act(() => first.result.current[1]('half a thought'))
    first.unmount()
    const second = renderHook(() => useThreadText('composer', 's_a', 't_1'))
    expect(second.result.current[0]).toBe('half a thought')
  })

  // Review Focus 1: storage that throws (private mode, blocked site data, quota) never breaks typing.
  it('falls back to memory when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadThreadText('composer', 's_a', 't_1')).toBe('')
    expect(() => saveThreadText('composer', 's_a', 't_1', 'x')).not.toThrow()
    expect(() => saveThreadText('composer', 's_a', 't_1', '')).not.toThrow()
    const { result } = renderHook(() => useThreadText('composer', 's_a', 't_1'))
    act(() => result.current[1]('still here'))
    expect(result.current[0]).toBe('still here')
  })
})
```

- [ ] **Step 2: Write the failing component tests**

In `web/src/thread/Composer.test.tsx`, add `import { loadThreadText } from '../draft/threadText'` and append inside `describe('Composer', …)`:

```tsx
  // Demo2 follow-up 2: unsent text survives a remount (thread switch or reload) and is dropped once sent.
  it('keeps unsent text across a remount and forgets it after sending', async () => {
    const user = userEvent.setup()
    const first = renderStateful(<Composer thread={thread} />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'half a thought')
    first.unmount()
    renderStateful(<Composer thread={thread} />)
    const box = screen.getByRole('textbox', { name: 'Reply' })
    expect(box).toHaveValue('half a thought')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => expect(box).toHaveValue(''))
    expect(loadThreadText('composer', 's_fixture', 't_1')).toBe('')
  })
```

In `web/src/thread/ThreadView.test.tsx`, add `import { loadThreadText, saveThreadText } from '../draft/threadText'` and append two new top-level `describe` blocks:

```tsx
describe('ThreadView keeps unsent text per thread (demo2 follow-up 2)', () => {
  // Review Focus 1: switching threads mid-draft restores each thread's own text.
  it('restores the composer text and the Resolve note of each thread after switching', async () => {
    const user = userEvent.setup()
    const { rerender } = renderStateful(<ThreadView threadId="t_1" />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'reply on t_1')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'note on t_1')

    rerender(<ThreadView threadId="t_3" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'reply on t_3')

    rerender(<ThreadView threadId="t_1" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('reply on t_1')
    expect(screen.getByRole('textbox', { name: 'Conclusion (optional)' })).toHaveValue('note on t_1')

    rerender(<ThreadView threadId="t_3" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('reply on t_3')
  })

  it('forgets the note once Resolve succeeds', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_1" />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Keep it.')
    expect(loadThreadText('note', 's_fixture', 't_1')).toBe('Keep it.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1', text: 'Keep it.' } })
    expect(loadThreadText('note', 's_fixture', 't_1')).toBe('')
  })

  it('keeps the note when Resolve fails, and forgets it on Cancel', async () => {
    const user = userEvent.setup()
    renderWithCtx(<ThreadView threadId="t_3" />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Docs later.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(loadThreadText('note', 's_fixture', 't_3')).toBe('Docs later.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(loadThreadText('note', 's_fixture', 't_3')).toBe('')
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
  })
})

describe('ThreadView reveals the Resolve note editor (demo2 follow-up 1)', () => {
  // jsdom has no scrollIntoView: record the element and the options it was called with.
  const scrolled: { el: Element; arg: unknown }[] = []
  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg })
    }
  })
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.unstubAllGlobals()
  })

  it('scrolls the whole editor into view when Add note opens it', async () => {
    const user = userEvent.setup()
    renderStateful(<ThreadView threadId="t_1" />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    const editor = screen.getByRole('region', { name: 'Resolve thread' })
    expect(scrolled.find((s) => s.el === editor)?.arg).toEqual({ block: 'nearest', behavior: 'smooth' })
    expect(screen.getByRole('textbox', { name: 'Conclusion (optional)' })).toHaveFocus()
  })

  it('jumps without animation under reduced motion, also when c opens it', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    renderStateful(<ThreadView threadId="t_1" />)
    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_1' } }))
    })
    const editor = screen.getByRole('region', { name: 'Resolve thread' })
    expect(scrolled.find((s) => s.el === editor)?.arg).toEqual({ block: 'nearest', behavior: 'auto' })
  })

  it('reopens a saved note without scrolling or taking focus', () => {
    saveThreadText('note', 's_fixture', 't_1', 'half a note')
    renderStateful(<ThreadView threadId="t_1" />)
    const box = screen.getByRole('textbox', { name: 'Conclusion (optional)' })
    expect(box).toHaveValue('half a note')
    expect(box).not.toHaveFocus()
    expect(scrolled).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/draft/threadText.test.ts src/thread/Composer.test.tsx src/thread/ThreadView.test.tsx`
Expected: FAIL. `./threadText` does not resolve.

- [ ] **Step 4: Implement the storage module**

Create `web/src/draft/threadText.ts`:

```ts
import { useCallback, useState } from 'react'

// Unsent text the user typed in one thread (demo2 follow-up 2): the composer's reply and the
// Resolve note. Kept in localStorage per session and thread, like the draft comments (draft.ts),
// so a thread switch or a reload does not lose it. A successful send (composer) or Resolve (note),
// or Cancel on the note, clears it. Every access is guarded: localStorage may be missing or may
// throw (private mode, blocked site data, quota), and the text then lives in memory only.
export type ThreadTextKind = 'composer' | 'note'

const key = (kind: ThreadTextKind, sid: string, threadId: string) => `tdm:${kind}:${sid}:${threadId}`

export function loadThreadText(kind: ThreadTextKind, sid: string, threadId: string): string {
  try {
    return localStorage.getItem(key(kind, sid, threadId)) ?? ''
  } catch {
    return ''
  }
}

// saveThreadText stores the text as typed, or removes the entry when it is blank.
export function saveThreadText(kind: ThreadTextKind, sid: string, threadId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(key(kind, sid, threadId), text)
    else localStorage.removeItem(key(kind, sid, threadId))
  } catch {
    // Storage unavailable: the text still lives in component state.
  }
}

// useThreadText is useState backed by loadThreadText/saveThreadText. Its callers remount per
// thread (ThreadView keys its body on the thread id), so the initial load runs once per thread.
export function useThreadText(kind: ThreadTextKind, sid: string, threadId: string): [string, (text: string) => void] {
  const [text, setText] = useState(() => loadThreadText(kind, sid, threadId))
  const set = useCallback(
    (next: string) => {
      setText(next)
      saveThreadText(kind, sid, threadId, next)
    },
    [kind, sid, threadId],
  )
  return [text, set]
}
```

- [ ] **Step 5: Use it in the composer**

In `web/src/thread/Composer.tsx`:
- add `import { useThreadText } from '../draft/threadText'`;
- change the context line to `const { sendReview, readOnly, draft, sid } = useSessionCtx()`;
- replace `const [text, setText] = useState('')` with:

```tsx
  // Demo2 follow-up 2: unsent text is kept per thread, across thread switches and reloads.
  const [text, setText] = useThreadText('composer', sid, thread.id)
```

(`useState` stays imported for `sending`. The existing `setText('')` after a successful send now also clears the stored text.)

- [ ] **Step 6: Add the scroll helper and the editor props**

Append to `web/src/shell/motion.ts`:

```ts
// scrollFullyIntoView scrolls the least needed to show all of el: for an editor opened near the
// bottom edge, that brings its buttons into view too (demo2 follow-up 1). Honors reduced motion.
// A no-op where scrollIntoView is missing (jsdom).
export function scrollFullyIntoView(el: Element): void {
  if (typeof el.scrollIntoView !== 'function') return
  el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}
```

Replace `web/src/blocks/CommentEditor.tsx`:

```tsx
import { useState } from 'react'

interface Props {
  label?: string
  initial?: string
  submitLabel?: string
  allowEmpty?: boolean
  /** Focus the textarea on mount (default). ResolveThread turns it off for a restored note. */
  autoFocus?: boolean
  /** Called with every edit, e.g. to keep an unsent note (demo2 follow-up 2). */
  onChange?(text: string): void
  onSave(text: string): void
  onCancel(): void
}

export function CommentEditor({
  label = 'Comment',
  initial = '',
  submitLabel = 'Save to draft',
  allowEmpty = false,
  autoFocus = true,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const [text, setText] = useState(initial)
  const submit = () => {
    const t = text.trim()
    if (t || allowEmpty) onSave(t)
  }
  return (
    <div className="comment-editor">
      <textarea
        aria-label={label}
        autoFocus={autoFocus}
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange?.(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="actions">
        <button type="button" className="btn primary small" disabled={!allowEmpty && !text.trim()} onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Rewrite ResolveThread**

Replace `web/src/thread/ResolveThread.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Thread } from '../api/types'
import { CommentEditor } from '../blocks/CommentEditor'
import { useThreadText } from '../draft/threadText'
import { useSessionCtx } from '../session/context'
import { RESOLVE_NOTE_EVENT } from '../session/shortcuts'
import { scrollFullyIntoView } from '../shell/motion'

// ResolveThread lets the user resolve an open thread the AI has not proposed a conclusion for.
// Resolve resolves at once; the daemon fills in "Resolved by user" (follow-ups B). Add note, or
// `c` with no line selected, opens the same editor as the conclusion's Edit, starting empty. The
// note becomes the conclusion, and the agent receives it as "conclusion edited and accepted".
// It is its own component, so the editor state is dropped when the thread's status changes.
//
// The note editor is 'closed', 'opened' by the user (Add note or `c`), or 'restored' from an
// unsent note kept for this thread (demo2 follow-up 2) after a thread switch or reload. Opening
// focuses it and scrolls the whole editor into view, buttons included (follow-up 1). A restored
// editor does neither, so it never takes focus or scroll away from the user's navigation (j/k).
// A successful Resolve or Cancel forgets the kept note.
type NoteEditor = 'closed' | 'opened' | 'restored'

export function ResolveThread({ thread, onResolved }: { thread: Thread; onResolved?: () => void }) {
  const { run, sid } = useSessionCtx()
  const [note, setNote] = useThreadText('note', sid, thread.id)
  const [editor, setEditor] = useState<NoteEditor>(() => (note ? 'restored' : 'closed'))
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const editorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const open = (e: Event) => {
      if (inFlight.current) return
      if ((e as CustomEvent<{ threadId: string }>).detail?.threadId === thread.id) setEditor('opened')
    }
    document.addEventListener(RESOLVE_NOTE_EVENT, open)
    return () => document.removeEventListener(RESOLVE_NOTE_EVENT, open)
  }, [thread.id])

  useEffect(() => {
    const el = editorRef.current
    if (editor !== 'opened' || !el) return
    el.querySelector('textarea')?.focus() // a restored editor opened with `c` is already mounted
    scrollFullyIntoView(el)
  }, [editor])

  const resolve = async (text: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (await run({ type: 'thread.resolve', data: { threadId: thread.id, ...(text ? { text } : {}) } })) {
        setNote('')
        onResolved?.()
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (editor === 'closed')
    return (
      <div className="resolve-bar">
        <button type="button" className="btn small" disabled={busy} onClick={() => void resolve('')}>
          Resolve
        </button>
        <button type="button" className="btn link" disabled={busy} onClick={() => setEditor('opened')}>
          Add note
        </button>
        <span className="resolve-hint">
          or press <kbd>c</kbd> to add a note
        </span>
      </div>
    )
  return (
    <section className="conclusion" aria-label="Resolve thread" ref={editorRef}>
      <div className="kicker">Resolve thread</div>
      <CommentEditor
        label="Conclusion (optional)"
        submitLabel="Resolve"
        allowEmpty
        initial={note}
        autoFocus={editor === 'opened'}
        onChange={setNote}
        onSave={(text) => void resolve(text)}
        onCancel={() => {
          setNote('')
          setEditor('closed')
        }}
      />
    </section>
  )
}
```

- [ ] **Step 8: Update the docs**

In `docs/ROADMAP.md`, delete the line:

```
- Keep composer text per thread (it is lost on thread switch).
```

In `docs/superpowers/specs/2026-09-25-tandem-design.md`, replace the line

```
- The user's unsent draft lives in the browser (`localStorage`, per session) until it is sent.
```

with

```
- The user's unsent draft lives in the browser (`localStorage`, per session) until it is sent. So do unsent
  composer text and an unsent Resolve note, per session and thread (`tdm:composer:<sid>:<threadId>`,
  `tdm:note:<sid>:<threadId>`), until sent, resolved or cancelled.
```

- [ ] **Step 9: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. The existing Resolve tests (`resolves an open thread in one click`, `sends a single Resolve while one is in flight`, `resolves with an empty note, and cancels…`, `opens the note editor when the c shortcut targets this thread`) still pass: `setup.ts` clears `localStorage` after each test.

- [ ] **Step 10: Commit**

```bash
git add web/src/draft/threadText.ts web/src/draft/threadText.test.ts web/src/thread web/src/blocks/CommentEditor.tsx web/src/shell/motion.ts docs/ROADMAP.md docs/superpowers/specs/2026-09-25-tandem-design.md
git commit -m "feat(web): keep unsent composer text and Resolve notes per thread; reveal the note editor

Unsent text lives in localStorage per session and thread and survives
thread switches and reloads. Opening the note editor (Add note or c)
scrolls it fully into view, honoring reduced motion."
```

---

### Task 7: Web: readable ids as chips (#4)

**Files:**
- Create: `web/src/refs/ids.ts`, `web/src/refs/ids.test.ts`
- Create: `web/src/refs/IdChip.tsx`, `web/src/refs/IdChip.test.tsx`
- Modify: `web/src/markdown/markdown.ts` (`MdEnv`, `idChipHtml`, the `text` rule)
- Modify: `web/src/markdown/Prose.tsx` (pass `titleOf` in the env)
- Modify: `web/src/blocks/LineNotes.tsx` (AI annotations)
- Modify: `web/src/blocks/VariantsBlock.tsx` (pros and cons)
- Modify: `web/src/stage/StageView.tsx` (goal, thread conclusions in the list)
- Modify: `web/src/styles/app.css` (`.id-chip`), `web/src/styles/theme.css` (`--chip-bg`, `--chip-fg`)
- Test: `web/src/markdown/markdown.test.ts`, `web/src/stage/StageView.test.tsx`, `web/src/thread/ThreadView.test.tsx`, `web/src/shell/SessionPage.test.tsx`, `web/src/styles/chips.test.ts` (new)

**Where agent text is rendered (all of it gets chips):**
- through `Prose`: AI messages (`MessageView`), notes (`NoteBlock`), nested note/markdown blocks (`NestedBlock`), variant descriptions, proposed and accepted conclusions (`ConclusionCard`), proposed and accepted stage summaries (`StageView`);
- as plain text, now through `AgentText`: AI line annotations (`LineNotes`), variant pros and cons (`VariantsBlock`), the stage goal and each thread's conclusion in the stage's thread list (`StageView`).

Not changed: titles (headings, nav), user text (messages, sent and draft comments), and markdown documents (`MarkdownBlock`, which renders through `splitSections` with no env).

**Interfaces:**
- Consumes: `State` (`stages[].title`, `threads[id].title`), `SessionContext`, hash routing (`useCurrentItem` listens to `hashchange`).
- Produces:
  - `type IdSegment = { kind: 'text'; text: string } | { kind: 'ref'; id: string; title: string }`;
  - `type TitleOf = (id: string) => string | undefined`;
  - `splitIds(text: string, titleOf: TitleOf): IdSegment[]`. It is pure. Adjacent text is merged, and empty text gives `[]`;
  - `titlesOf(state: State): TitleOf`;
  - `useTitleOf(): TitleOf | undefined`, which is undefined outside a `SessionContext`;
  - `IdChip({ id, title })` renders `<a class="id-chip" href="#<id>" title="id: <id>">title</a>`;
  - `AgentText({ text })`;
  - `interface MdEnv { titleOf?: TitleOf }` and `idChipHtml(id: string, title: string): string` in `markdown.ts`.

- [ ] **Step 1: Write the failing tokenizer tests**

Create `web/src/refs/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fixtureSnapshot } from '../test/session'
import { splitIds, titlesOf } from './ids'

const titles: Record<string, string> = { t_1: 'Repository layer', t_2: 'Cache strategy', st_1: 'Data model' }
const titleOf = (id: string) => titles[id]

describe('splitIds (demo2 follow-up 4)', () => {
  it('turns known thread and stage ids into refs', () => {
    expect(splitIds('See t_2 and st_1.', titleOf)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'ref', id: 't_2', title: 'Cache strategy' },
      { kind: 'text', text: ' and ' },
      { kind: 'ref', id: 'st_1', title: 'Data model' },
      { kind: 'text', text: '.' },
    ])
  })

  it('finds ids at the edges and next to punctuation', () => {
    expect(splitIds('t_1', titleOf)).toEqual([{ kind: 'ref', id: 't_1', title: 'Repository layer' }])
    expect(splitIds('(t_1, t_2)', titleOf).flatMap((s) => (s.kind === 'ref' ? [s.id] : []))).toEqual(['t_1', 't_2'])
  })

  // Review Focus 2: only whole-word, known ids outside code spans.
  it('leaves ids inside words, unknown ids and ids in code spans as text', () => {
    for (const text of ['st_1x', 'xt_1', 'at_1', 't_1_2', 't_12', 'b_1', 'st_9', 'use `t_1` here', '``st_1``']) {
      expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
    }
  })

  it('keeps matching after an unclosed backtick', () => {
    expect(splitIds('a ` then t_1', titleOf)).toEqual([
      { kind: 'text', text: 'a ` then ' },
      { kind: 'ref', id: 't_1', title: 'Repository layer' },
    ])
  })

  it('returns nothing for empty text', () => {
    expect(splitIds('', titleOf)).toEqual([])
  })
})

describe('titlesOf', () => {
  it('looks up stages and threads in the session state', () => {
    const f = titlesOf(fixtureSnapshot().state)
    expect(f('st_2')).toBe('API')
    expect(f('t_3')).toBe('Docs')
    expect(f('t_9')).toBeUndefined()
    expect(f('st_9')).toBeUndefined()
  })
})
```

Append to `web/src/markdown/markdown.test.ts`:

```ts
describe('id chips in markdown (demo2 follow-up 4)', () => {
  const md = createMarkdown(plainTokenize)
  const titles: Record<string, string> = { t_1: 'Repository <layer>', st_1: 'Data model' }
  const titleOf = (id: string) => titles[id]

  it('renders known ids in text as chips with the escaped title', () => {
    const html = md.render('See t_1 in **st_1**.', { titleOf })
    expect(html).toContain('<a class="id-chip" href="#t_1" title="id: t_1">Repository &lt;layer&gt;</a>')
    expect(html).toContain('<strong><a class="id-chip" href="#st_1" title="id: st_1">Data model</a></strong>')
  })

  // Review Focus 2
  it('leaves ids in code, in links, inside words and unknown ids alone', () => {
    const html = md.render('`t_1` and st_1x and t_9 and [t_1](https://example.com/t_1)\n\n```\nt_1\n```\n', { titleOf })
    expect(html).not.toContain('id-chip')
    expect(html).toContain('<code>t_1</code>')
  })

  it('renders no chips without titles (markdown documents)', () => {
    expect(md.render('See t_1.')).toBe('<p>See t_1.</p>\n')
  })
})
```

- [ ] **Step 2: Write the failing component tests**

Create `web/src/refs/IdChip.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderWithCtx } from '../test/session'
import { AgentText } from './IdChip'

describe('AgentText (demo2 follow-up 4)', () => {
  it('shows known ids as chips that link to the item, with the id on hover', () => {
    const { container } = renderWithCtx(
      <p>
        <AgentText text="Settled in t_2; see st_1, not t_9 or `t_1`." />
      </p>,
    )
    const chip = screen.getByRole('link', { name: 'Cache strategy' })
    expect(chip).toHaveAttribute('href', '#t_2')
    expect(chip).toHaveAttribute('title', 'id: t_2')
    expect(chip).toHaveClass('id-chip')
    expect(screen.getByRole('link', { name: 'Data model' })).toHaveAttribute('title', 'id: st_1')
    expect(container.querySelectorAll('.id-chip')).toHaveLength(2)
    expect(container).toHaveTextContent('Settled in Cache strategy; see Data model, not t_9 or `t_1`.')
  })

  it('renders plain text outside a session', () => {
    const { container } = render(
      <p>
        <AgentText text="see t_2" />
      </p>,
    )
    expect(container).toHaveTextContent('see t_2')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
```

Create `web/src/styles/chips.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')
const themeCss = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')

describe('id chips (demo2 follow-up 4)', () => {
  it('truncate long titles with an ellipsis, on their own background', () => {
    const rule = appCss.match(/\.id-chip\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    for (const decl of ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap', 'max-width:', 'background: var(--chip-bg)'])
      expect(rule![1]).toContain(decl)
  })

  it('define the chip colors for light and dark themes', () => {
    expect(themeCss.match(/--chip-bg:/g)).toHaveLength(2)
    expect(themeCss.match(/--chip-fg:/g)).toHaveLength(2)
  })
})
```

In `web/src/stage/StageView.test.tsx`, change the Testing Library import to `import { screen, within } from '@testing-library/react'` and append inside `describe('StageView', …)`:

```tsx
  it('shows ids in the goal, thread conclusions and the summary as chips (demo2 follow-up 4)', () => {
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
    expect(screen.getByRole('link', { name: 'Cache strategy' })).toHaveAttribute('title', 'id: t_2') // t_1's conclusion
  })
```

In `web/src/thread/ThreadView.test.tsx`, change the Testing Library import to `import { act, fireEvent, screen, within } from '@testing-library/react'` and append:

```tsx
describe('ThreadView id chips (demo2 follow-up 4)', () => {
  it('shows ids in AI messages and annotations as chips', async () => {
    const base = makeCtx()
    const t1 = base.state.threads.t_1
    base.state.threads.t_1 = { ...t1, messages: [{ actor: 'ai', text: 'Same trade-off as t_2.', seq: 7 }, t1.messages[1]] }
    base.state.blocks.b_2 = { ...base.state.blocks.b_2, annotations: [{ lines: { start: 14, end: 14 }, text: 'Decided in st_1.' }] }
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(within(container.querySelector('.msg-ai') as HTMLElement).getByRole('link', { name: 'Cache strategy' })).toHaveAttribute('href', '#t_2')
    expect(await screen.findByRole('link', { name: 'Data model' })).toHaveAttribute('title', 'id: st_1')
  })

  it('shows ids in variant pros and cons as chips', () => {
    const base = makeCtx()
    const b3 = base.state.blocks.b_3
    base.state.blocks.b_3 = {
      ...b3,
      variants: { ...b3.variants!, options: [{ ...b3.variants!.options[0], pros: ['Simpler than t_1'] }, ...b3.variants!.options.slice(1)] },
    }
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    expect(screen.getByRole('link', { name: 'Repository layer' })).toHaveAttribute('title', 'id: t_1')
  })
})
```

In `web/src/shell/SessionPage.test.tsx`, append inside `describe('SessionPage', …)`:

```tsx
  // Demo2 follow-up 4: a chip opens the thread it names through the hash routing.
  it('opens the thread an id chip names', async () => {
    const snap = structuredClone(fixture)
    snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache is t_2.'
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
    const chip = screen.getByRole('link', { name: 'Cache strategy' })
    expect(chip).toHaveAttribute('title', 'id: t_2')
    await userEvent.click(chip)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/refs src/markdown/markdown.test.ts src/styles/chips.test.ts src/stage/StageView.test.tsx src/thread/ThreadView.test.tsx src/shell/SessionPage.test.tsx`
Expected: FAIL. `./ids` and `./IdChip` do not resolve, markdown renders no `id-chip`, and there is no `.id-chip` rule.

- [ ] **Step 4: Implement the tokenizer**

Create `web/src/refs/ids.ts`:

```ts
import type { State } from '../api/types'

// Demo2 follow-up 4: the agent refers to threads and stages by short id (t_3, st_1); the page shows
// each known id as a chip with the item's title. splitIds is the one tokenizer for that: it cuts
// text into plain runs and known ids. An id is a whole word (st_1x, xt_1 and t_1_2 are not ids),
// ids inside `code spans` stay text, and ids the session does not know stay text.
export type IdSegment = { kind: 'text'; text: string } | { kind: 'ref'; id: string; title: string }

export type TitleOf = (id: string) => string | undefined

// A code span (matched first, so ids inside it are skipped) or a whole-word thread/stage id.
const CODE_OR_ID = /(`+)[\s\S]*?\1|\b(?:st|t)_\d+\b/g

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
    if (m[1] !== undefined) continue // a code span: stays in the text run
    const title = titleOf(m[0])
    if (title === undefined) continue // an unknown id: stays in the text run
    pushText(text.slice(last, m.index!))
    out.push({ kind: 'ref', id: m[0], title })
    last = m.index! + m[0].length
  }
  pushText(text.slice(last))
  return out
}

// titlesOf looks ids up in the session state: st_N among the stages, t_N among the threads.
export function titlesOf(state: State): TitleOf {
  return (id) => (id.startsWith('st_') ? state.stages.find((s) => s.id === id)?.title : state.threads[id]?.title)
}
```

- [ ] **Step 5: Implement the chip component**

Create `web/src/refs/IdChip.tsx`:

```tsx
import { Fragment, useContext, useMemo } from 'react'
import { SessionContext } from '../session/context'
import { splitIds, titlesOf, type TitleOf } from './ids'

// useTitleOf resolves ids against the current session state. It is undefined outside a session,
// where agent text renders as written.
export function useTitleOf(): TitleOf | undefined {
  const state = useContext(SessionContext)?.state
  return useMemo(() => (state ? titlesOf(state) : undefined), [state])
}

// IdChip shows a thread or stage by its title (demo2 follow-up 4). It is a plain link to #<id>, so
// a click opens the item through the page's hash routing (useCurrentItem), like the stage page's
// thread list. The title attribute shows the id on hover. Its HTML twin for markdown is
// idChipHtml (markdown/markdown.ts); keep the two in sync.
export function IdChip({ id, title }: { id: string; title: string }) {
  return (
    <a className="id-chip" href={`#${id}`} title={`id: ${id}`}>
      {title}
    </a>
  )
}

// AgentText renders plain (non-markdown) agent text with its thread and stage ids as chips.
export function AgentText({ text }: { text: string }) {
  const titleOf = useTitleOf()
  if (!titleOf) return <>{text}</>
  return (
    <>
      {splitIds(text, titleOf).map((s, i) =>
        s.kind === 'text' ? <Fragment key={i}>{s.text}</Fragment> : <IdChip key={i} id={s.id} title={s.title} />,
      )}
    </>
  )
}
```

- [ ] **Step 6: Hook chips into markdown and Prose**

In `web/src/markdown/markdown.ts`:
- add `import { splitIds, type TitleOf } from '../refs/ids'`;
- below `escapeHtml`, add:

```ts
// MdEnv is the env Prose passes to md.render: titleOf turns agent-written thread and stage ids into
// chips (demo2 follow-up 4). splitSections passes none, so markdown documents render as written.
export interface MdEnv {
  titleOf?: TitleOf
}

type MdToken = Parameters<NonNullable<Md['renderer']['rules']['text']>>[0][number]

// idChipHtml is the HTML twin of the IdChip component (refs/IdChip.tsx); keep the two in sync.
export function idChipHtml(id: string, title: string): string {
  return `<a class="id-chip" href="#${id}" title="id: ${id}">${escapeHtml(title)}</a>`
}

// insideLink reports whether an inline text token sits between link_open and link_close: a chip
// there would nest a link in a link.
function insideLink(tokens: MdToken[], idx: number): boolean {
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].type === 'link_close') return false
    if (tokens[i].type === 'link_open') return true
  }
  return false
}
```

- in `createMarkdown`, after the `link_open` rule and before `return md`, add:

```ts
  // Plain text runs only: code spans and fences have their own rules, so ids there stay as written.
  md.renderer.rules.text = (tokens, idx, _options, env: MdEnv | undefined) => {
    const content = tokens[idx].content
    if (!env?.titleOf || insideLink(tokens, idx)) return escapeHtml(content)
    return splitIds(content, env.titleOf)
      .map((s) => (s.kind === 'text' ? escapeHtml(s.text) : idChipHtml(s.id, s.title)))
      .join('')
  }
```

Replace `web/src/markdown/Prose.tsx`:

```tsx
import { useMemo } from 'react'
import { useTitleOf } from '../refs/IdChip'
import { useMarkdown, type MdEnv } from './markdown'

// Prose renders trusted-safe markdown (markdown-it with html disabled) in the reading typeface.
// It only ever renders agent text; thread and stage ids in it become chips (demo2 follow-up 4).
export function Prose({ text, className }: { text: string; className?: string }) {
  const md = useMarkdown()
  const titleOf = useTitleOf()
  const html = useMemo(() => {
    const env: MdEnv = { titleOf }
    return md.render(text, env)
  }, [md, text, titleOf])
  return <div className={className ? `prose ${className}` : 'prose'} dangerouslySetInnerHTML={{ __html: html }} />
}
```

- [ ] **Step 7: Hook chips into the plain-text agent strings**

In `web/src/blocks/LineNotes.tsx`, add `import { AgentText } from '../refs/IdChip'` and in the annotations map replace `{a.text}` with `<AgentText text={a.text} />`.

In `web/src/blocks/VariantsBlock.tsx`, add `import { AgentText } from '../refs/IdChip'`. Replace the `<li … className="pro">` body `{p}` with `<AgentText text={p} />`, and the `<li … className="con">` body `{c}` with `<AgentText text={c} />`.

In `web/src/stage/StageView.tsx`, add `import { AgentText } from '../refs/IdChip'` and replace:

```tsx
        {stage.goal && <p className="goal">Goal: {stage.goal}</p>}
```

with

```tsx
        {stage.goal && (
          <p className="goal">
            Goal: <AgentText text={stage.goal} />
          </p>
        )}
```

and

```tsx
            {t.conclusion && <div className="stage-concl">{t.conclusion}</div>}
```

with

```tsx
            {t.conclusion && (
              <div className="stage-concl">
                <AgentText text={t.conclusion} />
              </div>
            )}
```

- [ ] **Step 8: Style the chip**

In `web/src/styles/theme.css`, in the light `:root` block after `--sent-bar: #8c8f96;`, add:

```css
  --chip-bg: #e4eaf4;
  --chip-fg: #30486b;
```

and in the `@media (prefers-color-scheme: dark)` `:root` block after `--ann-bg: #26241e;`, add:

```css
    --chip-bg: #2b3546;
    --chip-fg: #c8d5ea;
```

Append to `web/src/styles/app.css`:

```css
/* Demo2 follow-up 4: a thread or stage id in agent text, shown by its title. */
.id-chip {
  display: inline-block;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--chip-bg);
  color: var(--chip-fg);
  font: 500 0.875em var(--font-ui);
  font-style: normal;
  line-height: 1.5;
  text-decoration: none;
}
.id-chip:hover { text-decoration: underline; }
```

- [ ] **Step 9: Run the web tests and the typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS. `scale.test.ts` accepts the em font size. The existing `Goal: Pick the storage layer` assertion still matches, because the goal has no id and stays in one `<p>`.

- [ ] **Step 10: Commit**

```bash
git add web/src/refs web/src/markdown web/src/blocks/LineNotes.tsx web/src/blocks/VariantsBlock.tsx web/src/stage web/src/thread/ThreadView.test.tsx web/src/shell/SessionPage.test.tsx web/src/styles
git commit -m "feat(web): show thread and stage ids in agent text as titled chips

A known t_N or st_N becomes a chip with the item's title (id on hover)
that opens it; unknown ids and ids in code stay as written."
```

---

### Task 8: End-to-end coverage, rebuild webdist, verify everything

**Files:**
- Modify: `web/e2e/loop.spec.ts` (a second test)
- Regenerate: `internal/daemon/webdist/`

**Interfaces:**
- Consumes: everything above.
- Produces: an embedded UI that matches `web/src`.

- [ ] **Step 1: Add the e2e test**

Append to `web/e2e/loop.spec.ts`:

```ts
test('draft-only Send, id chips, and an edited stage summary', async ({ page }) => {
  const url = run(['session', 'new', 'Storage decisions']).trim().split(' ')[1]
  run(['stage', 'add', 'Storage'])
  run(['thread', 'add', 'Event log'])
  run(['block', 'add', 'code', '--lang', 'go', '--text', 'type Event struct{}\n'])
  run(['thread', 'add', 'Blobs'])
  run(['say', '--thread', 't_2', 'Blobs are referenced from t_1.'])

  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Event log' })).toBeVisible()

  // Follow-up 3: draft comments alone enable the composer's Send, which sends only them
  await page.getByRole('button', { name: 'Line 1', exact: true }).click()
  await page.keyboard.press('c')
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Why a struct?')
  await page.getByRole('button', { name: 'Save to draft' }).click()
  const send = page.getByRole('button', { name: 'Send (1 comment)' })
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByRole('button', { name: '1 line comment' })).toBeVisible()
  const sent = run(['wait', '--timeout', '5s'])
  expect(sent).toContain('Comment on b_1, lines 1:')
  expect(sent).toContain('> Why a struct?')

  // Follow-up 4: the agent's t_1 shows as a chip with the thread's title; a click opens that thread
  await page.getByRole('button', { name: 'Blobs' }).click()
  const chip = page.getByRole('link', { name: 'Event log' })
  await expect(chip).toHaveAttribute('title', 'id: t_1')
  await chip.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Event log' })).toBeVisible()

  // Resolve both threads in one click each; the page lands on the stage, which waits for the summary (follow-up 5)
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Blobs' })).toBeVisible()
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Storage' })).toBeVisible()
  expect(run(['wait', '--timeout', '5s'])).toContain('conclusion edited and accepted')
  await expect(page.getByRole('status', { name: "All threads resolved — waiting for the AI's stage summary." })).toBeVisible()

  // Follow-up 7: edit the proposed summary and accept it; the agent and the export get the edited text
  run(['stage', 'propose', 'Events go to a JSONL log.'])
  const proposed = page.getByRole('region', { name: 'Proposed stage summary' })
  await expect(proposed).toContainText('Events go to a JSONL log.')
  await proposed.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('textbox', { name: 'Edit summary' }).fill('Events go to a JSONL log; blobs are content-addressed.')
  await page.getByRole('button', { name: 'Accept edited' }).click()
  await expect(page.getByText('Stage summary', { exact: true })).toBeVisible()
  expect(run(['wait', '--timeout', '5s'])).toContain(
    '## Stage summary — edited and accepted\n\nFinal summary:\n> Events go to a JSONL log; blobs are content-addressed.\n',
  )
  expect(run(['export'])).toContain('## 1. Storage\nEvents go to a JSONL log; blobs are content-addressed.')
})
```

- [ ] **Step 2: Build the web UI**

Run: `cd web && npm run build`
Expected: `tsc --noEmit` passes and Vite writes `../internal/daemon/webdist/`. A chunk-size warning is known (ROADMAP polish backlog) and fine.

- [ ] **Step 3: Run the full suites and the project typecheck**

Run: `go test ./... && (cd web && npm test && npx tsc -b)`
Expected: all PASS. `TestPageServesBuiltUI` serves the new build, and `TestSnapshotContractFixture` matches the unchanged fixture. `tsc -b` writes only the git-ignored `tsconfig.tsbuildinfo`.

- [ ] **Step 4: Run the e2e (needs `npx playwright install chromium` once and a Go toolchain)**

Run: `cd web && npm run e2e`
Expected: both tests PASS. The first test is unchanged. The second covers #3, #4, #5 (the status bubble), and #7 end to end (`tdm wait` and `tdm export`).

- [ ] **Step 5: Commit the e2e test and the build**

```bash
git status --short   # expect web/e2e/loop.spec.ts and internal/daemon/webdist/ only
git add web/e2e/loop.spec.ts internal/daemon/webdist
git commit -m "build(web): regenerate webdist for the demo2 follow-ups; e2e for edited summaries

The new Playwright test covers a draft-only Send, an id chip, the wait
for the stage summary, and Edit → Accept edited through tdm wait and
tdm export."
```

- [ ] **Step 6: Manual smoke check (with the user)**

Use a scratch home: `TANDEM_HOME="$(mktemp -d)"`, `go build -o /tmp/tdm ./cmd/tdm`, then drive a session with the CLI (a stage, two threads with a code block each, an AI message that mentions `t_1` and `st_1`). Check:
- `c` / Add note near the bottom of a long thread scrolls the whole note editor, buttons included, into view;
- typed composer text and a half-written note survive `j`/`k` and a page reload, and disappear after Send / Resolve;
- a draft comment with an empty composer: Send reads `Send (1 comment)`, is enabled, and sends only the comment;
- `t_1` shows as a chip with the thread title, the hover shows `id: t_1`, a click opens the thread, and a long title ends in `…`;
- with every thread resolved and the agent not in `tdm wait`, the stage shows the animated waiting bubble. It is still while `tdm wait` runs, and still under the OS reduced-motion setting;
- `tdm stage propose` with a long summary lands on the summary's top, not the page bottom;
- Edit → Accept edited: `tdm wait` prints `stage summary — edited and accepted` with the text, and `tdm export` contains it.

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| 1. Resolve note editor fully into view (c / Add note) | Task 6 (`scrollFullyIntoView`, `ResolveThread` `'opened'` effect; reduced-motion test) |
| 2. Unsent composer text and Resolve note per thread, across switches and reloads; ROADMAP item | Task 6 (`threadText.ts`, Composer, ResolveThread; ROADMAP line removed) |
| 3. Send enabled with draft comments and empty text; sends only the comments | Task 5; e2e in Task 8 |
| 4. Ids as titled chips, ellipsis, `id: …` on hover, click opens, unknown ids plain, agent keeps short ids | Task 7 (tokenizer, markdown rule, `AgentText`, CSS); guide paragraph in Task 2; e2e in Task 8 |
| 5. Animated waiting for the stage summary; still in `tdm wait`; quiet after 10 min; reduced motion | Task 4 (`stageAwaitsSummary`, `TypingBubble` `text`/`label`, reuses `.typing-dot`) |
| 6. Land on the start of a (re-)proposed summary | Task 4 (`useFollowBottom` `landOn`, `data-land`) |
| 7. Edit on a proposed summary; agent gets "stage summary edited and accepted" + text; export uses it | Task 2 (Go, guide), Task 3 (UI), e2e in Task 8 |

**Type and name consistency:**
- `stage.accept` data is `{ stageId, text? }` in Go (`AcceptStageSummary.Text`, `json:"text,omitempty"`), in `api/types.ts`, and in the StageView call.
- `StageSummaryAccepted.Original` is used by `decide.go` and `render/wait.go`.
- The header string `Stage summary — edited and accepted` is the same in `wait.go`, `wait_test.go`, the guide and its test (lowercase `stage summary — edited and accepted` in the guide, matching the existing `stage summary — accepted`), and the e2e.
- The waiting text `All threads resolved — waiting for the AI's stage summary.` is one constant, `SUMMARY_PENDING`, in StageView. The StageView test (`PENDING`) and the e2e repeat it verbatim.
- `data-land="proposed-summary"` is set in StageView and queried in SessionPage.
- `useThreadText('composer' | 'note', sid, threadId)` matches the keys `tdm:composer:…` / `tdm:note:…` asserted in `threadText.test.ts`.
- The chip markup `class="id-chip" href="#id" title="id: id"` is identical in `IdChip` and `idChipHtml`.
- `splitIds` and `TitleOf` come from `refs/ids.ts`. `useTitleOf` and `AgentText` come from `refs/IdChip.tsx`.

**Deliberate choices:**
- #7 needs no new event type. Thread Edit uses `conclusion.edited {original, text}`. The stage reuses `stage.summary.accepted`, adding `original` only when the text changed. The reducer and export already read `text`, so they are unchanged.
- #2: Cancel on the note editor discards the kept note, because it is an explicit discard. A restored note reopens the editor without focus or scroll, so `j`/`k` keep working.
- #4: markdown documents (`MarkdownBlock`), titles, and user-written text get no chips.
