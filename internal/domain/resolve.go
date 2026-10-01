package domain

import "fmt"

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
			// A bare `tdm say` / `tdm ask` lands here once every thread is resolved; the latest
			// stage's page is usually where the agent meant to talk (demo 7 review).
			hint := "add one with `tdm thread add \"<title>\"`"
			if n := len(s.Stages); n > 0 {
				hint += fmt.Sprintf(", or talk on the stage with `--stage %s` (`tdm say` / `tdm ask`)", s.Stages[n-1].ID)
			}
			return nil, errorf(CodeNoOpenThread, hint, "no open thread in session %s", s.Session.ID)
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

// openQuestion returns question id with its thread or stage and checks it is neither answered nor
// withdrawn: an answer is final (question message spec). forWithdraw picks the hint for an
// already-answered question: withdraw's likely cause is a race with the user's answer, which
// calls for a different hint than answer's own "already answered" case.
func (s *State) openQuestion(id string, forWithdraw bool) (*Thread, *Stage, *Message, error) {
	if err := required("questionId", id); err != nil {
		return nil, nil, nil, err
	}
	t, st, m := s.Question(id)
	if m == nil {
		return nil, nil, nil, errorf(CodeQuestionNotFound, "question ids are printed by `tdm ask`", "no question %s in session %s", id, s.Session.ID)
	}
	if m.Question.Answer != nil {
		hint := "the answer is final; ask a new question if you need more"
		if forWithdraw {
			hint = "the user already answered; read the answer with `tdm wait`"
		}
		return nil, nil, nil, errorf(CodeQuestionClosed, hint, "question %s is already answered", id)
	}
	if m.Question.Withdrawn {
		return nil, nil, nil, errorf(CodeQuestionClosed, "", "question %s was withdrawn", id)
	}
	return t, st, m, nil
}

func checkLines(b *Block, r LineRange) error {
	if r.Start < 1 || r.End < r.Start || !r.Within(b.FirstLine, b.LineCount) {
		covers := LineRange{Start: b.FirstLine, End: b.FirstLine + b.LineCount - 1}
		return errorf(CodeInvalidInput, "block "+b.ID+" covers lines "+covers.String(), "lines %s are outside block %s", r, b.ID)
	}
	return nil
}
