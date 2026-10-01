package domain_test

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

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
		{"say to a thread and a stage", []Command{stage, thread, &Say{ThreadID: "t_1", StageID: "st_1", Text: "x"}}, CodeInvalidInput},
		{"say to an unknown stage", []Command{stage, &Say{StageID: "st_9", Text: "x"}}, CodeStageNotFound},
		{"empty say on a stage", []Command{stage, &Say{StageID: "st_1", Text: " "}}, CodeInvalidInput},
		{"stage message needs a stage", []Command{stage, &PostStageMessage{Text: "x"}}, CodeInvalidInput},
		{"stage message to an unknown stage", []Command{stage, &PostStageMessage{StageID: "st_9", Text: "x"}}, CodeStageNotFound},
		{"empty stage message", []Command{stage, &PostStageMessage{StageID: "st_1", Text: "  "}}, CodeInvalidInput},
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
		{"resolve needs a thread id", []Command{stage, thread, &ResolveThread{}}, CodeInvalidInput},
		{"resolve unknown thread", []Command{stage, thread, &ResolveThread{ThreadID: "t_9"}}, CodeThreadNotFound},
		{"resolve twice", []Command{stage, thread, &ResolveThread{ThreadID: "t_1"}, &ResolveThread{ThreadID: "t_1"}}, CodeThreadResolved},
		{"choose after choose and resolve", []Command{stage, thread, variants,
			&ChooseVariant{BlockID: "b_1", OptionID: "o_1", Resolve: true}, &ChooseVariant{BlockID: "b_1", OptionID: "o_2"}}, CodeThreadResolved},
		{"revise without a proposal", []Command{stage, thread, &ReviseConclusion{ThreadID: "t_1", Text: "x"}}, CodeNoConclusionProposed},
		{"revise needs text", []Command{stage, thread, conclude, &ReviseConclusion{ThreadID: "t_1", Text: " \n"}}, CodeInvalidInput},
		{"revise to the same text", []Command{stage, thread, conclude, &ReviseConclusion{ThreadID: "t_1", Text: " done\n"}}, CodeTextUnchanged},
		{"revise a resolved thread", []Command{stage, thread, conclude, accept, &ReviseConclusion{ThreadID: "t_1", Text: "x"}}, CodeThreadResolved},
		{"revise summary without a proposal", []Command{stage, thread, conclude, accept, &ReviseStageSummary{StageID: "st_1", Text: "x"}}, CodeNoSummaryProposed},
		{"revise summary needs text", append(append([]Command{stage, thread}, proposeAccept[:3]...), &ReviseStageSummary{StageID: "st_1"}), CodeInvalidInput},
		{"revise summary to the same text", append(append([]Command{stage, thread}, proposeAccept[:3]...), &ReviseStageSummary{StageID: "st_1", Text: "s "}), CodeTextUnchanged},
		{"revise an accepted summary", append(append([]Command{stage, thread}, proposeAccept...), &ReviseStageSummary{StageID: "st_1", Text: "x"}), CodeNoSummaryProposed},
		{"revise an older conclusion", []Command{stage, thread, conclude, &Conclude{ThreadID: "t_1", Text: "done v2"},
			&ReviseConclusion{ThreadID: "t_1", Text: "mine", BaseVersion: 1}}, CodeProposalChanged},
		{"revise an older summary", append(append([]Command{stage, thread}, proposeAccept[:3]...), &ProposeStageSummary{Text: "s v2"},
			&ReviseStageSummary{StageID: "st_1", Text: "mine", BaseVersion: 1}), CodeProposalChanged},
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

// With no open thread, a bare `tdm say` or `tdm ask` fails; the hint points at the latest stage
// too, since talking on the stage page is often what the agent wanted (demo 7 review).
func TestNoOpenThreadHintMentionsStage(t *testing.T) {
	for _, cmd := range []Command{&Say{Text: "hi"}, &Ask{Text: "q?", Options: []string{"A", "B"}}} {
		err := domaintest.Try(t, stage, thread, conclude, accept, cmd)
		var de *Error
		if !errors.As(err, &de) || de.Code != CodeNoOpenThread {
			t.Fatalf("%T: err = %v, want %s", cmd, err, CodeNoOpenThread)
		}
		want := "add one with `tdm thread add \"<title>\"`, or talk on the stage with `--stage st_1` (`tdm say` / `tdm ask`)"
		if de.Hint != want {
			t.Fatalf("%T: hint = %q, want %q", cmd, de.Hint, want)
		}
	}
	// Without any stage there is nothing to point at: the hint stays as it was.
	err := domaintest.Try(t, &AddBlock{BlockContent: BlockContent{Kind: KindNote, Text: "x"}})
	var de *Error
	if errors.As(err, &de) && de.Code == CodeNoOpenThread && de.Hint != "add one with `tdm thread add \"<title>\"`" {
		t.Fatalf("hint without stages = %q", de.Hint)
	}
}

