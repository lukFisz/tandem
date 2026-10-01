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
