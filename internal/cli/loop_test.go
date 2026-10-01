package cli

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

func TestWaitLogExport(t *testing.T) {
	home := startDaemon(t)
	sid := newSession(t)
	must(t, "", "stage", "add", "A")
	must(t, "", "thread", "add", "T")
	must(t, "a := 1\nb := 2\n", "block", "add", "code", "--lang", "go")
	userAction(t, home, sid, "review.submit",
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":2,"end":2},"text":"why b?"},`+
			`{"blockId":"b_1","lines":{"start":1,"end":2},"quote":"1\nb :=","text":"split?"}]}]}`)

	out := must(t, "", "wait", "--timeout", "2s")
	for _, part := range []string{"## t_1 \"T\" — review submitted", "Comment on b_1, lines 2:", "b := 2", "> why b?",
		"Comment on b_1, lines 1-2:\n```go\n1\nb :=\n```\n> split?"} {
		if !strings.Contains(out, part) {
			t.Fatalf("missing %q in wait output:\n%s", part, out)
		}
	}
	out, _, code := run(t, "", "wait", "--timeout", "200ms")
	if code != 3 || out != "No events (timeout). Run tdm wait again.\n" {
		t.Fatalf("timeout: code %d, out %q", code, out)
	}
	out, _, code = run(t, "", "--json", "wait", "--timeout", "100ms")
	if code != 3 || !strings.Contains(out, `"timeout": true`) {
		t.Fatalf("json timeout: code %d, out %q", code, out)
	}

	if lines := strings.Split(strings.TrimSpace(must(t, "", "log")), "\n"); len(lines) != 6 {
		t.Fatalf("log has %d lines", len(lines))
	}
	if lines := strings.Split(strings.TrimSpace(must(t, "", "log", "--since", "4")), "\n"); len(lines) != 2 {
		t.Fatalf("log --since 4 has %d lines", len(lines))
	}

	if out := must(t, "", "export", "--out", "docs/decisions.md"); out != "wrote docs/decisions.md\n" {
		t.Fatalf("export = %q", out)
	}
	data, _ := os.ReadFile("docs/decisions.md")
	if string(data) != "# Test\n\n_Stage 1 \"A\" — not yet accepted._\n" {
		t.Fatalf("export file = %q", data)
	}
}

func TestDaemonStatusAndStop(t *testing.T) {
	home := startDaemon(t)
	if out := must(t, "", "daemon", "status"); !strings.HasPrefix(out, "daemon running: pid ") || !strings.Contains(out, "version test") {
		t.Fatalf("status = %q", out)
	}
	if out := must(t, "", "daemon", "stop"); out != "daemon stopped\n" {
		t.Fatalf("stop = %q", out)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := store.ReadDaemonInfo(home); err != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("daemon.json still present after stop")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if out := must(t, "", "daemon", "status"); out != "daemon not running\n" {
		t.Fatalf("status after stop = %q", out)
	}
}

// Final review finding 4: `tdm daemon stop`'s /api/shutdown handler answers 200 and then stops
// the server asynchronously (api.go's `go s.stop()`), so the process is still holding
// daemon.lock for a little while after the HTTP response comes back. `tdm daemon stop` itself
// must wait (bounded) for that exit before returning, so a caller that runs `tdm daemon stop`
// then immediately starts a new daemon never races the old one for the lock.
func TestDaemonStopWaitsForProcessExit(t *testing.T) {
	home := startDaemon(t)
	if out := must(t, "", "daemon", "stop"); out != "daemon stopped\n" {
		t.Fatalf("stop = %q", out)
	}
	f, err := os.OpenFile(filepath.Join(home, "daemon.lock"), os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatalf("daemon.lock still held right after `tdm daemon stop` returned: %v", err)
	}
	syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}
