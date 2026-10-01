package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

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
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum"}),
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "more"}),
	)
	st := replay(t, evs...).Stage("st_1")
	if st.Status != StageOpen || st.ProposedSummary != "" {
		t.Fatalf("after changes requested: %+v", st)
	}
	evs = append(evs,
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum2"}),
		NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: "st_1", Text: "sum2"}),
	)
	st = replay(t, evs...).Stage("st_1")
	if st.Status != StageAccepted || st.Summary != "sum2" || st.AcceptedSeq != int64(len(evs)) {
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
	// The textless variant choice below the review adds its own (empty-text) message last.
	if len(th.Comments) != 1 || th.Messages[len(th.Messages)-2].Text != "overall ok" {
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
	b, err = json.Marshal(ThreadComment{LineComment: LineComment{BlockID: "b_2", Lines: LineRange{1, 1}, Quote: "cache", Text: "why?"}, Seq: 11})
	if want := `{"blockId":"b_2","lines":{"start":1,"end":1},"quote":"cache","text":"why?","seq":11}`; err != nil || string(b) != want {
		t.Fatalf("json = %s (%v), want %s", b, err, want)
	}
}

// A note block logged before note blocks took comments has no line metadata; replay derives it.
func TestOldNoteBlockGetsLines(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvBlockAdded, BlockAdded{ID: "b_4", ThreadID: "t_1", BlockContent: BlockContent{Kind: KindNote, Text: "a\nb\n"}}))
	b := replay(t, evs...).Blocks["b_4"]
	if b.FirstLine != 1 || b.LineCount != 2 || !b.Annotatable() {
		t.Fatalf("note block = %+v", b)
	}
}

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
	// AcceptedSeq is derived: an old log gets it from the accept event's seq.
	if st.Status != StageAccepted || st.Summary != "sum" || st.ProposedSummary != "" || st.AcceptedSeq != int64(len(evs)) {
		t.Fatalf("old accept: %+v", st)
	}
	b, err := json.Marshal(StageSummaryAccepted{StageID: "st_1", Text: "sum"})
	if err != nil || string(b) != string(old.Data) {
		t.Fatalf("plain accept json = %s (%v), want %s", b, err, old.Data)
	}

	evs[len(evs)-1] = NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: "st_1", Text: "sum, edited", Original: "sum"})
	if st := replay(t, evs...).Stage("st_1"); st.Status != StageAccepted || st.Summary != "sum, edited" || st.AcceptedSeq != int64(len(evs)) {
		t.Fatalf("edited accept: %+v", st)
	}
}

// Stage summary flow, part C: old logs keep replaying. conclusion.edited (the old Accept edited,
// and Resolve with a note) and an edited stage.summary.accepted resolve and accept exactly as
// before and leave no editedByUser behind.
func TestOldEditedEventsReplay(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),
		Event{Actor: ActorUser, Type: EvConclusionEdited, V: 1, Data: json.RawMessage(`{"threadId":"t_1","original":"v1","text":"v1 edited"}`)},
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum"}),
		Event{Actor: ActorUser, Type: EvStageSummaryAccepted, V: 1, Data: json.RawMessage(`{"stageId":"st_1","text":"sum edited","original":"sum"}`)},
	)
	s := replay(t, evs...)
	if th := s.Threads["t_1"]; th.Status != ThreadResolved || th.Conclusion != "v1 edited" || th.ProposedConclusion != "" || th.EditedByUser || th.AwaitingAI() {
		t.Fatalf("old conclusion.edited: %+v", th)
	}
	if st := s.Stage("st_1"); st.Status != StageAccepted || st.Summary != "sum edited" || st.ProposedSummary != "" || st.EditedByUser || st.AcceptedSeq != int64(len(evs)) {
		t.Fatalf("old edited stage.summary.accepted: %+v", st)
	}
}

// Stage summary flow, part C: a revised proposal is replaced in place and marked as the user's,
// without bumping lastUserSeq (the AI has nothing to do until the accept). Every later proposal,
// accept, resolve or request clears the mark. Both events are placed by EventStageID (tdm log --stage).
func TestRevisedProposalsReplay(t *testing.T) {
	evs := append(structureEvents(),
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),
		NewEvent(ActorUser, EvConclusionRevised, ConclusionRevised{ThreadID: "t_1", Text: "mine"}),
	)
	s := replay(t, evs...)
	th := s.Threads["t_1"]
	if th.Status != ThreadConclusionProposed || th.ProposedConclusion != "mine" || !th.EditedByUser || th.LastUserSeq != 0 || th.AwaitingAI() {
		t.Fatalf("after conclusion.revised: %+v", th)
	}
	if got := EventStageID(s, evs[len(evs)-1]); got != "st_1" {
		t.Fatalf("conclusion.revised stage = %q", got)
	}
	for _, next := range []Event{
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v2"}),
		NewEvent(ActorUser, EvConclusionDiscussionRequested, ConclusionDiscussionRequested{ThreadID: "t_1", Comment: "not yet"}),
		NewEvent(ActorUser, EvConclusionAccepted, ConclusionAccepted{ThreadID: "t_1", Text: "mine"}),
		NewEvent(ActorUser, EvConclusionEdited, ConclusionEdited{ThreadID: "t_1", Original: "mine", Text: "Resolved by user"}),
	} {
		if th := replay(t, append(evs[:len(evs):len(evs)], next)...).Threads["t_1"]; th.EditedByUser {
			t.Errorf("%s kept editedByUser: %+v", next.Type, th)
		}
	}

	evs = append(structureEvents(),
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum"}),
		NewEvent(ActorUser, EvSummaryRevised, SummaryRevised{StageID: "st_1", Text: "my sum"}),
	)
	s = replay(t, evs...)
	if st := s.Stage("st_1"); st.Status != StageSummaryProposed || st.ProposedSummary != "my sum" || !st.EditedByUser {
		t.Fatalf("after summary.revised: %+v", st)
	}
	if got := EventStageID(s, evs[len(evs)-1]); got != "st_1" {
		t.Fatalf("summary.revised stage = %q", got)
	}
	for _, next := range []Event{
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "sum2"}),
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "more"}),
		NewEvent(ActorUser, EvStageSummaryAccepted, StageSummaryAccepted{StageID: "st_1", Text: "my sum"}),
	} {
		if st := replay(t, append(evs[:len(evs):len(evs)], next)...).Stage("st_1"); st.EditedByUser {
			t.Errorf("%s kept editedByUser: %+v", next.Type, st)
		}
	}
}

