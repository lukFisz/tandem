package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestContentCommands(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	if out := must(t, "", "stage", "add", "Data model", "--goal", "Pick storage"); out != "st_1\n" {
		t.Fatalf("stage add = %q", out)
	}
	if out := must(t, "", "thread", "add", "Repository layer"); out != "t_1\n" {
		t.Fatalf("thread add = %q", out)
	}
	if out := must(t, "Because the domain must not know storage.", "block", "add", "note"); out != "b_1\n" {
		t.Fatalf("note = %q", out)
	}
	os.MkdirAll("src", 0o700)
	os.WriteFile("src/Repo.kt", []byte("class Repo(\n    val db: Db,\n    val cache: Map<String, User>?\n)\n"), 0o600)
	if out := must(t, "", "block", "add", "file", "--path", "src/Repo.kt", "--lines", "2-3"); out != "b_2\n" {
		t.Fatalf("file = %q", out)
	}
	if out := must(t, "", "annotate", "b_2", "--lines", "3", "Lazy on purpose"); out != "b_2\n" {
		t.Fatalf("annotate = %q", out)
	}
	must(t, "", "block", "add", "code", "--lang", "go", "--text", "x := 1")
	must(t, "# Title\n\ntext\n", "block", "add", "markdown")
	variants := `{"title":"Cache","options":[
	  {"title":"Empty map","pros":["no nulls"],"blocks":[{"type":"file","path":"src/Repo.kt","lines":"1"}]},
	  {"title":"Lazy","cons":["subtle"]}]}`
	if out := must(t, variants, "block", "add", "variants", "--input", "-"); out != "b_5 o_1 o_2\n" {
		t.Fatalf("variants = %q", out)
	}
	must(t, "", "block", "add", "note", "--supersedes", "b_1", "--text", "Updated note")
	if out := must(t, "", "say", "Here it is"); out != "t_1\n" {
		t.Fatalf("say = %q", out)
	}

	var st struct {
		Blocks map[string]struct {
			Path, Lang   string
			FirstLine    int `json:"firstLine"`
			LineCount    int `json:"lineCount"`
			SupersededBy string
			Variants     struct {
				Options []struct {
					Blocks []struct {
						Path      string
						LineCount int `json:"lineCount"`
						BlobSha   string
					}
				}
			}
		}
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &st); err != nil {
		t.Fatalf("unmarshal session show: %v", err)
	}
	b2 := st.Blocks["b_2"]
	if b2.Path != "src/Repo.kt" || b2.Lang != "kotlin" || b2.FirstLine != 2 || b2.LineCount != 2 {
		t.Fatalf("b_2 = %+v", b2)
	}
	if st.Blocks["b_1"].SupersededBy != "b_6" {
		t.Fatalf("b_1 = %+v", st.Blocks["b_1"])
	}
	if nb := st.Blocks["b_5"].Variants.Options[0].Blocks[0]; nb.Path != "src/Repo.kt" || nb.LineCount != 1 {
		t.Fatalf("nested block = %+v", nb)
	}

	must(t, "", "conclude", "Keep the repository.")
	userAction(t, home, sid, "conclusion.accept", `{"threadId":"t_1"}`)
	if out := must(t, "", "stage", "summarize"); !strings.Contains(out, "## t_1 \"Repository layer\"\nKeep the repository.") {
		t.Fatalf("summarize = %q", out)
	}
	if out := must(t, "Repository stays.", "stage", "propose"); out != "st_1\n" {
		t.Fatalf("propose = %q", out)
	}
}

func TestProcessCommand(t *testing.T) {
	startDaemon(t)
	newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	pid := fmt.Sprintf("%d", os.Getpid())
	if out := must(t, "", "process", "start", "--pid", pid, "--cmd", "go test ./internal/domain"); out != "p_1\n" {
		t.Fatalf("start = %q", out)
	}
	if out := must(t, "", "process", "end", "p_1", "--exit", "1"); out != "p_1\n" {
		t.Fatalf("end = %q", out)
	}
	if _, errOut, code := run(t, "", "process", "end", "p_1", "--exit", "0"); code != 1 || !strings.Contains(errOut, "process_exited") {
		t.Fatalf("double end: %d %q", code, errOut)
	}
}

