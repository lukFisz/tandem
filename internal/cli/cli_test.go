package cli

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lukFisz/tandem/internal/daemon"
	"github.com/lukFisz/tandem/internal/store"
)

// startDaemon runs an in-process daemon with version "test" and chdirs into an empty project dir.
func startDaemon(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	home, proj := filepath.Join(root, "home"), filepath.Join(root, "proj")
	os.MkdirAll(proj, 0o700)
	t.Setenv("TANDEM_HOME", home)
	t.Setenv("TANDEM_NO_BROWSER", "1")
	t.Setenv("TANDEM_SESSION", "")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- daemon.Run(ctx, daemon.Config{Home: home, Version: "test", IdleTimeout: time.Hour}) }()
	t.Cleanup(func() { cancel(); <-done })
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := store.ReadDaemonInfo(home); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("daemon did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Chdir(proj)
	return home
}

func run(t *testing.T, stdin string, args ...string) (string, string, int) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Execute("test", args, strings.NewReader(stdin), &out, &errOut)
	return out.String(), errOut.String(), code
}

func must(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	out, errOut, code := run(t, stdin, args...)
	if code != 0 {
		t.Fatalf("tdm %s: exit %d\n%s", strings.Join(args, " "), code, errOut)
	}
	return out
}

func newSession(t *testing.T) string {
	t.Helper()
	return strings.Fields(must(t, "", "session", "new", "Test"))[0]
}

// userAction posts a browser action straight to the daemon.
func userAction(t *testing.T, home, sid, typ, data string) {
	t.Helper()
	info, err := store.ReadDaemonInfo(home)
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"type":%q,"data":%s}`, typ, data)
	req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/api/sessions/%s/actions", info.Port, sid), strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+info.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("user action %s: %v %v", typ, resp, err)
	}
	resp.Body.Close()
}
