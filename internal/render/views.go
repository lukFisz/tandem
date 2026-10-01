package render

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/lukFisz/tandem/internal/domain"
)

// Show renders the session overview plus the user input the AI has not acted on yet.
func Show(s *domain.State, events []domain.Event, blobs BlobReader) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "# Session %s %q — %s\n", s.Session.ID, s.Session.Title, s.Session.Status)
	if len(s.Stages) == 0 {
		b.WriteString("\nNo stages yet. Add one with `tdm stage add \"<title>\"`.\n")
	}
	for _, st := range s.Stages {
		status := human(st.Status)
		if st.AwaitingAI() {
			status += ", awaiting AI"
		}
		fmt.Fprintf(&b, "\n## Stage %s %q — %s\n", st.ID, st.Title, status)
		if st.Goal != "" {
			fmt.Fprintf(&b, "Goal: %s\n", st.Goal)
		}
		for _, id := range st.ThreadIDs {
			b.WriteString(threadLine(s.Threads[id]))
		}
		b.WriteString(openQuestions(st.Messages, ""))
		switch st.Status {
		case domain.StageSummaryProposed:
			b.WriteString("Proposed summary:\n" + Quote(st.ProposedSummary))
		case domain.StageAccepted:
			b.WriteString("Summary:\n" + Quote(st.Summary))
		}
	}
	if s.EndRequested {
		b.WriteString("\nThe user asked to end the session.\n")
	}
	b.WriteString("\n# Awaiting AI\n\n")
	pending := awaiting(s, events)
	if len(pending) == 0 {
		b.WriteString("Nothing. Run `tdm wait` for new user events.\n")
		return b.String(), nil
	}
	w, err := Events(s, pending, blobs)
	if err != nil {
		return "", err
	}
	b.WriteString(w)
	return b.String(), nil
}

// human turns a snake_case status constant into space-separated text.
func human[T ~string](status T) string {
	return strings.ReplaceAll(string(status), "_", " ")
}

func threadLine(t *domain.Thread) string {
	line := fmt.Sprintf("- %s %q — %s", t.ID, t.Title, human(t.Status))
	if t.AwaitingAI() {
		line += ", awaiting AI"
	}
	switch t.Status {
	case domain.ThreadResolved:
		line += "\n  Conclusion: " + firstLine(t.Conclusion)
	case domain.ThreadConclusionProposed:
		line += "\n  Proposed: " + firstLine(t.ProposedConclusion)
	}
	return line + "\n" + openQuestions(t.Messages, "  ")
}

// openQuestions lists the open questions among msgs, one "Open question:" line each.
func openQuestions(msgs []domain.Message, indent string) string {
	var out string
	for _, m := range msgs {
		if q := m.Question; q != nil && q.Open() {
			out += indent + "Open question: " + q.ID + " " + strconv.Quote(firstLine(m.Text)) + "\n"
		}
	}
	return out
}

func firstLine(s string) string {
	line, rest, _ := strings.Cut(strings.TrimSpace(s), "\n")
	if rest != "" {
		line += " …"
	}
	return line
}

// awaiting returns user events the AI has not acted on: thread events newer than the thread's last
// AI action, stage messages newer than the stage's, and session/stage events newer than the AI's
// last action anywhere.
func awaiting(s *domain.State, events []domain.Event) []domain.Event {
	var out []domain.Event
	for _, e := range events {
		if e.Actor != domain.ActorUser {
			continue
		}
		// A stage message, or the answer to a stage question, awaits the AI until the AI acts in
		// that stage (part E, Review Focus 2), not until it acts anywhere, as other stage- and
		// session-level events do below.
		ids := domain.EventThreadIDs(s, e)
		if e.Type == domain.EvMessagePosted || (e.Type == domain.EvQuestionAnswered && len(ids) == 0) {
			if st := s.Stage(domain.EventStageID(s, e)); st != nil && st.AwaitingAI() && e.Seq > st.LastAISeq {
				out = append(out, e)
			}
			continue
		}
		if len(ids) == 0 {
			if e.Seq > s.LastAISeq {
				out = append(out, e)
			}
			continue
		}
		for _, id := range ids {
			if t := s.Threads[id]; t != nil && t.AwaitingAI() && e.Seq > t.LastAISeq {
				out = append(out, e)
				break
			}
		}
	}
	return out
}

