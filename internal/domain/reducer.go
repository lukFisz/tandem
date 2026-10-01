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
		// Adding the next stage answers a message on an accepted last stage. An open stage's
		// pending message stays pending: AI activity elsewhere does not answer it.
		if n := len(s.Stages); n > 0 && s.Stages[n-1].Status == StageAccepted {
			s.Stages[n-1].LastAISeq = e.Seq
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
		st.LastAISeq = e.Seq // a new thread answers a stage message (part E)
	case EvBlockAdded:
		p, err := decode[BlockAdded](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		b := &Block{ID: p.ID, ThreadID: p.ThreadID, Seq: e.Seq, BlockContent: p.BlockContent, Variants: p.Variants}
		if b.Kind == KindNote && b.LineCount == 0 {
			// Note blocks logged before they took comments carry no line metadata.
			b.FirstLine, b.LineCount = 1, CountLines(b.Text)
		}
		s.Blocks[p.ID] = b
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
		if p.StageID != "" {
			st := s.Stage(p.StageID)
			if st == nil {
				return unknown("stage", p.StageID, e)
			}
			st.Messages = append(st.Messages, Message{Actor: e.Actor, Text: p.Text, Seq: e.Seq})
			if e.Actor == ActorUser {
				st.LastUserSeq = e.Seq
			} else {
				st.LastAISeq = e.Seq
			}
			return nil
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Messages = append(t.Messages, Message{Actor: ActorAI, Text: p.Text, Seq: e.Seq})
		t.LastAISeq = e.Seq
	case EvConclusionProposed:
		p, err := decode[ConclusionProposed](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		t.Status, t.ProposedConclusion, t.EditedByUser, t.LastAISeq = ThreadConclusionProposed, p.Text, false, e.Seq
		t.ProposalVersion++
		t.Proposals = append(t.Proposals, Proposal{Text: p.Text, Seq: e.Seq})
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
		t.Status, t.ProposedConclusion, t.EditedByUser = ThreadOpen, "", false
		t.userMessage(p.Comment, e.Seq)
	case EvConclusionRevised:
		p, err := decode[ConclusionRevised](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		// The AI has nothing to do until the accept, so LastUserSeq stays: no "awaiting AI".
		t.ProposedConclusion, t.EditedByUser = p.Text, true
	case EvStageSummaryProposed:
		p, err := decode[StageSummaryProposedPayload](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.Status, st.ProposedSummary, st.EditedByUser = StageSummaryProposed, p.Text, false
		st.LastAISeq = e.Seq
		st.ProposalVersion++
		st.Proposals = append(st.Proposals, Proposal{Text: p.Text, Seq: e.Seq})
	case EvSummaryRevised:
		p, err := decode[SummaryRevised](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.ProposedSummary, st.EditedByUser = p.Text, true
	case EvStageSummaryAccepted:
		p, err := decode[StageSummaryAccepted](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.Status, st.Summary, st.ProposedSummary, st.EditedByUser = StageAccepted, p.Text, "", false
		st.AcceptedSeq = e.Seq
	case EvStageSummaryChangesRequested:
		p, err := decode[StageSummaryChangesRequested](e)
		if err != nil {
			return err
		}
		st := s.Stage(p.StageID)
		if st == nil {
			return unknown("stage", p.StageID, e)
		}
		st.Status, st.ProposedSummary, st.EditedByUser = StageOpen, "", false
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
			t.userReview(rt, e.Seq)
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
		t := s.Threads[b.ThreadID]
		t.userChoice(p.Comment, MessageChoice{BlockID: p.BlockID, OptionID: p.OptionID}, e.Seq)
		if p.Conclusion != "" {
			t.resolve(p.Conclusion, e.Seq)
		}
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
	case EvQuestionAsked:
		p, err := decode[QuestionAsked](e)
		if err != nil {
			return err
		}
		m := Message{Actor: ActorAI, Text: p.Text, Seq: e.Seq, Question: &MessageQuestion{ID: p.QuestionID, Options: p.Options}}
		if p.StageID != "" {
			st := s.Stage(p.StageID)
			if st == nil {
				return unknown("stage", p.StageID, e)
			}
			st.Messages = append(st.Messages, m)
			st.LastAISeq = e.Seq
		} else {
			t := s.Threads[p.ThreadID]
			if t == nil {
				return unknown("thread", p.ThreadID, e)
			}
			t.Messages = append(t.Messages, m)
			t.LastAISeq = e.Seq
		}
		s.questionCount++
		s.optionCount += len(p.Options)
	case EvQuestionAnswered:
		p, err := decode[QuestionAnswered](e)
		if err != nil {
			return err
		}
		t, st, m := s.Question(p.QuestionID)
		if m == nil {
			return unknown("question", p.QuestionID, e)
		}
		q := m.Question
		q.Answer = &QuestionAnswer{OptionID: p.OptionID, Other: p.Other}
		answer := Message{Actor: ActorUser, Text: AnswerMessage(q, *q.Answer), Seq: e.Seq, AnswerTo: q.ID}
		if st != nil {
			st.Messages = append(st.Messages, answer)
			st.LastUserSeq = e.Seq
		} else {
			t.userAnswer(answer)
		}
	case EvQuestionWithdrawn:
		p, err := decode[QuestionWithdrawn](e)
		if err != nil {
			return err
		}
		t, st, m := s.Question(p.QuestionID)
		if m == nil {
			return unknown("question", p.QuestionID, e)
		}
		m.Question.Withdrawn = true
		if st != nil {
			st.LastAISeq = e.Seq
		} else {
			t.LastAISeq = e.Seq
		}
	case EvSessionEndRequested:
		s.EndRequested = true
	case EvAgentDelivered:
		p, err := decode[AgentDelivered](e)
		if err != nil {
			return err
		}
		s.Delivered = p.UpTo
		s.waitCount++
	case EvProcessStarted:
		p, err := decode[ProcessStarted](e)
		if err != nil {
			return err
		}
		t := s.Threads[p.ThreadID]
		if t == nil {
			return unknown("thread", p.ThreadID, e)
		}
		if s.Processes == nil {
			s.Processes = map[string]*Process{}
		}
		s.Processes[p.ID] = &Process{
			ID: p.ID, ThreadID: p.ThreadID, PID: p.PID, Cmd: p.Cmd, Out: p.Out,
			Status: ProcessRunning, Seq: e.Seq, StartedAt: e.TS.UnixMilli(),
		}
		s.processCount++
		t.LastAISeq = e.Seq
	case EvProcessExited:
		p, err := decode[ProcessExitedPayload](e)
		if err != nil {
			return err
		}
		proc := s.Process(p.ID)
		if proc == nil {
			return unknown("process", p.ID, e)
		}
		code := p.ExitCode
		proc.Status, proc.ExitCode = ProcessExited, &code
		// A later re-record of the real code keeps the earlier (daemon) detection time.
		if proc.ExitedAt == 0 {
			proc.ExitedAt = e.TS.UnixMilli()
		}
		// Only the agent's own `process end` counts as an AI reply; a daemon-detected exit does not.
		if t := s.Threads[proc.ThreadID]; t != nil && e.Actor == ActorAI {
			t.LastAISeq = e.Seq
		}
	default:
		return fmt.Errorf("event %d: unknown event type %q", e.Seq, e.Type)
	}
	return nil
}

// userMessage records user activity in the thread; empty text only bumps LastUserSeq.
func (t *Thread) userMessage(text string, seq int64) {
	if text != "" {
		t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: text, Seq: seq})
	}
	t.LastUserSeq = seq
}

// userReview records one thread's part of a review. Each comment keeps the review's seq, and a
// part with comments is a user message even without text, so the UI can head it "N line comments".
func (t *Thread) userReview(rt ReviewThread, seq int64) {
	for _, c := range rt.Comments {
		t.Comments = append(t.Comments, ThreadComment{LineComment: c, Seq: seq})
	}
	for _, c := range rt.MessageComments {
		t.MessageComments = append(t.MessageComments, ThreadMessageComment{MessageComment: c, Seq: seq})
	}
	if len(rt.Comments) == 0 && len(rt.MessageComments) == 0 {
		t.userMessage(rt.Message, seq)
		return
	}
	t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: rt.Message, Seq: seq})
	t.LastUserSeq = seq
}

// userChoice records a variant choice as a user message, with or without a comment.
func (t *Thread) userChoice(text string, choice MessageChoice, seq int64) {
	t.Messages = append(t.Messages, Message{Actor: ActorUser, Text: text, Seq: seq, Choice: &choice})
	t.LastUserSeq = seq
}

// userAnswer records a question's answer as a user message that names the question, so the page
// can link back to it (demo 6 follow-ups 1), like userChoice names the chosen option.
func (t *Thread) userAnswer(m Message) {
	t.Messages = append(t.Messages, m)
	t.LastUserSeq = m.Seq
}

func (t *Thread) resolve(conclusion string, seq int64) {
	t.Status, t.Conclusion, t.ProposedConclusion, t.EditedByUser, t.LastUserSeq = ThreadResolved, conclusion, "", false, seq
}