func TestThreadsUnresolvedHintListsThreads(t *testing.T) {
	err := domaintest.Try(t, stage, thread, &AddThread{Title: "b"}, &ProposeStageSummary{Text: "s"})
	var de *Error
	if !errors.As(err, &de) || de == nil {
		t.Fatalf("err = %v, want *Error", err)
	}
	if de.Hint != "open threads: t_1, t_2; propose conclusions with `tdm conclude`" {
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
	cmd, err = DecodeCommand(ActorUser, "thread.resolve", json.RawMessage(`{"threadId":"t_1","text":"ok"}`))
	if err != nil || *cmd.(*ResolveThread) != (ResolveThread{ThreadID: "t_1", Text: "ok"}) {
		t.Fatalf("thread.resolve = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "variant.choose", json.RawMessage(`{"blockId":"b_1","optionId":"o_1","resolve":true}`))
	if err != nil || !cmd.(*ChooseVariant).Resolve {
		t.Fatalf("variant.choose resolve = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "stage.accept", json.RawMessage(`{"stageId":"st_1","text":"edited"}`))
	if err != nil || *cmd.(*AcceptStageSummary) != (AcceptStageSummary{StageID: "st_1", Text: "edited"}) {
		t.Fatalf("stage.accept = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "conclusion.revise", json.RawMessage(`{"threadId":"t_1","text":"mine"}`))
	if err != nil || *cmd.(*ReviseConclusion) != (ReviseConclusion{ThreadID: "t_1", Text: "mine"}) {
		t.Fatalf("conclusion.revise = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "stage.revise", json.RawMessage(`{"stageId":"st_1","text":"mine"}`))
	if err != nil || *cmd.(*ReviseStageSummary) != (ReviseStageSummary{StageID: "st_1", Text: "mine"}) {
		t.Fatalf("stage.revise = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "conclusion.revise", json.RawMessage(`{"threadId":"t_1","text":"mine","baseVersion":2}`))
	if err != nil || *cmd.(*ReviseConclusion) != (ReviseConclusion{ThreadID: "t_1", Text: "mine", BaseVersion: 2}) {
		t.Fatalf("conclusion.revise = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "stage.revise", json.RawMessage(`{"stageId":"st_1","text":"mine","baseVersion":2}`))
	if err != nil || *cmd.(*ReviseStageSummary) != (ReviseStageSummary{StageID: "st_1", Text: "mine", BaseVersion: 2}) {
		t.Fatalf("stage.revise = %#v, %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorAI, "conclusion.revise", nil); err == nil {
		t.Fatal("agent must not be able to revise a proposal")
	}
	cmd, err = DecodeCommand(ActorUser, "stage.message", json.RawMessage(`{"stageId":"st_1","text":"hi"}`))
	if err != nil || *cmd.(*PostStageMessage) != (PostStageMessage{StageID: "st_1", Text: "hi"}) {
		t.Fatalf("stage.message = %#v, %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorAI, "thread.resolve", nil); err == nil {
		t.Fatal("agent must not be able to resolve threads")
	}
}

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

// A Save carries the proposal version the user was editing (BaseVersion). One made against an older
// version is rejected (see the error table), so it never replaces a proposal the user has not seen.
// The current version, or no version at all (callers that do not send it), is accepted.
func TestReviseBaseVersion(t *testing.T) {
	reconclude := &Conclude{ThreadID: "t_1", Text: "done v2"}
	for _, base := range []int{0, 2} {
		s, _ := domaintest.Build(t, stage, thread, conclude, reconclude, &ReviseConclusion{ThreadID: "t_1", Text: "mine", BaseVersion: base})
		if th := s.Threads["t_1"]; th.ProposedConclusion != "mine" || !th.EditedByUser {
			t.Fatalf("baseVersion %d: thread = %+v", base, th)
		}
		s, _ = domaintest.Build(t, stage, thread, conclude, accept, &ProposeStageSummary{Text: "s"}, &ProposeStageSummary{Text: "s v2"},
			&ReviseStageSummary{StageID: "st_1", Text: "mine", BaseVersion: base})
		if st := s.Stage("st_1"); st.ProposedSummary != "mine" || !st.EditedByUser {
			t.Fatalf("baseVersion %d: stage = %+v", base, st)
		}
	}
}

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
	// Adding the next stage answers a message on an accepted last stage.
	s, _ = domaintest.Build(t, stage, thread, conclude, accept,
		&ProposeStageSummary{Text: "sum"}, &AcceptStageSummary{StageID: "st_1"},
		&PostStageMessage{StageID: "st_1", Text: "What next?"},
		&AddStage{Title: "Next"},
	)
	if st := s.Stage("st_1"); st.AwaitingAI() || st.LastAISeq != s.LastSeq {
		t.Fatalf("next stage did not answer the accepted stage's message: %+v", st)
	}
}

func TestDecideProcess(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, &StartProcess{PID: 4242, Cmd: "go test ./internal/domain"})
	p := s.Process("p_1")
	if p == nil || p.PID != 4242 || p.Status != ProcessRunning || p.ThreadID != "t_1" || p.Cmd != "go test ./internal/domain" {
		t.Fatalf("started = %+v", p)
	}
	if last := events[len(events)-1]; last.Type != EvProcessStarted || s.Threads["t_1"].LastAISeq != last.Seq {
		t.Fatalf("started event = %s seq %d", last.Type, last.Seq)
	}
	s, events = domaintest.Build(t, stage, thread, &StartProcess{PID: 9, Cmd: "true"}, &EndProcess{ID: "p_1", ExitCode: 0})
	p = s.Process("p_1")
	if p.Status != ProcessExited || p.ExitCode == nil || *p.ExitCode != 0 || p.ExitedAt == 0 {
		t.Fatalf("exited = %+v", p)
	}
	if last := events[len(events)-1]; last.Type != EvProcessExited {
		t.Fatalf("last = %s", last.Type)
	}
	if s, _ = domaintest.Build(t, stage, thread, &StartProcess{PID: 9, Cmd: "true", Out: "/tmp/tdm-out.log"}); s.Process("p_1").Out != "/tmp/tdm-out.log" {
		t.Fatalf("out = %q", s.Process("p_1").Out)
	}
}

func TestDecideProcessRules(t *testing.T) {
	cases := []struct {
		name string
		cmds []Command
		code string
	}{
		{"no pid", []Command{stage, thread, &StartProcess{Cmd: "true"}}, CodeInvalidInput},
		{"no cmd", []Command{stage, thread, &StartProcess{PID: 1}}, CodeInvalidInput},
		{"negative exit", []Command{stage, thread, &StartProcess{PID: 1, Cmd: "true"}, &EndProcess{ID: "p_1", ExitCode: -1}}, CodeInvalidInput},
		{"no thread", []Command{&StartProcess{PID: 1, Cmd: "true"}}, CodeNoOpenThread},
		{"unknown process", []Command{stage, thread, &EndProcess{ID: "p_9"}}, CodeProcessNotFound},
		{"already exited", []Command{stage, thread, &StartProcess{PID: 1, Cmd: "true"}, &EndProcess{ID: "p_1", ExitCode: 0}, &EndProcess{ID: "p_1", ExitCode: 1}}, CodeProcessExited},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := domaintest.Try(t, c.cmds...)
			var de *Error
			if err == nil || !errors.As(err, &de) || de.Code != c.code {
				t.Fatalf("err = %v, want %s", err, c.code)
			}
		})
	}
}

// A supervised end (tdm process run) is a system event: it wakes tdm wait and is not an AI reply.
func TestEndProcessSupervised(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, &StartProcess{PID: 9, Cmd: "true"})
	startSeq := events[len(events)-1].Seq
	evs, _, err := Decide(s, &EndProcess{ID: "p_1", ExitCode: 2, Supervised: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].Actor != ActorSystem || evs[0].Type != EvProcessExited {
		t.Fatalf("events = %+v", evs)
	}
	evs[0].Seq = s.LastSeq + 1
	evs[0].TS = events[len(events)-1].TS.Add(time.Second)
	if err := s.Apply(evs[0]); err != nil {
		t.Fatal(err)
	}
	if p := s.Process("p_1"); p.ExitCode == nil || *p.ExitCode != 2 || p.ExitUnknown() {
		t.Fatalf("after supervised end = %+v", p)
	}
	if got := s.Threads["t_1"].LastAISeq; got != startSeq {
		t.Fatalf("LastAISeq = %d, want %d", got, startSeq)
	}
}

func TestEndProcessAfterDaemonUnknownExit(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, &StartProcess{PID: 9, Cmd: "true"})
	startSeq := events[len(events)-1].Seq
	sys := NewEvent(ActorSystem, EvProcessExited, ProcessExitedPayload{ID: "p_1", ThreadID: "t_1", ExitCode: -1})
	sys.Seq = s.LastSeq + 1
	sys.TS = events[len(events)-1].TS.Add(5 * time.Second)
	if err := s.Apply(sys); err != nil {
		t.Fatal(err)
	}
	if got := s.Threads["t_1"].LastAISeq; got != startSeq {
		t.Fatalf("LastAISeq after system exit = %d, want %d", got, startSeq)
	}
	if !s.Process("p_1").ExitUnknown() {
		t.Fatalf("want unknown exit: %+v", s.Process("p_1"))
	}
	evs, _, err := Decide(s, &EndProcess{ID: "p_1", ExitCode: 3})
	if err != nil {
		t.Fatalf("end after -1: %v", err)
	}
	if len(evs) != 1 || evs[0].Actor != ActorAI || evs[0].Type != EvProcessExited {
		t.Fatalf("events = %+v", evs)
	}
	evs[0].Seq = s.LastSeq + 1
	evs[0].TS = sys.TS.Add(time.Minute)
	if err := s.Apply(evs[0]); err != nil {
		t.Fatal(err)
	}
	p := s.Process("p_1")
	if p.ExitCode == nil || *p.ExitCode != 3 || p.ExitedAt != sys.TS.UnixMilli() {
		t.Fatalf("after end = %+v", p)
	}
	if got := s.Threads["t_1"].LastAISeq; got != evs[0].Seq {
		t.Fatalf("LastAISeq after AI end = %d, want %d", got, evs[0].Seq)
	}
	if _, _, err := Decide(s, &EndProcess{ID: "p_1", ExitCode: 4}); err == nil {
		t.Fatal("second end after a real code should fail")
	}
}

// Notes on selected text: a quote on a code block must be in the commented lines; markdown and
// note quotes (rendered text) only need to be non-empty and short enough. A message comment
// names a message of its thread by seq.
func TestDecideQuotes(t *testing.T) {
	md := &AddBlock{BlockContent: BlockContent{Kind: KindMarkdown, Text: "# Title\n\nSome **bold** text.\n"}}
	note := &AddBlock{BlockContent: BlockContent{Kind: KindNote, Text: "First line.\n\nSecond line."}}
	say := &Say{Text: "Here is *the* plan."} // seq 7 after session, stage, thread and three blocks
	setup := []Command{stage, thread, code, md, note, say}
	review := func(rt ReviewThread) []Command {
		rt.ThreadID = "t_1"
		return append(append([]Command{}, setup...), &SubmitReview{Threads: []ReviewThread{rt}})
	}
	line := func(block string, a, b int, quote string) ReviewThread {
		return ReviewThread{Comments: []LineComment{{BlockID: block, Lines: LineRange{a, b}, Quote: quote, Text: "x"}}}
	}
	msg := func(seq int64, quote string) ReviewThread {
		return ReviewThread{MessageComments: []MessageComment{{MessageSeq: seq, Quote: quote, Text: "x"}}}
	}
	long := string(make([]rune, MaxQuote+1))

	s, _ := domaintest.Build(t, review(line("b_1", 1, 2, "a\nb"))...)
	if got := s.Threads["t_1"].Comments[0].Quote; got != "a\nb" {
		t.Fatalf("quote = %q", got)
	}
	s, _ = domaintest.Build(t, review(line("b_2", 3, 3, "bold text"))...)
	s, _ = domaintest.Build(t, review(line("b_3", 1, 3, "Second line"))...)
	if b := s.Blocks["b_3"]; b.FirstLine != 1 || b.LineCount != 3 {
		t.Fatalf("note lines = %d+%d", b.FirstLine, b.LineCount)
	}
	s, _ = domaintest.Build(t, review(msg(7, "the plan"))...)
	t1 := s.Threads["t_1"]
	if want := (ThreadMessageComment{MessageComment: MessageComment{MessageSeq: 7, Quote: "the plan", Text: "x"}, Seq: 8}); len(t1.MessageComments) != 1 || t1.MessageComments[0] != want {
		t.Fatalf("message comments = %+v", t1.MessageComments)
	}
	if m := t1.Messages[len(t1.Messages)-1]; m.Actor != ActorUser || m.Seq != 8 || !t1.AwaitingAI() {
		t.Fatalf("last message = %+v", m)
	}

	for name, rt := range map[string]ReviewThread{
		"blank quote":             line("b_1", 1, 1, "  \n"),
		"quote too long":          line("b_2", 1, 1, long),
		"quote not in the lines":  line("b_1", 1, 2, "c"),
		"quote across a gap":      line("b_1", 1, 3, "a\nc"),
		"message quote missing":   msg(7, ""),
		"message quote too long":  msg(7, long),
		"message not in thread":   msg(4, "x"),
		"message comment no text": {MessageComments: []MessageComment{{MessageSeq: 7, Quote: "plan"}}},
	} {
		t.Run(name, func(t *testing.T) {
			err := domaintest.Try(t, review(rt)...)
			var de *Error
			if !errors.As(err, &de) || de.Code != CodeInvalidInput {
				t.Fatalf("got %v, want %s", err, CodeInvalidInput)
			}
		})
	}
}
