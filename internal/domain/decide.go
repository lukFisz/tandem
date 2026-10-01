package domain

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

type Result struct {
	ID        string   `json:"id,omitempty"`
	OptionIDs []string `json:"optionIds,omitempty"`
}

// Decide validates cmd against s and returns the unsequenced events it produces.
// Every error it returns is a *Error.
func Decide(s *State, cmd Command) ([]Event, Result, error) {
	if s.Session.Status == SessionClosed {
		return nil, Result{}, SessionClosedError(s.Session.ID)
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
		if c.StageID != "" {
			if c.ThreadID != "" {
				return nil, Result{}, errorf(CodeInvalidInput, "pass --thread or --stage, not both", "say goes to a thread or a stage, not both")
			}
			return decideStageMessage(s, ActorAI, c.StageID, c.Text)
		}
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
		return one(NewEvent(ActorAI, EvSessionClosed, SessionClosedPayload{}), s.Session.ID)
	case *SubmitReview:
		return decideReview(s, c)
	case *ChooseVariant:
		return decideVariantAction(s, c.BlockID, func(t *Thread, b *Block) (Event, error) {
			opt := b.Variants.Option(c.OptionID)
			if opt == nil {
				return Event{}, errorf(CodeOptionNotFound, "option ids are listed in block "+b.ID, "no option %s in block %s", c.OptionID, b.ID)
			}
			p := VariantChosen{ThreadID: t.ID, BlockID: b.ID, OptionID: c.OptionID, Comment: c.Comment}
			if c.Resolve {
				p.Conclusion = choiceConclusion(opt.Title, c.Comment)
			}
			return NewEvent(ActorUser, EvVariantChosen, p), nil
		})
	case *RejectVariants:
		return decideVariantAction(s, c.BlockID, func(t *Thread, b *Block) (Event, error) {
			if err := required("comment", c.Comment); err != nil {
				return Event{}, err
			}
			return NewEvent(ActorUser, EvVariantsRejected, VariantsRejected{ThreadID: t.ID, BlockID: b.ID, Comment: c.Comment}), nil
		})
	case *ResolveThread:
		if err := required("threadId", c.ThreadID); err != nil {
			return nil, Result{}, err
		}
		t, err := s.activeThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		text := c.Text
		if strings.TrimSpace(text) == "" {
			text = UserResolvedText
		}
		// Reuses conclusion.edited: the agent reads it as "conclusion edited and accepted". A
		// conclusion proposed meanwhile is kept as the original (Review Focus 3).
		return one(NewEvent(ActorUser, EvConclusionEdited, ConclusionEdited{ThreadID: t.ID, Original: t.ProposedConclusion, Text: text}), t.ID)
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
	case *ReviseConclusion:
		t, err := s.proposedThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		if err := sameProposal(c.BaseVersion, t.ProposalVersion); err != nil {
			return nil, Result{}, err
		}
		text, err := revisedText(c.Text, t.ProposedConclusion)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvConclusionRevised, ConclusionRevised{ThreadID: t.ID, Text: text}), t.ID)
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
		p := StageSummaryAccepted{StageID: st.ID, Text: st.ProposedSummary}
		// Mirrors conclusion.edited: an edit keeps the proposal as the original (Review Focus 3).
		if text := strings.TrimSpace(c.Text); text != "" && text != strings.TrimSpace(st.ProposedSummary) {
			p.Text, p.Original = text, st.ProposedSummary
		}
		return one(NewEvent(ActorUser, EvStageSummaryAccepted, p), st.ID)
	case *ReviseStageSummary:
		st, err := s.proposedStage(c.StageID)
		if err != nil {
			return nil, Result{}, err
		}
		if err := sameProposal(c.BaseVersion, st.ProposalVersion); err != nil {
			return nil, Result{}, err
		}
		text, err := revisedText(c.Text, st.ProposedSummary)
		if err != nil {
			return nil, Result{}, err
		}
		return one(NewEvent(ActorUser, EvSummaryRevised, SummaryRevised{StageID: st.ID, Text: text}), st.ID)
	case *PostStageMessage:
		if err := required("stageId", c.StageID); err != nil {
			return nil, Result{}, err
		}
		return decideStageMessage(s, ActorUser, c.StageID, c.Text)
	case *EndSession:
		return one(NewEvent(ActorUser, EvSessionEndRequested, SessionEndRequested{Comment: c.Comment}), s.Session.ID)
	case *Ask:
		return decideAsk(s, c)
	case *WithdrawQuestion:
		t, st, m, err := s.openQuestion(c.QuestionID, true)
		if err != nil {
			return nil, Result{}, err
		}
		p := QuestionWithdrawn{QuestionID: m.Question.ID}
		p.ThreadID, p.StageID = questionPlace(t, st)
		return one(NewEvent(ActorAI, EvQuestionWithdrawn, p), m.Question.ID)
	case *AnswerQuestion:
		return decideAnswer(s, c)
	case *StartProcess:
		return decideStartProcess(s, c)
	case *EndProcess:
		return decideEndProcess(s, c)
	}
	return nil, Result{}, errorf(CodeInvalidCommand, "", "unsupported command %T", cmd)
}

