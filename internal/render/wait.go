package render

import (
	"fmt"
	"strings"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

type section struct{ stageID, text string }

// Wait renders user events grouped by stage (in first-appearance order), then session-level
// events, and ends every TipEvery-th `tdm wait` return with a Tip line.
func Wait(s *domain.State, events []domain.Event, blobs BlobReader) (string, error) {
	out, err := Events(s, events, blobs)
	if err != nil {
		return "", err
	}
	if tip := Tip(s.WaitCount()); tip != "" {
		out += "\n" + tip
	}
	return out, nil
}

// Events renders user events grouped by stage (in first-appearance order), then session-level
// events, without a Tip line: what `tdm session show` lists under "Awaiting AI".
func Events(s *domain.State, events []domain.Event, blobs BlobReader) (string, error) {
	var order []string
	byStage := map[string][]string{}
	var sessionLevel []string
	for _, e := range events {
		secs, err := eventSections(s, e, blobs)
		if err != nil {
			return "", err
		}
		for _, sec := range secs {
			if sec.stageID == "" {
				sessionLevel = append(sessionLevel, sec.text)
				continue
			}
			if _, seen := byStage[sec.stageID]; !seen {
				order = append(order, sec.stageID)
			}
			byStage[sec.stageID] = append(byStage[sec.stageID], sec.text)
		}
	}
	var parts []string
	for _, id := range order {
		parts = append(parts, stageHeader(s, s.Stage(id)))
		parts = append(parts, byStage[id]...)
	}
	parts = append(parts, sessionLevel...)
	return strings.Join(parts, "\n"), nil
}

func stageHeader(s *domain.State, st *domain.Stage) string {
	resolved := 0
	for _, id := range st.ThreadIDs {
		if s.Threads[id].Status == domain.ThreadResolved {
			resolved++
		}
	}
	return fmt.Sprintf("# Stage %s %q — %d/%d threads resolved\n", st.ID, st.Title, resolved, len(st.ThreadIDs))
}

func threadSection(s *domain.State, threadID, what string, items ...string) section {
	t := s.Threads[threadID]
	return section{stageID: t.StageID, text: fmt.Sprintf("## %s %q — %s\n\n", t.ID, t.Title, what) + strings.Join(items, "\n")}
}

// stageSection is a stage page event: "Stage st_N — what", or "Stage summary — what" while a
// summary is proposed, since the user then writes about the summary (part E). stageID must exist.
func stageSection(s *domain.State, stageID, what, body string) section {
	st := s.Stage(stageID)
	head := fmt.Sprintf("## Stage %s — %s", st.ID, what)
	if st.Status == domain.StageSummaryProposed {
		head = "## Stage summary — " + what
	}
	return section{st.ID, head + "\n\n" + body}
}

// nextStep is the agent's next move after the user accepted stageID's summary (stage summary
// flow, part B): continue in the stage that already follows it, or add one or say there is
// nothing more. It reads the state tdm wait renders from, so a stage added before the wait
// returned counts.
func nextStep(s *domain.State, stageID string) string {
	for i, st := range s.Stages {
		if st.ID == stageID && i+1 < len(s.Stages) {
			return fmt.Sprintf("Next: continue in %s (already created).\n", s.Stages[i+1].ID)
		}
	}
	return fmt.Sprintf("Next: add the next stage (`tdm stage add`), or tell the user you have nothing more (`tdm say --stage %s \"…\"`), then `tdm wait`.\n", stageID)
}

func eventSections(s *domain.State, e domain.Event, blobs BlobReader) ([]section, error) {
	switch e.Type {
	case domain.EvReviewSubmitted:
		var p domain.ReviewSubmitted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		var out []section
		for _, rt := range p.Threads {
			var items []string
			for _, c := range rt.Comments {
				item, err := commentItem(s, c, blobs)
				if err != nil {
					return nil, err
				}
				items = append(items, item)
			}
			for _, c := range rt.MessageComments {
				items = append(items, commentOnMessage(c))
			}
			if rt.Message != "" {
				items = append(items, "Message:\n"+Quote(rt.Message))
			}
			what := "review submitted"
			if len(rt.Comments) == 0 && len(rt.MessageComments) == 0 {
				what = "message"
			}
			out = append(out, threadSection(s, rt.ThreadID, what, items...))
		}
		return out, nil
	case domain.EvVariantChosen:
		var p domain.VariantChosen
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		opt := s.Blocks[p.BlockID].Variants.Option(p.OptionID)
		item := fmt.Sprintf("Chose %s %q (block %s)", opt.ID, opt.Title, p.BlockID)
		what := "variant chosen"
		if p.Conclusion != "" {
			// Choose & resolve: the comment is already folded into the final conclusion below
			// (see ChooseVariant/domain), so quoting it here too would show it twice
			// (final review Minor #2). Just close the item; the comment appears once, in
			// "Final conclusion".
			item += ".\n"
			what = "variant chosen, thread resolved"
			item += "\nFinal conclusion:\n" + Quote(p.Conclusion)
		} else if p.Comment != "" {
			item += ":\n" + Quote(p.Comment)
		} else {
			item += ".\n"
		}
		return []section{threadSection(s, p.ThreadID, what, item)}, nil
	case domain.EvVariantsRejected:
		var p domain.VariantsRejected
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "all variants rejected",
			fmt.Sprintf("Rejected all options in block %s:\n", p.BlockID)+Quote(p.Comment))}, nil
	case domain.EvQuestionAnswered:
		var p domain.QuestionAnswered
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		_, _, m := s.Question(p.QuestionID)
		if m == nil {
			return nil, fmt.Errorf("answer to unknown question %s", p.QuestionID)
		}
		head := fmt.Sprintf("Answered %s %q", p.QuestionID, m.Text)
		var item string
		if p.Other != "" {
			item = head + " with their own answer:\n" + Quote(p.Other)
		} else {
			o := m.Question.Option(p.OptionID)
			if o == nil {
				return nil, fmt.Errorf("question %s has no option %s", p.QuestionID, p.OptionID)
			}
			item = fmt.Sprintf("%s: %s %q.\n", head, o.ID, o.Title)
		}
		if p.StageID != "" {
			return []section{stageSection(s, p.StageID, "question answered", item)}, nil
		}
		return []section{threadSection(s, p.ThreadID, "question answered", item)}, nil
	case domain.EvConclusionAccepted:
		var p domain.ConclusionAccepted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "conclusion accepted", "Accepted as proposed.\n"+Quote(p.Text))}, nil
	case domain.EvConclusionEdited:
		var p domain.ConclusionEdited
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "conclusion edited and accepted", "Final conclusion:\n"+Quote(p.Text))}, nil
	case domain.EvConclusionRevised:
		var p domain.ConclusionRevised
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "conclusion edited", "Your proposal was replaced with:\n"+Quote(p.Text))}, nil
	case domain.EvConclusionDiscussionRequested:
		var p domain.ConclusionDiscussionRequested
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{threadSection(s, p.ThreadID, "discussion requested", Quote(p.Comment))}, nil
	case domain.EvSummaryRevised:
		var p domain.SummaryRevised
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		return []section{{p.StageID, "## Stage summary — edited\n\nYour proposal was replaced with:\n" + Quote(p.Text)}}, nil
	case domain.EvMessagePosted:
		var p domain.MessagePosted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		if s.Stage(p.StageID) == nil {
			return nil, fmt.Errorf("message on unknown stage %q", p.StageID)
		}
		return []section{stageSection(s, p.StageID, "message", Quote(p.Text))}, nil
	case domain.EvStageSummaryAccepted:
		var p domain.StageSummaryAccepted
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		body := "## Stage summary — accepted\n\nAccepted as proposed.\n"
		if p.Original != "" {
			body = "## Stage summary — edited and accepted\n\nFinal summary:\n" + Quote(p.Text)
		}
		return []section{{p.StageID, body + "\n" + nextStep(s, p.StageID)}}, nil
	case domain.EvProcessExited:
		var p domain.ProcessExitedPayload
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		proc := s.Process(p.ID)
		cmd := p.ID
		dur := ""
		if proc != nil {
			cmd = proc.Cmd
			if proc.ExitedAt > proc.StartedAt {
				d := time.Duration(proc.ExitedAt-proc.StartedAt) * time.Millisecond
				dur = " · " + d.Round(time.Millisecond).String()
			}
		}
		item := fmt.Sprintf("process exited %s: exit %d%s · `%s`\n", p.ID, p.ExitCode, dur, cmd)
		return []section{threadSection(s, p.ThreadID, "process exited", item)}, nil
	case domain.EvSessionEndRequested:
		var p domain.SessionEndRequested
		if err := e.Decode(&p); err != nil {
			return nil, err
		}
		text := "# Session — end requested\n"
		if p.Comment != "" {
			text += "\n" + Quote(p.Comment)
		}
		return []section{{"", text}}, nil
	}
	return nil, nil
}

