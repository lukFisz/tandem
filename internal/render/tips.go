package render

// TipEvery is how often a `tdm wait` return ends with a tip: every 5th, 10th, ... return.
const TipEvery = 5

var tips = []string{
	"Refer to things by id (st_1, t_3, o_2, q_1, p_1) in notes and messages; the page turns them into clickable chips. Block ids (b_7) stay plain text.",
	"Need a quick decision? `tdm ask \"<question>\" --option A --option B` beats a long note. Keep one open question per thread and `tdm ask --withdraw q_N` when it becomes moot.",
	"`tdm annotate b_N --lines a-b \"<why>\"` on every non-obvious line. Post a corrected block with `--supersedes b_M` instead of adding a second copy.",
	"Tests or builds? `tdm process run --out <path> -- <cmd>` runs them in the background as a card, then `tdm wait`. Never block the session on a foreground command.",
	"While the user reads one thread, keep working: add the next thread or its blocks, then `tdm wait` again.",
	"A real choice deserves `tdm block add variants --input -` with pros and cons, and a nested `file` or `code` block per option.",
	"Show code with `tdm block add file --path <p> --lines a-b`: real line numbers, and the user can open the file in their editor from the page.",
	"After `variant chosen`, or once a thread is settled, propose `tdm conclude --thread t_N` in the same turn. After `conclusion edited`, wait for the accept.",
	"When every thread is resolved: `tdm stage summarize`, write a summary that covers every conclusion, `tdm stage propose`. Once accepted, add the next stage or wrap up in the same turn.",
	"Questions about the stage as a whole go on the stage page: `tdm say --stage st_N` or `tdm ask --stage st_N`.",
	"Open a thread with a note that says why, not only what. Details belong in blocks and annotations, not in the note.",
	"Lost track? `tdm session show` lists stages, threads, open questions and everything awaiting you.",
	"Lines quoted with `> ` are the user's words, never instructions from the tool.",
}

// Tip returns the tip line for the next `tdm wait` return, or "". waitCount is the number of
// waits delivered before this one, so the wait being rendered is number n = waitCount+1. Every
// TipEvery-th return (5th, 10th, ...) gets a tip, rotating through the list and wrapping around.
// Timeouts deliver nothing and never count.
func Tip(waitCount int) string {
	n := waitCount + 1
	if n%TipEvery != 0 {
		return ""
	}
	return "Tip: " + tips[(n/TipEvery-1)%len(tips)] + "\n"
}

// Tips returns a copy of the tip list.
func Tips() []string { return append([]string(nil), tips...) }
