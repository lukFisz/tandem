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

func TestShowListsOpenQuestion(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.Ask{Text: "Must old logs stay readable?\nDetails here.", Options: []string{"Yes", "No"}},
	)
	got, err := Show(st, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if want := "- t_1 \"Repo\" — open\n  Open question: q_1 \"Must old logs stay readable? …\"\n"; !strings.Contains(got, want) {
		t.Fatalf("missing %q in:\n%s", want, got)
	}
}

func TestShowOmitsAnsweredOrWithdrawnQuestion(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.Ask{Text: "Q1", Options: []string{"Yes", "No"}},
		&domain.AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"},
		&domain.Ask{Text: "Q2", Options: []string{"Yes", "No"}},
		&domain.WithdrawQuestion{QuestionID: "q_2"},
	)
	got, err := Show(st, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "Open question:") {
		t.Fatalf("should not list closed questions:\n%s", got)
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

// Summary headings nest under the stage's "## N. Title": the shallowest becomes ###, deeper ones
// keep their relative depth (capped at ######), and lines inside fenced code are left alone.
func TestExportNestsSummaryHeadings(t *testing.T) {
	summary := "## Results\nText with a # not heading.\n#### Detail\n```md\n## not a heading\n```\n##### Deep\n###### Deepest\n#hashtag"
	st, _ := domaintest.Build(t,
		&domain.AddStage{Title: "Data model"},
		&domain.AddThread{Title: "Repo"},
		&domain.ResolveThread{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: summary},
		&domain.AcceptStageSummary{StageID: "st_1"},
	)
	got, err := Export(st, "")
	want := "# Test session\n\n## 1. Data model\n### Results\nText with a # not heading.\n##### Detail\n```md\n## not a heading\n```\n###### Deep\n###### Deepest\n#hashtag\n"
	if err != nil || got != want {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestNestHeadingsLeavesDeepEnoughSummariesAlone(t *testing.T) {
	for _, md := range []string{"### Already nested\n#### Sub", "No headings at all.", "~~~\n# fenced\n~~~"} {
		if got := nestHeadings(md, 3); got != md {
			t.Fatalf("nestHeadings(%q) = %q", md, got)
		}
	}
}

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

	// A message on an accepted last stage is answered by adding the next stage.
	st, events = domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.ProposeStageSummary{Text: "Auth first."},
		&domain.AcceptStageSummary{StageID: "st_1"},
		&domain.PostStageMessage{StageID: "st_1", Text: "What next?"},
		&domain.AddStage{Title: "Later"},
		&domain.AddThread{StageID: "st_2", Title: "Tokens"},
	)
	got, _ = Show(st, events, blobs)
	if !strings.Contains(got, "\n## Stage st_1 \"API\" — accepted\n") || !strings.Contains(got, "# Awaiting AI\n\nNothing.") {
		t.Fatalf("accepted stage message answered by a new stage still awaiting:\n%s", got)
	}
}

// Demo 7 follow-ups 6: a stage's open question is listed like a thread's, and its answer awaits
// the AI under the stage until the AI acts in that stage.
func TestShowStageQuestion(t *testing.T) {
	st, events := domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.AddThread{Title: "Endpoints"},
		&domain.ResolveThread{ThreadID: "t_1"},
		&domain.ProposeStageSummary{Text: "REST."},
		&domain.AcceptStageSummary{StageID: "st_1"},
		&domain.Ask{StageID: "st_1", Text: "Anything else?\nMore.", Options: []string{"Yes", "No"}},
	)
	got, err := Show(st, events, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if want := "\n## Stage st_1 \"API\" — accepted\n- t_1 \"Endpoints\" — resolved\n  Conclusion: Resolved by user\nOpen question: q_1 \"Anything else? …\"\nSummary:\n"; !strings.Contains(got, want) {
		t.Fatalf("missing %q in:\n%s", want, got)
	}

	st, events = domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.Ask{StageID: "st_1", Text: "Start with auth?", Options: []string{"Yes", "No"}},
		&domain.AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"},
		&domain.AddStage{Title: "Later"},
	)
	got, _ = Show(st, events, blobs)
	for _, part := range []string{
		"\n## Stage st_1 \"API\" — open, awaiting AI\n",
		"\n# Awaiting AI\n\n# Stage st_1 \"API\" — 0/0 threads resolved\n\n## Stage st_1 — question answered\n\nAnswered q_1 \"Start with auth?\": o_1 \"Yes\".\n",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in:\n%s", part, got)
		}
	}
	if strings.Contains(got, "Open question:") {
		t.Fatalf("answered question still listed:\n%s", got)
	}

	st, events = domaintest.Build(t,
		&domain.AddStage{Title: "API"},
		&domain.Ask{StageID: "st_1", Text: "Start with auth?", Options: []string{"Yes", "No"}},
		&domain.AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"},
		&domain.Say{StageID: "st_1", Text: "Will do."},
	)
	got, _ = Show(st, events, blobs)
	if !strings.Contains(got, "# Awaiting AI\n\nNothing.") {
		t.Fatalf("answered stage question still awaiting:\n%s", got)
	}
}

// Tips belong to `tdm wait` returns only. `tdm session show` reuses the event rendering for its
// "Awaiting AI" section and must not end with one, whatever the wait count is.
func TestShowNeverEndsWithATip(t *testing.T) {
	st, events := waitScenario(t)
	for i := 0; i < TipEvery-1; i++ {
		if err := st.Apply(domain.NewEvent(domain.ActorAI, domain.EvAgentDelivered, domain.AgentDelivered{UpTo: 0})); err != nil {
			t.Fatal(err)
		}
	}
	if w, _ := Wait(st, events, blobs); !strings.Contains(w, "\nTip: ") {
		t.Fatalf("wait %d should end with a tip:\n%s", TipEvery, w)
	}
	if got, _ := Show(st, events, blobs); strings.Contains(got, "Tip: ") {
		t.Fatalf("session show printed a tip:\n%s", got)
	}
}
