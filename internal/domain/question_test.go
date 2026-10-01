package domain_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	. "github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

var ask = &Ask{Text: "Must old logs stay readable?", Options: []string{"Yes", "No"}}

// Question message spec: option ids come from the o_N counter shared with variants.
// Review Focus 5: interleaving keeps every id unique and increasing.
func TestAskSharesTheOptionCounterWithVariants(t *testing.T) {
	s, _ := domaintest.Build(t, stage, thread, variants)
	_, res, err := Decide(s, ask)
	if err != nil || res.ID != "q_1" || !reflect.DeepEqual(res.OptionIDs, []string{"o_3", "o_4"}) {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	s, _ = domaintest.Build(t, stage, thread, ask, variants, ask)
	if got := s.Blocks["b_1"].Variants.Options[0].ID; got != "o_3" {
		t.Fatalf("variants after a question start at %s, want o_3", got)
	}
	if _, _, m := s.Question("q_2"); m == nil || m.Question.Options[0].ID != "o_5" || m.Question.Options[1].ID != "o_6" {
		t.Fatalf("q_2 = %+v", m)
	}
}

func TestAskAppendsAQuestionMessage(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, &Say{Text: "hi"}, ask)
	th := s.Threads["t_1"]
	want := Message{Actor: ActorAI, Text: "Must old logs stay readable?", Seq: 5, Question: &MessageQuestion{ID: "q_1",
		Options: []QuestionOption{{ID: "o_1", Title: "Yes"}, {ID: "o_2", Title: "No"}}}}
	if len(th.Messages) != 2 || !reflect.DeepEqual(th.Messages[1], want) || th.LastAISeq != 5 || th.AwaitingAI() {
		t.Fatalf("thread = %+v", th)
	}
	var p QuestionAsked
	last := events[len(events)-1]
	if last.Type != EvQuestionAsked || last.Actor != ActorAI || last.Decode(&p) != nil || p.ThreadID != "t_1" || p.QuestionID != "q_1" {
		t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
	}
}

func TestAnswerQuestion(t *testing.T) {
	cases := []struct {
		name   string
		answer *AnswerQuestion
		text   string
		want   QuestionAnswer
	}{
		{"option", &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"}, "Answered: No", QuestionAnswer{OptionID: "o_2"}},
		// Review Focus 4: the user's own answer is trimmed.
		{"other", &AnswerQuestion{QuestionID: "q_1", Other: "  Only the last month.\n"}, `Answered: "Only the last month."`,
			QuestionAnswer{Other: "Only the last month."}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, events := domaintest.Build(t, stage, thread, ask, tc.answer)
			th, _, m := s.Question("q_1")
			if th == nil || th.ID != "t_1" || !reflect.DeepEqual(m.Question.Answer, &tc.want) {
				t.Fatalf("question = %+v", m)
			}
			msg := th.Messages[len(th.Messages)-1]
			// Demo 6 follow-ups 1: the answer names its question, for option and Other answers alike.
			if msg.Actor != ActorUser || msg.Text != tc.text || msg.Seq != 5 || msg.Question != nil || msg.AnswerTo != "q_1" {
				t.Fatalf("message = %+v", msg)
			}
			// Answering never resolves the thread; the agent picks it up.
			if th.Status != ThreadOpen || !th.AwaitingAI() {
				t.Fatalf("thread = %+v", th)
			}
			var p QuestionAnswered
			last := events[len(events)-1]
			if last.Type != EvQuestionAnswered || last.Actor != ActorUser || last.Decode(&p) != nil ||
				p.ThreadID != "t_1" || p.QuestionID != "q_1" || p.OptionID != tc.want.OptionID || p.Other != tc.want.Other {
				t.Fatalf("event = %s by %s, payload %+v", last.Type, last.Actor, p)
			}
		})
	}
	// The thread still concludes and resolves as usual after an answer.
	s, _ := domaintest.Build(t, stage, thread, ask, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}, conclude, accept)
	if s.Threads["t_1"].Status != ThreadResolved {
		t.Fatalf("thread = %+v", s.Threads["t_1"])
	}
}