func one(e Event, id string) ([]Event, Result, error) { return []Event{e}, Result{ID: id}, nil }

// sameProposal rejects a Save made against an older proposal: the AI re-proposed while the user was
// editing (or while the Save was in flight), and the Save would replace a version they have not
// read. A base of 0 (a caller that does not send one) skips the check.
func sameProposal(base, current int) error {
	if base != 0 && base != current {
		return errorf(CodeProposalChanged, "read the new proposal, then edit it again", "the AI proposed a new version while you were editing")
	}
	return nil
}

// revisedText checks the user's Save over a proposal (stage summary flow, part C): the text is
// required, stored trimmed, and must differ from the current proposal. An unchanged text is
// rejected, so the log never records a Save that changed nothing.
func revisedText(text, proposed string) (string, error) {
	if err := required("text", text); err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == strings.TrimSpace(proposed) {
		return "", errorf(CodeTextUnchanged, "change the text, or accept the proposal as it is", "the text is the same as the current proposal")
	}
	return text, nil
}

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
	if c.Content != "" || c.Diff != "" {
		return c, errorf(CodeInvalidInput, "", "content must be stored as a blob before deciding")
	}
	switch c.Kind {
	case KindNote:
		if err := required("text", c.Text); err != nil {
			return c, err
		}
		c.FirstLine, c.LineCount = 1, CountLines(c.Text)
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
		return nil, Result{}, errorf(CodeInvalidInput, "annotate code, file, markdown or note blocks", "block %s (%s) cannot be annotated", b.ID, b.Kind)
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

// decideStageMessage posts a message on a stage page, from the AI (`tdm say --stage`) or the user.
// Any stage takes messages, an accepted one too: that is where the AI wraps up and the user
// answers (stage summary flow spec, parts B and E).
func decideStageMessage(s *State, actor Actor, stageID, text string) ([]Event, Result, error) {
	st := s.Stage(stageID)
	if st == nil {
		return nil, Result{}, errorf(CodeStageNotFound, hintShow, "no stage %s in session %s", stageID, s.Session.ID)
	}
	if err := required("text", text); err != nil {
		return nil, Result{}, err
	}
	return one(NewEvent(actor, EvMessagePosted, MessagePosted{StageID: st.ID, Text: text}), st.ID)
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
	return one(NewEvent(ActorAI, EvStageSummaryProposed, StageSummaryProposedPayload{StageID: st.ID, Text: c.Text}), st.ID)
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
		if len(rt.Comments) == 0 && len(rt.MessageComments) == 0 && strings.TrimSpace(rt.Message) == "" {
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
			if cm.Quote == "" {
				continue
			}
			if err := checkQuote(cm.Quote); err != nil {
				return nil, Result{}, err
			}
			// A file block's text is a blob the daemon checks (QuoteInLines); markdown and note
			// quotes come from rendered text, which differs from the source.
			if b.Kind == KindCode && !QuoteInLines(b.Text, b.FirstLine, cm.Lines, cm.Quote) {
				return nil, Result{}, QuoteNotFound(b.ID, cm.Lines)
			}
		}
		for _, mc := range rt.MessageComments {
			if !t.hasMessage(mc.MessageSeq) {
				return nil, Result{}, errorf(CodeInvalidInput, "", "thread %s has no message %d", t.ID, mc.MessageSeq)
			}
			if err := required("quote", mc.Quote); err != nil {
				return nil, Result{}, err
			}
			if err := checkQuote(mc.Quote); err != nil {
				return nil, Result{}, err
			}
			if err := required("comment text", mc.Text); err != nil {
				return nil, Result{}, err
			}
		}
	}
	return one(NewEvent(ActorUser, EvReviewSubmitted, ReviewSubmitted{Threads: c.Threads}), "")
}

// MaxQuote is the longest quote, in characters, a comment may carry.
const MaxQuote = 2000

func checkQuote(q string) error {
	if strings.TrimSpace(q) == "" {
		return errorf(CodeInvalidInput, "", "quote is empty")
	}
	if n := utf8.RuneCountInString(q); n > MaxQuote {
		return errorf(CodeInvalidInput, "", "quote is %d characters; the limit is %d", n, MaxQuote)
	}
	return nil
}

// QuoteInLines reports whether quote occurs in lines r of a block whose text starts at line first.
func QuoteInLines(text string, first int, r LineRange, quote string) bool {
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	from, to := r.Start-first, r.End-first+1
	if from < 0 || to > len(lines) || from >= to {
		return false
	}
	return strings.Contains(strings.Join(lines[from:to], "\n"), quote)
}

