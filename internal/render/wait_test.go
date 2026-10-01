package render

import (
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

const repoKt = "class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n"

func blobs(sha string) ([]byte, error) { return []byte(repoKt), nil }

// "' stands for ``` in expectations (raw strings cannot hold backticks).
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

func TestWaitProcessExited(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.StartProcess{PID: 9, Cmd: "go test ./internal/domain"},
		&domain.EndProcess{ID: "p_1", ExitCode: 1},
	)
	got, err := Wait(st, []domain.Event{events[len(events)-1]}, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "## t_1 \"Repo\" — process exited") {
		t.Fatalf("missing header:\n%s", got)
	}
	if !strings.Contains(got, "process exited p_1: exit 1") || !strings.Contains(got, "`go test ./internal/domain`") {
		t.Fatalf("missing body:\n%s", got)
	}
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
		&domain.PostStageMessage{StageID: "st_1", Text: "mention auth"},
		&domain.EndSession{Comment: "enough for today"},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{
		"# Stage st_1 \"API\" — 1/1 threads resolved\n",
		"## t_1 \"Endpoints\" — conclusion edited and accepted\n\nFinal conclusion:\n> REST, versioned\n",
		"## Stage summary — message\n\n> mention auth\n",
		"# Session — end requested\n\n> enough for today\n",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in:\n%s", part, got)
		}
	}
}

// Final review finding 7: conclusion.accepted must quote the accepted text, matching guide.md's
// "Use the final text you are given" — otherwise the agent only sees "Accepted as proposed."
// with no way to know what was actually accepted.
func TestWaitConclusionAcceptedQuotesText(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.Conclude{Text: "REST"},
		&domain.AcceptConclusion{ThreadID: "t_1"},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	want := "## t_1 \"Endpoints\" — conclusion accepted\n\nAccepted as proposed.\n> REST\n"
	if !strings.Contains(got, want) {
		t.Fatalf("missing %q in:\n%s", want, got)
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

Chose o_2 "Lazy delegate" (block b_1).

Final conclusion:
> Lazy delegate
>
> Simpler.
`
	if got != want {
		t.Fatalf("Wait mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}

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

// Demo 7 follow-ups 6: a stage question's answer reaches the agent under its stage, as "Stage st_N
// — question answered", or "Stage summary — question answered" while a summary is proposed, with
// the thread version's body.
func TestWaitStageQuestionAnswered(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.Ask{StageID: "st_1", Text: "Start with auth?", Options: []string{"Yes", "No"}},
		&domain.AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if want := "# Stage st_1 \"API\" — 0/0 threads resolved\n\n## Stage st_1 — question answered\n\nAnswered q_1 \"Start with auth?\": o_2 \"No\".\n"; err != nil || got != want {
		t.Fatalf("got %q, %v\nwant %q", got, err, want)
	}

	st, events = domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.ResolveThread{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "REST."},
		&domain.Ask{StageID: "st_1", Text: "Mention versioning?", Options: []string{"Yes", "No"}},
		&domain.AnswerQuestion{QuestionID: "q_1", Other: "Only in a footnote."},
	)
	got, err = Wait(st, domain.PendingUserEvents(events, 6), blobs) // only the answer (seq 7)
	if want := "# Stage st_1 \"API\" — 1/1 threads resolved\n\n## Stage summary — question answered\n\nAnswered q_1 \"Mention versioning?\" with their own answer:\n> Only in a footnote.\n"; err != nil || got != want {
		t.Fatalf("got %q, %v\nwant %q", got, err, want)
	}
}

func deliverN(t *testing.T, s *domain.State, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		e := domain.NewEvent(domain.ActorSystem, domain.EvAgentDelivered, domain.AgentDelivered{UpTo: s.LastSeq})
		e.Seq = s.LastSeq + 1
		e.TS = time.Date(2026, 9, 25, 11, 0, 0, 0, time.UTC).Add(time.Duration(e.Seq) * time.Second)
		if err := s.Apply(e); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWaitAppendsTipEveryFifth(t *testing.T) {
	s, events := waitScenario(t)
	deliverN(t, s, 3)
	out, err := Wait(s, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "Tip:") {
		t.Fatalf("4th wait must have no tip:\n%s", out)
	}
	deliverN(t, s, 1)
	out, err = Wait(s, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("wait output with tip:\n%s", out)
	if want := "\nTip: " + tips[0] + "\n"; !strings.HasSuffix(out, want) {
		t.Fatalf("output does not end with the tip:\n%q", out)
	}
	if !strings.Contains(out, "\n\nTip: ") {
		t.Fatalf("tip is not its own paragraph:\n%q", out)
	}
}

// A note on selected text shows the full quote alone in place of the lines; a note on a chat
// message names the message by seq.
func TestWaitQuotedComments(t *testing.T) {
	long := strings.Repeat("word ", 20) + "\n\tend"
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repository layer"},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "src/Repo.kt", Lang: "kotlin",
			BlobSHA: "sha1", FirstLine: 12, LineCount: 4}},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindNote, Text: "Intro.\n\n" + long}},
		&domain.Say{Text: "The cache is **lazy**."},
		&domain.SubmitReview{Threads: []domain.ReviewThread{{ThreadID: "t_1",
			Comments: []domain.LineComment{
				{BlockID: "b_1", Lines: domain.LineRange{Start: 14, End: 14}, Quote: "Map<String, User>?", Text: "Why nullable?"},
				{BlockID: "b_2", Lines: domain.LineRange{Start: 3, End: 4}, Quote: long, Text: "Shorter?"},
			},
			MessageComments: []domain.MessageComment{{MessageSeq: 6, Quote: "lazy", Text: "How lazy?"}}}}},
	)
	got, err := Wait(st, domain.PendingUserEvents(events, 0), blobs)
	if err != nil {
		t.Fatal(err)
	}
	want := ticks(`# Stage st_1 "Data model" — 0/1 threads resolved

## t_1 "Repository layer" — review submitted

Comment on b_1, ` + "`src/Repo.kt:14`" + `:
'''kotlin
Map<String, User>?
'''
> Why nullable?

Comment on b_2, lines 3-4:
'''text
` + long + `
'''
> Shorter?

Comment on message 6:
'''text
lazy
'''
> How lazy?
`)
	if got != want {
		t.Fatalf("Wait mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}