func TestWithdrawQuestion(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, ask, &WithdrawQuestion{QuestionID: "q_1"})
	th, _, m := s.Question("q_1")
	if !m.Question.Withdrawn || m.Question.Answer != nil || th.LastAISeq != 5 || len(th.Messages) != 1 {
		t.Fatalf("thread = %+v, question = %+v", th, m.Question)
	}
	if last := events[len(events)-1]; last.Type != EvQuestionWithdrawn || last.Actor != ActorAI {
		t.Fatalf("event = %s by %s", last.Type, last.Actor)
	}
}

func TestWithdrawAnsweredQuestionHint(t *testing.T) {
	asked := []Command{stage, thread, ask}
	answered := append(append([]Command{}, asked...), &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"})
	err := domaintest.Try(t, append(answered, &WithdrawQuestion{QuestionID: "q_1"})...)
	var de *Error
	if !errors.As(err, &de) || de.Code != CodeQuestionClosed {
		t.Fatalf("err = %v", err)
	}
	if want := "the user already answered; read the answer with `tdm wait`"; de.Hint != want {
		t.Fatalf("hint = %q, want %q", de.Hint, want)
	}
}

func TestQuestionRules(t *testing.T) {
	ab := []string{"a", "b"}
	with := func(base []Command, c Command) []Command { return append(append([]Command{}, base...), c) }
	asked := []Command{stage, thread, ask}
	answered := with(asked, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"})
	withdrawn := with(asked, &WithdrawQuestion{QuestionID: "q_1"})
	resolved := with(asked, &ResolveThread{ThreadID: "t_1"})

	cases := []struct {
		name string
		cmds []Command
		code string
	}{
		{"ask on a resolved thread", []Command{stage, thread, &ResolveThread{ThreadID: "t_1"}, &Ask{ThreadID: "t_1", Text: "q", Options: ab}}, CodeThreadResolved},
		{"ask with one option", with(asked[:2], &Ask{Text: "q", Options: []string{"a"}}), CodeInvalidInput},
		{"ask with five options", with(asked[:2], &Ask{Text: "q", Options: []string{"a", "b", "c", "d", "e"}}), CodeInvalidInput},
		{"ask without a question", with(asked[:2], &Ask{Text: "  ", Options: ab}), CodeInvalidInput},
		{"ask with an empty option", with(asked[:2], &Ask{Text: "q", Options: []string{"a", " "}}), CodeInvalidInput},
		{"answer without a question id", with(asked, &AnswerQuestion{OptionID: "o_1"}), CodeInvalidInput},
		{"answer an unknown question", with(asked, &AnswerQuestion{QuestionID: "q_9", OptionID: "o_1"}), CodeQuestionNotFound},
		{"answer twice", with(answered, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"}), CodeQuestionClosed},
		{"answer a withdrawn question", with(withdrawn, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}), CodeQuestionClosed},
		{"answer on a resolved thread", with(resolved, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}), CodeThreadResolved},
		{"answer with a blank other", with(asked, &AnswerQuestion{QuestionID: "q_1", Other: " \n"}), CodeInvalidInput},
		{"answer with both", with(asked, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1", Other: "x"}), CodeInvalidInput},
		{"answer with neither", with(asked, &AnswerQuestion{QuestionID: "q_1"}), CodeInvalidInput},
		{"answer with another question's option", with(with(asked, ask), &AnswerQuestion{QuestionID: "q_1", OptionID: "o_3"}), CodeOptionNotFound},
		{"withdraw an unknown question", with(asked[:2], &WithdrawQuestion{QuestionID: "q_1"}), CodeQuestionNotFound},
		{"withdraw an answered question", with(answered, &WithdrawQuestion{QuestionID: "q_1"}), CodeQuestionClosed},
		{"withdraw twice", with(withdrawn, &WithdrawQuestion{QuestionID: "q_1"}), CodeQuestionClosed},
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
	// Not enforced: a second open question in the same thread (the guide asks for one at a time).
	domaintest.Build(t, stage, thread, ask, ask)
}

// Review Focus 5: a replayed log rebuilds both counters and the question state.
func TestReplayQuestionEvents(t *testing.T) {
	s, events := domaintest.Build(t, stage, thread, ask, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"})
	replayed, err := Replay(events)
	if err != nil || !reflect.DeepEqual(replayed.Threads["t_1"], s.Threads["t_1"]) {
		t.Fatalf("replayed thread = %+v, err = %v", replayed.Threads["t_1"], err)
	}
	// Review Focus 5: answerTo is derived by the reducer, so a log written before it existed
	// replays into it.
	if got := replayed.Threads["t_1"].Messages[1].AnswerTo; got != "q_1" {
		t.Fatalf("replayed answer message links to %q, want q_1", got)
	}
	if ids := EventThreadIDs(s, events[len(events)-1]); len(ids) != 1 || ids[0] != "t_1" {
		t.Fatalf("answer thread ids = %v", ids)
	}
	_, res, err := Decide(replayed, ask)
	if err != nil || res.ID != "q_2" || !reflect.DeepEqual(res.OptionIDs, []string{"o_3", "o_4"}) {
		t.Fatalf("next ask after replay = %+v, %v", res, err)
	}
	bad := NewEvent(ActorUser, EvQuestionAnswered, QuestionAnswered{ThreadID: "t_1", QuestionID: "q_9", OptionID: "o_1"})
	bad.Seq = int64(len(events) + 1)
	if _, err := Replay(append(events, bad)); err == nil {
		t.Fatal("want an error for an answer to an unknown question")
	}
}

func TestMessageQuestionJSON(t *testing.T) {
	b, _ := json.Marshal(Message{Actor: ActorAI, Text: "Q?", Seq: 3, Question: &MessageQuestion{ID: "q_1",
		Options: []QuestionOption{{ID: "o_1", Title: "Yes"}, {ID: "o_2", Title: "No"}}, Answer: &QuestionAnswer{Other: "Maybe"}}})
	want := `{"actor":"ai","text":"Q?","seq":3,"question":{"id":"q_1","options":[{"id":"o_1","title":"Yes"},{"id":"o_2","title":"No"}],"answer":{"other":"Maybe"}}}`
	if string(b) != want {
		t.Fatalf("json = %s, want %s", b, want)
	}
}

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

func TestDecodeQuestionCommands(t *testing.T) {
	cmd, err := DecodeCommand(ActorAI, "ask", json.RawMessage(`{"threadId":"t_2","text":"Q?","options":["Yes","No"]}`))
	if err != nil || !reflect.DeepEqual(cmd, &Ask{ThreadID: "t_2", Text: "Q?", Options: []string{"Yes", "No"}}) {
		t.Fatalf("ask = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorAI, "question.withdraw", json.RawMessage(`{"questionId":"q_1"}`))
	if err != nil || *cmd.(*WithdrawQuestion) != (WithdrawQuestion{QuestionID: "q_1"}) {
		t.Fatalf("question.withdraw = %#v, %v", cmd, err)
	}
	cmd, err = DecodeCommand(ActorUser, "question.answer", json.RawMessage(`{"questionId":"q_1","other":"x"}`))
	if err != nil || *cmd.(*AnswerQuestion) != (AnswerQuestion{QuestionID: "q_1", Other: "x"}) {
		t.Fatalf("question.answer = %#v, %v", cmd, err)
	}
	if _, err := DecodeCommand(ActorUser, "ask", nil); err == nil {
		t.Fatal("the user must not be able to ask")
	}
	if _, err := DecodeCommand(ActorAI, "question.answer", nil); err == nil {
		t.Fatal("the agent must not be able to answer")
	}
}

// Demo 7 follow-ups 6: `tdm ask --stage` asks on the stage page. The question is a stage message
// and the AI's action in the stage; the event carries stageId and no threadId.
func TestAskOnStage(t *testing.T) {
	askStage := &Ask{StageID: "st_1", Text: "Anything else?", Options: []string{"Yes", "No"}}
	s, events := domaintest.Build(t, stage, &PostStageMessage{StageID: "st_1", Text: "hi"}, askStage)
	st := s.Stage("st_1")
	want := Message{Actor: ActorAI, Text: "Anything else?", Seq: 4, Question: &MessageQuestion{ID: "q_1",
		Options: []QuestionOption{{ID: "o_1", Title: "Yes"}, {ID: "o_2", Title: "No"}}}}
	if len(st.Messages) != 2 || !reflect.DeepEqual(st.Messages[1], want) || st.LastAISeq != 4 || st.AwaitingAI() {
		t.Fatalf("stage = %+v", st)
	}
	last := events[len(events)-1]
	if last.Type != EvQuestionAsked || string(last.Data) != `{"stageId":"st_1","questionId":"q_1","text":"Anything else?","options":[{"id":"o_1","title":"Yes"},{"id":"o_2","title":"No"}]}` {
		t.Fatalf("event = %s %s", last.Type, last.Data)
	}
	if th, qs, m := s.Question("q_1"); th != nil || qs != st || m != &st.Messages[1] {
		t.Fatalf("Question(q_1) = %v, %v, %v", th, qs, m)
	}
	if got := EventStageID(s, last); got != "st_1" {
		t.Fatalf("stage of the question = %q", got)
	}
}

// Any stage status takes a question, like stage messages; only a closed session refuses one.
func TestAskOnStageInAnyStatus(t *testing.T) {
	askStage := &Ask{StageID: "st_1", Text: "Q?", Options: []string{"a", "b"}}
	resolve := &ResolveThread{ThreadID: "t_1"}
	propose := &ProposeStageSummary{Text: "sum"}
	for name, cmds := range map[string][]Command{
		"open":             {stage, askStage},
		"summary proposed": {stage, thread, resolve, propose, askStage},
		"accepted":         {stage, thread, resolve, propose, &AcceptStageSummary{StageID: "st_1"}, askStage},
	} {
		t.Run(name, func(t *testing.T) {
			s, _ := domaintest.Build(t, cmds...)
			if _, st, m := s.Question("q_1"); st == nil || m == nil {
				t.Fatalf("no stage question in %+v", s.Stage("st_1"))
			}
		})
	}
}

func TestStageQuestionRules(t *testing.T) {
	ab := []string{"a", "b"}
	cases := []struct {
		name string
		cmds []Command
		code string
	}{
		{"thread and stage", []Command{stage, thread, &Ask{ThreadID: "t_1", StageID: "st_1", Text: "q", Options: ab}}, CodeInvalidInput},
		{"unknown stage", []Command{stage, &Ask{StageID: "st_9", Text: "q", Options: ab}}, CodeStageNotFound},
		{"one option", []Command{stage, &Ask{StageID: "st_1", Text: "q", Options: []string{"a"}}}, CodeInvalidInput},
		{"closed session", []Command{stage, &CloseSession{}, &Ask{StageID: "st_1", Text: "q", Options: ab}}, CodeSessionClosed},
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
	var de *Error
	err := domaintest.Try(t, stage, thread, &Ask{ThreadID: "t_1", StageID: "st_1", Text: "q", Options: ab})
	if !errors.As(err, &de) || de.Hint != "pass --thread or --stage, not both" {
		t.Fatalf("hint = %v", err)
	}
}

// Answering a stage question appends the user's answer to the stage and awaits the AI there, in
// any stage status; withdrawing marks it and counts as the AI's action in the stage.
func TestAnswerAndWithdrawStageQuestion(t *testing.T) {
	askStage := &Ask{StageID: "st_1", Text: "Anything else?", Options: []string{"Yes", "No"}}
	resolve := &ResolveThread{ThreadID: "t_1"}
	accepted := []Command{stage, thread, resolve, &ProposeStageSummary{Text: "sum"}, &AcceptStageSummary{StageID: "st_1"}, askStage}
	s, events := domaintest.Build(t, append(accepted, &AnswerQuestion{QuestionID: "q_1", Other: " Stop here. "})...)
	st := s.Stage("st_1")
	msg := st.Messages[len(st.Messages)-1]
	seq := events[len(events)-1].Seq
	if msg != (Message{Actor: ActorUser, Text: `Answered: "Stop here."`, Seq: seq, AnswerTo: "q_1"}) || st.LastUserSeq != seq || !st.AwaitingAI() {
		t.Fatalf("stage = %+v", st)
	}
	last := events[len(events)-1]
	if last.Type != EvQuestionAnswered || last.Actor != ActorUser || string(last.Data) != `{"stageId":"st_1","questionId":"q_1","other":"Stop here."}` {
		t.Fatalf("event = %s %s", last.Type, last.Data)
	}
	if ids := EventThreadIDs(s, last); ids != nil {
		t.Fatalf("thread ids of a stage answer = %v", ids)
	}
	if got := EventStageID(s, last); got != "st_1" {
		t.Fatalf("stage of the answer = %q", got)
	}
	if err := domaintest.Try(t, append(accepted, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_1"}, &AnswerQuestion{QuestionID: "q_1", OptionID: "o_2"})...); err == nil {
		t.Fatal("want question_closed for a second answer")
	}

	s, events = domaintest.Build(t, stage, askStage, &PostStageMessage{StageID: "st_1", Text: "hm"}, &WithdrawQuestion{QuestionID: "q_1"})
	st = s.Stage("st_1")
	last = events[len(events)-1]
	if !st.Messages[0].Question.Withdrawn || st.LastAISeq != last.Seq || st.AwaitingAI() || len(st.Messages) != 2 {
		t.Fatalf("stage = %+v", st)
	}
	if string(last.Data) != `{"stageId":"st_1","questionId":"q_1"}` {
		t.Fatalf("withdraw event = %s", last.Data)
	}
}

// Old logs have question events with threadId only; they replay unchanged, and a thread question
// still marshals to exactly that shape. Stage question events replay onto the stage.
func TestQuestionEventShapes(t *testing.T) {
	for _, tc := range []struct {
		v    any
		want string
	}{
		{QuestionAsked{ThreadID: "t_1", QuestionID: "q_1", Text: "Q?", Options: []QuestionOption{{ID: "o_1", Title: "a"}}},
			`{"threadId":"t_1","questionId":"q_1","text":"Q?","options":[{"id":"o_1","title":"a"}]}`},
		{QuestionAnswered{ThreadID: "t_1", QuestionID: "q_1", OptionID: "o_1"}, `{"threadId":"t_1","questionId":"q_1","optionId":"o_1"}`},
		{QuestionWithdrawn{ThreadID: "t_1", QuestionID: "q_1"}, `{"threadId":"t_1","questionId":"q_1"}`},
	} {
		if b, err := json.Marshal(tc.v); err != nil || string(b) != tc.want {
			t.Fatalf("json = %s (%v), want %s", b, err, tc.want)
		}
	}
	raw := func(actor Actor, typ, data string) Event {
		return Event{Actor: actor, Type: typ, V: 1, Data: json.RawMessage(data)}
	}
	evs := []Event{
		raw(ActorAI, EvSessionCreated, `{"id":"s_1","title":"S","projectId":"p_1"}`),
		raw(ActorAI, EvStageCreated, `{"id":"st_1","title":"A"}`),
		raw(ActorAI, EvThreadCreated, `{"id":"t_1","stageId":"st_1","title":"T"}`),
		raw(ActorAI, EvQuestionAsked, `{"threadId":"t_1","questionId":"q_1","text":"Q?","options":[{"id":"o_1","title":"a"},{"id":"o_2","title":"b"}]}`),
		raw(ActorUser, EvQuestionAnswered, `{"threadId":"t_1","questionId":"q_1","optionId":"o_2"}`),
		raw(ActorAI, EvQuestionAsked, `{"stageId":"st_1","questionId":"q_2","text":"More?","options":[{"id":"o_3","title":"a"},{"id":"o_4","title":"b"}]}`),
		raw(ActorUser, EvQuestionAnswered, `{"stageId":"st_1","questionId":"q_2","optionId":"o_3"}`),
	}
	for i := range evs {
		evs[i].Seq = int64(i + 1)
	}
	s, err := Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	th := s.Threads["t_1"]
	if len(th.Messages) != 2 || th.Messages[1].Text != "Answered: b" || th.Messages[1].AnswerTo != "q_1" || !th.AwaitingAI() {
		t.Fatalf("thread = %+v", th)
	}
	st := s.Stage("st_1")
	if len(st.Messages) != 2 || st.Messages[1] != (Message{Actor: ActorUser, Text: "Answered: a", Seq: 7, AnswerTo: "q_2"}) ||
		st.LastAISeq != 6 || st.LastUserSeq != 7 {
		t.Fatalf("stage = %+v", st)
	}
	_, res, err := Decide(s, ask)
	if err != nil || res.ID != "q_3" || !reflect.DeepEqual(res.OptionIDs, []string{"o_5", "o_6"}) {
		t.Fatalf("next ask after replay = %+v, %v", res, err)
	}
}

func TestDecodeStageAsk(t *testing.T) {
	cmd, err := DecodeCommand(ActorAI, "ask", json.RawMessage(`{"stageId":"st_2","text":"Q?","options":["Yes","No"]}`))
	if err != nil || !reflect.DeepEqual(cmd, &Ask{StageID: "st_2", Text: "Q?", Options: []string{"Yes", "No"}}) {
		t.Fatalf("ask = %#v, %v", cmd, err)
	}
}