// Summarize lists the thread conclusions of a stage: the input for the AI's stage summary.
func Summarize(s *domain.State, stageID string) (string, error) {
	st, err := pickStage(s, stageID)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# Stage %s %q — thread conclusions\n", st.ID, st.Title)
	for _, id := range st.ThreadIDs {
		t := s.Threads[id]
		if t.Status == domain.ThreadResolved {
			fmt.Fprintf(&b, "\n## %s %q\n%s\n", t.ID, t.Title, strings.TrimRight(t.Conclusion, "\n"))
		} else {
			fmt.Fprintf(&b, "\n## %s %q — not resolved (%s)\n", t.ID, t.Title, human(t.Status))
		}
	}
	return b.String(), nil
}

// pickStage resolves an explicit stage id, or, when empty, the latest stage that is not
// accepted, falling back to the last stage. It duplicates the default-stage logic of
// domain/resolve.go because that logic is unexported.
func pickStage(s *domain.State, id string) (*domain.Stage, error) {
	if id != "" {
		if st := s.Stage(id); st != nil {
			return st, nil
		}
		return nil, &domain.Error{Code: domain.CodeStageNotFound, Message: "no stage " + id,
			Hint: "run `tdm session show` to list stages"}
	}
	for i := len(s.Stages) - 1; i >= 0; i-- {
		if s.Stages[i].Status != domain.StageAccepted {
			return s.Stages[i], nil
		}
	}
	if len(s.Stages) > 0 {
		return s.Stages[len(s.Stages)-1], nil
	}
	return nil, &domain.Error{Code: domain.CodeNoOpenStage, Message: "session has no stages",
		Hint: "add one with `tdm stage add \"<title>\"`"}
}

// Export is the decision document: the session title and every accepted stage summary.
func Export(s *domain.State, stageID string) (string, error) {
	if stageID != "" && s.Stage(stageID) == nil {
		return "", &domain.Error{Code: domain.CodeStageNotFound, Message: "no stage " + stageID,
			Hint: "run `tdm session show` to list stages"}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n", s.Session.Title)
	for i, st := range s.Stages {
		if stageID != "" && st.ID != stageID {
			continue
		}
		if st.Status == domain.StageAccepted {
			fmt.Fprintf(&b, "\n## %d. %s\n%s\n", i+1, st.Title, nestHeadings(strings.TrimRight(st.Summary, "\n"), 3))
		} else {
			fmt.Fprintf(&b, "\n_Stage %d %q — not yet accepted._\n", i+1, st.Title)
		}
	}
	return b.String(), nil
}

// nestHeadings shifts the ATX headings of md down so the shallowest one is at least at level
// (capped at ######), keeping their relative depth. Export uses it so a summary's own "## …"
// headings sit under the stage's "## N. Title". Lines inside fenced code blocks are left alone.
func nestHeadings(md string, level int) string {
	lines := strings.Split(md, "\n")
	levels := make([]int, len(lines))
	shallowest := 7
	fence := ""
	for i, line := range lines {
		t := strings.TrimLeft(line, " ")
		if len(line)-len(t) > 3 {
			continue
		}
		if fence != "" {
			if strings.HasPrefix(t, fence) {
				fence = ""
			}
			continue
		}
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			fence = t[:3]
			continue
		}
		n := len(t) - len(strings.TrimLeft(t, "#"))
		if n >= 1 && n <= 6 && (len(t) == n || t[n] == ' ' || t[n] == '\t') {
			levels[i] = n
			shallowest = min(shallowest, n)
		}
	}
	shift := level - shallowest
	if shift <= 0 {
		return md
	}
	for i, n := range levels {
		if n > 0 {
			t := strings.TrimLeft(lines[i], " ")
			lines[i] = strings.Repeat("#", min(n+shift, 6)) + t[n:]
		}
	}
	return strings.Join(lines, "\n")
}