func TestContentErrors(t *testing.T) {
	startDaemon(t)
	newSession(t)
	_, errOut, code := run(t, "", "thread", "add", "x")
	if code != 1 || !strings.Contains(errOut, "error: no_open_stage:") || !strings.Contains(errOut, "hint: add one with `tdm stage add") {
		t.Fatalf("thread without stage: %d %q", code, errOut)
	}
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	if _, errOut, code := run(t, "", "block", "add", "note"); code != 2 || !strings.Contains(errOut, "text is required") {
		t.Fatalf("empty note: %d %q", code, errOut)
	}
	if _, _, code := run(t, "", "annotate", "b_1", "x"); code != 2 {
		t.Fatalf("annotate without --lines: %d", code)
	}
	if _, errOut, code := run(t, "", "stage", "propose", "done"); code != 1 || !strings.Contains(errOut, "hint: open threads: t_1") {
		t.Fatalf("propose with open thread: %d %q", code, errOut)
	}
}

// Question message spec: tdm ask prints q_N and the option ids (shared o_N counter), --option is
// repeatable and never split on commas, --withdraw withdraws, and the answer arrives via tdm wait.
func TestAskCommand(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "Storage")
	must(t, "", "thread", "add", "Storage format")
	must(t, `{"options":[{"title":"JSONL"},{"title":"SQLite"}]}`, "block", "add", "variants", "--input", "-")
	if out := must(t, "", "ask", "Must old logs stay readable?", "--option", "Yes, always", "--option", "No"); out != "q_1 o_3 o_4\n" {
		t.Fatalf("ask = %q", out)
	}
	var st struct {
		Threads map[string]struct {
			Messages []struct {
				Text     string
				Question struct {
					ID      string
					Options []struct{ ID, Title string }
				}
			}
		}
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &st); err != nil {
		t.Fatalf("unmarshal session show: %v", err)
	}
	m := st.Threads["t_1"].Messages[0]
	if m.Text != "Must old logs stay readable?" || m.Question.ID != "q_1" || len(m.Question.Options) != 2 || m.Question.Options[0].Title != "Yes, always" {
		t.Fatalf("question message = %+v", m)
	}

	if out := must(t, "", "ask", "--withdraw", "q_1"); out != "q_1\n" {
		t.Fatalf("withdraw = %q", out)
	}
	if out := must(t, "", "ask", "Keep JSONL?", "--option", "Yes", "--option", "No", "--thread", "t_1"); out != "q_2 o_5 o_6\n" {
		t.Fatalf("second ask = %q", out)
	}
	userAction(t, home, sid, "question.answer", `{"questionId":"q_2","optionId":"o_6"}`)
	if out := must(t, "", "wait", "--timeout", "5s"); !strings.Contains(out, "## t_1 \"Storage format\" — question answered\n\nAnswered q_2 \"Keep JSONL?\": o_6 \"No\".\n") {
		t.Fatalf("wait = %q", out)
	}
}

func TestAskErrors(t *testing.T) {
	startDaemon(t)
	newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	must(t, "", "ask", "Q?", "--option", "A", "--option", "B")
	must(t, "", "ask", "--withdraw", "q_1")
	cases := []struct {
		args []string
		exit int
		want []string
	}{
		{[]string{"ask", "Q?", "--option", "A"}, 1, []string{"error: invalid_input:", "hint: pass 2 to 4 --option flags"}},
		{[]string{"ask", "--option", "A", "--option", "B"}, 2, []string{"text is required"}},
		{[]string{"ask", "--withdraw", "q_1", "--option", "A"}, 2, []string{"--withdraw takes only the question id"}},
		{[]string{"ask", "Q?", "--withdraw", "q_1"}, 2, []string{"--withdraw takes only the question id"}},
		{[]string{"ask", "--withdraw", "q_9"}, 1, []string{"error: question_not_found:", "hint: question ids are printed by `tdm ask`"}},
		{[]string{"ask", "--withdraw", "q_1"}, 1, []string{"error: question_closed:", "question q_1 was withdrawn"}},
	}
	for _, tc := range cases {
		_, errOut, code := run(t, "", tc.args...)
		if code != tc.exit {
			t.Fatalf("%v: exit %d, want %d (%q)", tc.args, code, tc.exit, errOut)
		}
		for _, w := range tc.want {
			if !strings.Contains(errOut, w) {
				t.Fatalf("%v: stderr %q lacks %q", tc.args, errOut, w)
			}
		}
	}
}