// commentItem quotes the commented lines from the block snapshot (or just the selected text, when
// the comment has one), then the user's comment.
func commentItem(s *domain.State, c domain.LineComment, blobs BlobReader) (string, error) {
	b := s.Blocks[c.BlockID]
	if b == nil {
		return "", fmt.Errorf("comment on unknown block %s", c.BlockID)
	}
	text := b.Text
	if b.BlobSHA != "" {
		data, err := blobs(b.BlobSHA)
		if err != nil {
			return "", fmt.Errorf("block %s: %w", b.ID, err)
		}
		text = string(data)
	}
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	from, to := c.Lines.Start-b.FirstLine, c.Lines.End-b.FirstLine+1
	if from < 0 || to > len(lines) {
		return "", fmt.Errorf("comment lines %s outside block %s", c.Lines, b.ID)
	}
	where := "lines " + c.Lines.String()
	if b.Path != "" {
		where = fmt.Sprintf("`%s:%s`", b.Path, c.Lines)
	}
	head := fmt.Sprintf("Comment on %s, %s:\n", b.ID, where)
	if c.Quote != "" {
		// The selection is rendered text for markdown and notes, so it is not source.
		lang := b.Lang
		if b.Kind == domain.KindMarkdown || b.Kind == domain.KindNote {
			lang = "text"
		}
		return head + Fence(lang, c.Quote) + Quote(c.Text), nil
	}
	lang := b.Lang
	if b.Kind == domain.KindNote {
		lang = "markdown"
	}
	return head + Fence(lang, strings.Join(lines[from:to], "\n")) + Quote(c.Text), nil
}

// commentOnMessage renders a note on a chat message: the selected text, if any, then the note.
func commentOnMessage(c domain.MessageComment) string {
	head := fmt.Sprintf("Comment on message %d:\n", c.MessageSeq)
	if c.Quote != "" {
		head += Fence("text", c.Quote)
	}
	return head + Quote(c.Text)
}
