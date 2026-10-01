package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "out.log")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestTailLines(t *testing.T) {
	long := strings.Repeat("x", tailWindow) + "\nfirst\nsecond\n"
	// The window starts mid-way through a long line: that partial line is dropped.
	partial := strings.Repeat("y", tailWindow+100) + "\nonly\n"
	// The window is a single partial line: it is kept.
	single := strings.Repeat("z", tailWindow+100)
	cases := []struct {
		name, content, want string
	}{
		{"empty", "", ""},
		{"one line", "hello\n", "hello"},
		{"one line no newline", "hello", "hello"},
		{"five lines", "1\n2\n3\n4\n5\n", "3\n4\n5"},
		{"no trailing newline", "1\n2\n3\n4", "2\n3\n4"},
		{"crlf", "a\r\nb\r\nc\r\nd\r\n", "b\nc\nd"},
		{"long file", long, "first\nsecond"}, // the "x" line is cut by the window and dropped
		{"partial first line", partial, "only"},
		{"single partial line", single, strings.Repeat("z", tailWindow)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := tailLines(writeTemp(t, c.content), 3)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("tailLines = %q, want %q", got, c.want)
			}
		})
	}
}

func TestTailLinesMissing(t *testing.T) {
	got, err := tailLines(filepath.Join(t.TempDir(), "nope.log"), 3)
	if got != "" || !os.IsNotExist(err) {
		t.Fatalf("tailLines = %q, %v", got, err)
	}
}

// The window starts exactly at a line boundary: the first line in it is whole and kept.
func TestTailLinesWindowOnLineBoundary(t *testing.T) {
	content := strings.Repeat("x", 99) + "\n" + strings.Repeat("w", tailWindow-1) + "\n"
	got, err := tailLines(writeTemp(t, content), 3)
	if err != nil {
		t.Fatal(err)
	}
	if got != strings.Repeat("w", tailWindow-1) {
		t.Fatalf("tailLines len %d, want whole line", len(got))
	}
}

func processOutput(t *testing.T, s *Session) map[string]string {
	t.Helper()
	raw, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var snap struct {
		ProcessOutput map[string]string `json:"processOutput"`
		State         struct {
			Processes map[string]struct {
				Out string `json:"out"`
			} `json:"processes"`
		} `json:"state"`
	}
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatal(err)
	}
	if p, ok := snap.State.Processes["p_1"]; ok && p.Out == "" {
		t.Fatalf("process json has no out: %s", raw)
	}
	return snap.ProcessOutput
}

func closed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func TestPollProcessesTailsOutput(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "out.log")
	appendOut := func(text string) {
		t.Helper()
		f, err := os.OpenFile(out, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if _, err := f.WriteString(text); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Execute(&domain.AddStage{Title: "A"}, &domain.AddThread{Title: "T"},
		&domain.StartProcess{PID: os.Getpid(), Cmd: "x", Out: out}); err != nil {
		t.Fatal(err)
	}
	if got := processOutput(t, s); got != nil {
		t.Fatalf("before first poll: %v", got)
	}
	appendOut("a\nb\nc\nd\n")
	m.pollProcesses()
	if got := processOutput(t, s)["p_1"]; got != "b\nc\nd" {
		t.Fatalf("tail = %q", got)
	}

	ch := s.Changed()
	appendOut("e\n")
	m.pollProcesses()
	if !closed(ch) {
		t.Fatal("a changed tail did not notify subscribers")
	}
	if got := processOutput(t, s)["p_1"]; got != "c\nd\ne" {
		t.Fatalf("tail = %q", got)
	}

	ch = s.Changed()
	m.pollProcesses()
	if closed(ch) {
		t.Fatal("an unchanged tail notified subscribers")
	}

	if _, err := s.Execute(&domain.EndProcess{ID: "p_1", ExitCode: 0}); err != nil {
		t.Fatal(err)
	}
	appendOut("f\n")
	m.pollProcesses()
	if got := processOutput(t, s)["p_1"]; got != "d\ne\nf" {
		t.Fatalf("final tail = %q", got)
	}
	appendOut("g\n")
	ch = s.Changed()
	m.pollProcesses()
	if got := processOutput(t, s)["p_1"]; got != "d\ne\nf" {
		t.Fatalf("tail after final read = %q", got)
	}
	if closed(ch) {
		t.Fatal("a done tail notified subscribers")
	}
}