// QuoteNotFound is the error for a quote that is not in the lines it is anchored to.
func QuoteNotFound(blockID string, r LineRange) error {
	return errorf(CodeInvalidInput, "", "quote does not occur in lines %s of block %s", r, blockID)
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

// decideAsk asks in a thread, or on a stage page with StageID. Any stage takes a question, an
// accepted one too, like stage messages (demo 7 follow-ups 6).
func decideAsk(s *State, c *Ask) ([]Event, Result, error) {
	var threadID, stageID string
	if c.StageID != "" {
		if c.ThreadID != "" {
			return nil, Result{}, errorf(CodeInvalidInput, "pass --thread or --stage, not both", "a question goes to a thread or a stage, not both")
		}
		st := s.Stage(c.StageID)
		if st == nil {
			return nil, Result{}, errorf(CodeStageNotFound, hintShow, "no stage %s in session %s", c.StageID, s.Session.ID)
		}
		stageID = st.ID
	} else {
		t, err := s.activeThread(c.ThreadID)
		if err != nil {
			return nil, Result{}, err
		}
		threadID = t.ID
	}
	if err := required("question", c.Text); err != nil {
		return nil, Result{}, err
	}
	if n := len(c.Options); n < 2 || n > 4 {
		return nil, Result{}, errorf(CodeInvalidInput, "pass 2 to 4 --option flags", "a question needs 2 to 4 options, got %d", n)
	}
	id := FormatID("q", s.questionCount+1)
	res := Result{ID: id}
	opts := make([]QuestionOption, len(c.Options))
	for i, title := range c.Options {
		if err := required(fmt.Sprintf("option %d", i+1), title); err != nil {
			return nil, Result{}, err
		}
		opts[i] = QuestionOption{ID: FormatID("o", s.optionCount+i+1), Title: title}
		res.OptionIDs = append(res.OptionIDs, opts[i].ID)
	}
	e := NewEvent(ActorAI, EvQuestionAsked, QuestionAsked{ThreadID: threadID, StageID: stageID, QuestionID: id, Text: c.Text, Options: opts})
	return []Event{e}, res, nil
}

func decideAnswer(s *State, c *AnswerQuestion) ([]Event, Result, error) {
	t, st, m, err := s.openQuestion(c.QuestionID, false)
	if err != nil {
		return nil, Result{}, err
	}
	if t != nil {
		if _, err := s.activeThread(t.ID); err != nil {
			return nil, Result{}, err
		}
	}
	if (c.OptionID == "") == (c.Other == "") {
		return nil, Result{}, errorf(CodeInvalidInput, "", "answer with exactly one of optionId or other")
	}
	q := m.Question
	p := QuestionAnswered{QuestionID: q.ID}
	p.ThreadID, p.StageID = questionPlace(t, st)
	if c.OptionID != "" {
		if q.Option(c.OptionID) == nil {
			return nil, Result{}, errorf(CodeOptionNotFound, "option ids are listed in question "+q.ID, "no option %s in question %s", c.OptionID, q.ID)
		}
		p.OptionID = c.OptionID
	} else {
		if err := required("other", c.Other); err != nil {
			return nil, Result{}, err
		}
		p.Other = strings.TrimSpace(c.Other)
	}
	return one(NewEvent(ActorUser, EvQuestionAnswered, p), q.ID)
}

// questionPlace returns the thread id or the stage id a question event carries.
func questionPlace(t *Thread, st *Stage) (threadID, stageID string) {
	if t != nil {
		return t.ID, ""
	}
	return "", st.ID
}

func decideStartProcess(s *State, c *StartProcess) ([]Event, Result, error) {
	t, err := s.activeThread(c.ThreadID)
	if err != nil {
		return nil, Result{}, err
	}
	if err := required("cmd", c.Cmd); err != nil {
		return nil, Result{}, err
	}
	if c.PID <= 0 {
		return nil, Result{}, errorf(CodeInvalidInput, "", "pid must be a positive process id")
	}
	id := FormatID("p", s.processCount+1)
	return one(NewEvent(ActorAI, EvProcessStarted, ProcessStarted{ID: id, ThreadID: t.ID, PID: c.PID, Cmd: strings.TrimSpace(c.Cmd), Out: strings.TrimSpace(c.Out)}), id)
}

func decideEndProcess(s *State, c *EndProcess) ([]Event, Result, error) {
	if err := required("id", c.ID); err != nil {
		return nil, Result{}, err
	}
	if c.ExitCode < 0 {
		return nil, Result{}, errorf(CodeInvalidInput, "", "exit code must be 0 or positive")
	}
	p := s.Process(c.ID)
	if p == nil {
		return nil, Result{}, errorf(CodeProcessNotFound, "process ids are printed by `tdm process start`", "no process %s in session %s", c.ID, s.Session.ID)
	}
	if p.Status != ProcessRunning && !p.ExitUnknown() {
		return nil, Result{}, errorf(CodeProcessExited, "", "process %s has already exited", c.ID)
	}
	actor := ActorAI
	if c.Supervised {
		actor = ActorSystem
	}
	return one(NewEvent(actor, EvProcessExited, ProcessExitedPayload{ID: p.ID, ThreadID: p.ThreadID, ExitCode: c.ExitCode}), p.ID)
}

// choiceConclusion is the conclusion of a thread the user resolves by choosing a variant.
func choiceConclusion(title, comment string) string {
	if c := strings.TrimSpace(comment); c != "" {
		return title + "\n\n" + c
	}
	return title
}