// Stage summary flow, part C: the wire shapes. editedByUser is omitted unless set, so snapshots of
// sessions without a Save (and the contract fixture) do not change.
func TestRevisedJSON(t *testing.T) {
	b, err := json.Marshal(ConclusionRevised{ThreadID: "t_1", Text: "x"})
	if want := `{"threadId":"t_1","text":"x"}`; err != nil || string(b) != want {
		t.Fatalf("conclusion.revised json = %s (%v), want %s", b, err, want)
	}
	b, err = json.Marshal(SummaryRevised{StageID: "st_1", Text: "x"})
	if want := `{"stageId":"st_1","text":"x"}`; err != nil || string(b) != want {
		t.Fatalf("summary.revised json = %s (%v), want %s", b, err, want)
	}
	for _, v := range []any{Thread{ID: "t_1"}, Stage{ID: "st_1"}} {
		if b, _ := json.Marshal(v); strings.Contains(string(b), "editedByUser") {
			t.Errorf("without a Save: %s", b)
		}
	}
	for _, v := range []any{Thread{ID: "t_1", EditedByUser: true}, Stage{ID: "st_1", EditedByUser: true}} {
		if b, _ := json.Marshal(v); !strings.Contains(string(b), `"editedByUser":true`) {
			t.Errorf("after a Save: %s", b)
		}
	}
}

// Stage summary flow spec, part D: every AI proposal is a new version, kept in order with its seq,
// also across a "discussion requested" / "changes requested" round trip (older logs). A summary
// proposal is the AI acting in its stage.
func TestProposalVersions(t *testing.T) {
	evs := append(structureEvents(), // seqs 1–8
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v1"}),                            // 9
		NewEvent(ActorUser, EvConclusionDiscussionRequested, ConclusionDiscussionRequested{ThreadID: "t_1", Comment: "no"}), // 10
		NewEvent(ActorAI, EvConclusionProposed, ConclusionProposed{ThreadID: "t_1", Text: "v2"}),                            // 11
		NewEvent(ActorUser, EvConclusionAccepted, ConclusionAccepted{ThreadID: "t_1", Text: "v2"}),                          // 12
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "s1"}),                 // 13
		NewEvent(ActorUser, EvStageSummaryChangesRequested, StageSummaryChangesRequested{StageID: "st_1", Comment: "more"}), // 14
		NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: "st_1", Text: "s2"}),                 // 15
	)
	s := replay(t, evs...)
	th := s.Threads["t_1"]
	if th.ProposalVersion != 2 || !reflect.DeepEqual(th.Proposals, []Proposal{{Text: "v1", Seq: 9}, {Text: "v2", Seq: 11}}) {
		t.Fatalf("thread: v%d %+v", th.ProposalVersion, th.Proposals)
	}
	st := s.Stage("st_1")
	if st.ProposalVersion != 2 || !reflect.DeepEqual(st.Proposals, []Proposal{{Text: "s1", Seq: 13}, {Text: "s2", Seq: 15}}) || st.LastAISeq != 15 {
		t.Fatalf("stage: v%d %+v, lastAiSeq %d", st.ProposalVersion, st.Proposals, st.LastAISeq)
	}
}

// Part E, Review Focus 1: an AI message.posted line written before stage messages existed replays
// as before, and a thread message still marshals to exactly that shape. A stage message replays
// onto the stage, never into a thread, and belongs to the stage for `tdm log --stage`.
func TestMessagePostedShapes(t *testing.T) {
	old := `{"threadId":"t_1","text":"hi"}`
	if b, err := json.Marshal(MessagePosted{ThreadID: "t_1", Text: "hi"}); err != nil || string(b) != old {
		t.Fatalf("thread message json = %s (%v), want %s", b, err, old)
	}
	stageMsg := Event{Actor: ActorUser, Type: EvMessagePosted, V: 1, Data: json.RawMessage(`{"stageId":"st_1","text":"hello"}`)}
	evs := append(structureEvents(), stageMsg) // structureEvents ends with the AI's thread message "hi"
	s := replay(t, evs...)
	st := s.Stage("st_1")
	if len(st.Messages) != 1 || st.Messages[0] != (Message{Actor: ActorUser, Text: "hello", Seq: 9}) || !st.AwaitingAI() {
		t.Fatalf("stage = %+v", st)
	}
	if th := s.Threads["t_1"]; len(th.Messages) != 1 || th.Messages[0].Text != "hi" {
		t.Fatalf("thread messages = %+v", th.Messages)
	}
	if got := EventStageID(s, evs[len(evs)-1]); got != "st_1" {
		t.Fatalf("stage message stage = %q", got)
	}
}
