package guide

import (
	"strings"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

// Final review finding 3: `tdm wait` defaults to a 9-minute timeout, but Claude Code's Bash tool
// defaults to a 2-minute command timeout (max 600000 ms), so an agent that runs `tdm wait` with
// the tool's default timeout gets killed mid-wait instead of getting a clean exit-3 timeout.
// Both the guide and the skill file must tell the agent how to avoid that.
func TestGuideAndSkillMentionWaitTimeoutCap(t *testing.T) {
	if !strings.Contains(Guide, "600000") {
		t.Errorf("guide.md does not mention the 600000 ms Claude Code timeout cap")
	}
	if !strings.Contains(Guide, "--timeout") {
		t.Errorf("guide.md does not mention --timeout as the alternative")
	}
	if !strings.Contains(Skill, "600000") {
		t.Errorf("skill.md does not mention the 600000 ms Claude Code timeout cap")
	}
}

// Feature review t_7: the user can resolve threads themselves. The agent must not propose a
// conclusion after "variant chosen, thread resolved", and must recognise the default note.
func TestGuideCoversUserResolvedThreads(t *testing.T) {
	for _, s := range []string{"variant chosen, thread resolved", "do not propose a conclusion", domain.UserResolvedText} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Demo2 follow-ups 4 and 7: the agent keeps writing short ids (the page shows titles), and it must
// recognise an edited stage summary and treat the quoted text as the summary tdm export writes.
func TestGuideCoversEditedStageSummaryAndIds(t *testing.T) {
	for _, s := range []string{"Stage summary — edited and accepted", "is what `tdm export` writes", "chip with its title"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Question message spec, part A: option ids are chips too, so the agent may mention them by id.
func TestGuideMentionsOptionIds(t *testing.T) {
	for _, s := range []string{"variant options", "`o_2`", "chip with its title"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Question message spec: when to ask, one question at a time, withdrawing, and both answer forms,
// which never resolve the thread.
func TestGuideCoversQuestions(t *testing.T) {
	for _, s := range []string{
		"tdm ask",
		"tdm ask --withdraw q_N",
		"2–4 short answers, no pros and cons",
		"one question at a time per thread",
		"keep working on other threads while you wait",
		"withdraw it",
		"question answered",
		`Answered q_N "<question>": o_N "<answer>".`,
		`Answered q_N "<question>" with their own answer:`,
		"An answer never resolves the thread",
		"`q_1`",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Demo 6 follow-ups 4: the user needs the page open, so the agent lets session new open it and
// reopens it when resuming.
func TestGuideKeepsThePageOpen(t *testing.T) {
	for _, s := range []string{
		"Do not pass `--no-open` unless",
		"the user needs the page open in their browser",
		"run `tdm session show`, then `tdm open`",
		"so the user has the page in front of them",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Stage summary flow, part B: after an accepted summary the agent acts in the same turn (a new
// stage with its first thread, or a one-line wrap-up on the stage), never a silent tdm wait.
func TestGuideActsAfterAcceptedSummary(t *testing.T) {
	for _, s := range []string{"never go back to `tdm wait` silently", "`Next:`", "add its first thread", "tdm say --stage st_N"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Stage summary flow, part C: a saved edit is the user's new proposal. The agent recognises both
// sections, does not propose over the user's text, and waits for the accept.
func TestGuideCoversRevisedProposals(t *testing.T) {
	for _, s := range []string{
		"`conclusion edited`",
		"`Stage summary — edited`",
		"`Your proposal was replaced with:`",
		"That text is now the proposal",
		"unless the user asks for changes",
		"wait for the accept",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Stage summary flow spec, part E: the agent reads stage messages, answers on the stage, and
// re-proposes the summary when the user asks for changes there.
func TestGuideCoversStageMessages(t *testing.T) {
	for _, s := range []string{
		"## Stage st_N — message",
		"## Stage summary — message",
		"Answer on the stage with `tdm say --stage st_N`",
		"propose again with `tdm stage propose`",
		"[--stage st_N]",
		// Final review fix: the message line also arrives for an accepted stage.
		"(no summary pending: an open or accepted stage)",
		"A message on an accepted last stage is answered with `tdm say --stage st_N`, or by adding the next stage",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Demo 7 follow-ups 6: tdm ask --stage asks on the stage page, for the "nothing more planned" end
// state and questions about a summary; its answer arrives as a stage section.
func TestGuideCoversStageQuestions(t *testing.T) {
	for _, s := range []string{
		"[--option C --option D] [--thread t_N] [--stage st_N]",
		"`tdm ask --stage st_N`",
		"## Stage st_N — question answered",
		"## Stage summary — question answered",
		"nothing more planned",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

func TestGuideCoversProcessCards(t *testing.T) {
	for _, s := range []string{
		"`p_1`",
		"tdm process start --pid",
		"tdm process end p_N --exit",
		"process exited",
		"exit -1",
		"tdm process run --out",
		"**background**",
		"## Long-running commands",
		"Every fifth `tdm wait` ends with a `Tip:` line",
		"Do **not** run a long command",
		"**either** a user action **or** the command exiting",
	} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// The user can turn down every option of a variants block ("None of these"). The agent must
// recognise the event and know to supersede the block or discuss first.
func TestGuideCoversRejectedVariants(t *testing.T) {
	for _, s := range []string{"`all variants rejected`", "--supersedes b_N"} {
		if !strings.Contains(Guide, s) {
			t.Errorf("guide.md does not mention %q", s)
		}
	}
}

// Notes on selected text: tdm wait shows the quote alone, and message comments name the message by seq.
func TestGuideCoversQuotedComments(t *testing.T) {
	for _, want := range []string{"selected text", "Comment on message N:"} {
		if !strings.Contains(Guide, want) {
			t.Errorf("guide.md does not mention %q", want)
		}
	}
}