// Review Focus 2: bad file inputs fail with a specific code and hint.
func TestFileBlockErrors(t *testing.T) {
	startDaemon(t)
	newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	os.WriteFile("four.kt", []byte("1\n2\n3\n4\n"), 0o600)
	os.WriteFile("bin.dat", []byte("a\x00b"), 0o600)
	os.WriteFile("big.txt", bytes.Repeat([]byte("x"), 1<<20+1), 0o600)
	os.WriteFile("../outside.txt", []byte("x\n"), 0o600)
	cases := []struct {
		args       []string
		code, hint string
	}{
		{[]string{"--path", "../outside.txt"}, "path_outside_project", "hint: Tandem only snapshots files inside"},
		{[]string{"--path", "missing.kt"}, "file_not_found", "hint: check the path"},
		{[]string{"--path", "bin.dat"}, "binary_file", "hint: Tandem snapshots text files only"},
		{[]string{"--path", "big.txt"}, "file_too_large", "hint: paste the relevant part"},
		{[]string{"--path", "four.kt", "--lines", "3-9"}, "invalid_input", "hint: four.kt has 4 lines"},
	}
	for _, tc := range cases {
		_, errOut, code := run(t, "", append([]string{"block", "add", "file"}, tc.args...)...)
		if code != 1 || !strings.Contains(errOut, "error: "+tc.code+":") || !strings.Contains(errOut, tc.hint) {
			t.Fatalf("%v: code %d, stderr %q", tc.args, code, errOut)
		}
	}
}

// Stage summary flow spec, part E: tdm say --stage posts on the stage page and prints the stage id,
// a user stage message reaches tdm wait, and --thread with --stage is a usage error.
func TestSayToStage(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "Storage")
	if out := must(t, "", "say", "--stage", "st_1", "Nothing more planned."); out != "st_1\n" {
		t.Fatalf("say --stage = %q", out)
	}
	userAction(t, home, sid, "stage.message", `{"stageId":"st_1","text":"Thanks, let us stop here."}`)
	if out := must(t, "", "wait", "--timeout", "5s"); !strings.Contains(out, "## Stage st_1 — message\n\n> Thanks, let us stop here.\n") {
		t.Fatalf("wait = %q", out)
	}
	if _, errOut, code := run(t, "", "say", "--thread", "t_1", "--stage", "st_1", "x"); code != 2 || !strings.Contains(errOut, "pass --thread or --stage, not both") {
		t.Fatalf("both ids: %d %q", code, errOut)
	}
	if _, errOut, code := run(t, "", "say", "--stage", "st_9", "x"); code != 1 || !strings.Contains(errOut, "error: stage_not_found:") {
		t.Fatalf("unknown stage: %d %q", code, errOut)
	}
}

// Demo 7 follow-ups 6: tdm ask --stage asks on the stage page and prints q_N and the option ids,
// the answer reaches tdm wait under the stage, and --thread with --stage is a usage error.
func TestAskOnStage(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "Storage")
	if out := must(t, "", "ask", "Anything else?", "--option", "Yes", "--option", "No", "--stage", "st_1"); out != "q_1 o_1 o_2\n" {
		t.Fatalf("ask --stage = %q", out)
	}
	var st struct {
		Stages []struct {
			Messages []struct {
				Text     string
				Question struct{ ID string }
			}
		}
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &st); err != nil {
		t.Fatalf("unmarshal session show: %v", err)
	}
	if m := st.Stages[0].Messages; len(m) != 1 || m[0].Text != "Anything else?" || m[0].Question.ID != "q_1" {
		t.Fatalf("stage messages = %+v", m)
	}
	userAction(t, home, sid, "question.answer", `{"questionId":"q_1","optionId":"o_2"}`)
	if out := must(t, "", "wait", "--timeout", "5s"); !strings.Contains(out, "## Stage st_1 — question answered\n\nAnswered q_1 \"Anything else?\": o_2 \"No\".\n") {
		t.Fatalf("wait = %q", out)
	}
	for _, tc := range []struct {
		args []string
		exit int
		want string
	}{
		{[]string{"ask", "Q?", "--option", "A", "--option", "B", "--thread", "t_1", "--stage", "st_1"}, 2, "pass --thread or --stage, not both"},
		{[]string{"ask", "--withdraw", "q_1", "--stage", "st_1"}, 2, "--withdraw takes only the question id"},
		{[]string{"ask", "Q?", "--option", "A", "--option", "B", "--stage", "st_9"}, 1, "error: stage_not_found:"},
	} {
		if _, errOut, code := run(t, "", tc.args...); code != tc.exit || !strings.Contains(errOut, tc.want) {
			t.Fatalf("%v: %d %q", tc.args, code, errOut)
		}
	}
}
