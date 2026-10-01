package cli

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// When TANDEM_CLI_TEST_AS_TDM is set the test binary acts as tdm itself, so `tdm process run` can re-exec
// it into `tdm process supervise` (selfExecutable is the test binary under go test).
func TestMain(m *testing.M) {
	if os.Getenv("TANDEM_CLI_TEST_AS_TDM") == "1" {
		os.Exit(Execute("test", os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
	}
	os.Exit(m.Run())
}

type logEvent struct {
	Type  string `json:"type"`
	Actor string `json:"actor"`
	Data  struct {
		ID       string `json:"id"`
		ExitCode int    `json:"exitCode"`
	} `json:"data"`
}

// waitExited polls tdm log until process id has a process.exited event.
func waitExited(t *testing.T, id string) logEvent {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		sc := bufio.NewScanner(strings.NewReader(must(t, "", "log")))
		sc.Buffer(nil, 1<<20)
		for sc.Scan() {
			var e logEvent
			if json.Unmarshal(sc.Bytes(), &e) == nil && e.Type == "process.exited" && e.Data.ID == id {
				return e
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no process.exited event for %s", id)
	return logEvent{}
}

func setupProcessRun(t *testing.T) string {
	t.Helper()
	startDaemon(t)
	t.Setenv("TANDEM_CLI_TEST_AS_TDM", "1")
	newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	return t.TempDir()
}

func TestProcessRun(t *testing.T) {
	dir := setupProcessRun(t)
	out := filepath.Join(dir, "out.txt")
	if got := must(t, "", "process", "run", "--out", out, "--", "sh", "-c", "echo hi; echo err >&2; exit 3"); got != "p_1 "+out+"\n" {
		t.Fatalf("run = %q", got)
	}
	e := waitExited(t, "p_1")
	// A supervised end is a system event, so it wakes tdm wait.
	if e.Data.ExitCode != 3 || e.Actor != "system" {
		t.Fatalf("exit event = %+v", e)
	}
	b, err := os.ReadFile(out)
	if err != nil || !strings.Contains(string(b), "hi\n") || !strings.Contains(string(b), "err\n") {
		t.Fatalf("out = %q, %v", b, err)
	}
	wait := must(t, "", "wait", "--timeout", "5s")
	if !strings.Contains(wait, "process exited p_1: exit 3") || !strings.Contains(wait, "`sh -c 'echo hi; echo err >&2; exit 3'`") {
		t.Fatalf("wait = %q", wait)
	}
}

func TestProcessRunCommandNotFound(t *testing.T) {
	dir := setupProcessRun(t)
	out := filepath.Join(dir, "out.txt")
	must(t, "", "process", "run", "--out", out, "--", "definitely-not-a-command-xyz")
	if e := waitExited(t, "p_1"); e.Data.ExitCode != 127 {
		t.Fatalf("exit event = %+v", e)
	}
	b, _ := os.ReadFile(out)
	if !strings.Contains(string(b), "tdm: ") || !strings.Contains(string(b), "definitely-not-a-command-xyz") {
		t.Fatalf("out = %q", b)
	}
}

func TestProcessRunJSON(t *testing.T) {
	dir := setupProcessRun(t)
	out := filepath.Join(dir, "out.txt")
	var got map[string]string
	if err := json.Unmarshal([]byte(must(t, "", "--json", "process", "run", "--out", out, "--thread", "t_1", "--", "true")), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got["id"] != "p_1" || got["out"] != out {
		t.Fatalf("json = %v", got)
	}
	if e := waitExited(t, "p_1"); e.Data.ExitCode != 0 {
		t.Fatalf("exit event = %+v", e)
	}
}

func TestProcessRunUsage(t *testing.T) {
	dir := setupProcessRun(t)
	out := filepath.Join(dir, "out.txt")
	for _, args := range [][]string{
		{"process", "run", "--out", out, "true"},
		{"process", "run", "--out", out, "--"},
		{"process", "run", "--out", out},
		{"process", "run", "--out", out, "x", "--", "true"},
		{"process", "run", "--", "true"},
	} {
		if _, errOut, code := run(t, "", args...); code != 2 || !strings.Contains(errOut, "error: usage:") {
			t.Errorf("tdm %s: %d %q", strings.Join(args, " "), code, errOut)
		}
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatalf("usage errors must not start anything: %v", err)
	}
}

func TestProcessRunKilledBySignal(t *testing.T) {
	dir := setupProcessRun(t)
	must(t, "", "process", "run", "--out", filepath.Join(dir, "out.txt"), "--", "sh", "-c", "kill -TERM $$")
	if e := waitExited(t, "p_1"); e.Data.ExitCode != 143 {
		t.Fatalf("exit event = %+v", e)
	}
}

func TestShellJoin(t *testing.T) {
	for _, c := range []struct {
		args []string
		want string
	}{
		{[]string{"go", "test", "./..."}, "go test ./..."},
		{[]string{"sh", "-c", "echo out; sleep 1"}, "sh -c 'echo out; sleep 1'"},
		{[]string{"echo", "it's"}, `echo 'it'\''s'`},
		{[]string{"printf", ""}, "printf ''"},
	} {
		if got := shellJoin(c.args); got != c.want {
			t.Errorf("shellJoin(%q) = %s, want %s", c.args, got, c.want)
		}
	}
}
