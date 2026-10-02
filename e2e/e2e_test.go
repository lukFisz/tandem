// Package e2e drives the real tdm binary, including daemon auto-start, like an agent would.
package e2e

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lukFisz/tandem/internal/store"
)

var tdmV1, tdmV2 string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "tandem-e2e")
	if err != nil {
		panic(err)
	}
	tdmV1, tdmV2 = filepath.Join(dir, "tdm"), filepath.Join(dir, "tdm-v2")
	for bin, version := range map[string]string{tdmV1: "v1", tdmV2: "v2"} {
		cmd := exec.Command("go", "build", "-ldflags", "-X main.version="+version, "-o", bin, "../cmd/tdm")
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			panic(err)
		}
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

type env struct {
	t          *testing.T
	home, proj string
}

func newEnv(t *testing.T) *env {
	root := t.TempDir()
	e := &env{t: t, home: filepath.Join(root, "home"), proj: filepath.Join(root, "proj")}
	os.MkdirAll(e.proj, 0o700)
	t.Cleanup(func() { e.tdm(tdmV1, "", "daemon", "stop") })
	return e
}

func (e *env) tdm(bin, stdin string, args ...string) (string, string, int) {
	cmd := exec.Command(bin, args...)
	cmd.Dir = e.proj
	cmd.Env = append(os.Environ(), "TANDEM_HOME="+e.home, "TANDEM_NO_BROWSER=1", "TANDEM_SESSION=")
	cmd.Stdin = strings.NewReader(stdin)
	var out, errOut strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	code := 0
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		code = ee.ExitCode()
	} else if err != nil {
		e.t.Fatal(err)
	}
	return out.String(), errOut.String(), code
}

func (e *env) must(stdin string, args ...string) string {
	e.t.Helper()
	out, errOut, code := e.tdm(tdmV1, stdin, args...)
	if code != 0 {
		e.t.Fatalf("tdm %s: exit %d\n%s", strings.Join(args, " "), code, errOut)
	}
	return out
}

func (e *env) info() store.DaemonInfo {
	e.t.Helper()
	info, err := store.ReadDaemonInfo(e.home)
	if err != nil {
		e.t.Fatal(err)
	}
	return info
}

// postAction posts a browser action exactly like the web UI (token + same-origin header),
// returning the raw status code and body so callers can check either success or rejection.
func (e *env) postAction(sid, typ, data, draft string) (int, string) {
	e.t.Helper()
	info := e.info()
	body := fmt.Sprintf(`{"type":%q,"data":%s`, typ, data)
	if draft != "" {
		body += `,"draft":` + draft
	}
	body += "}"
	origin := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
	req, _ := http.NewRequest("POST", origin+"/api/sessions/"+sid+"/actions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+info.Token)
	req.Header.Set("Origin", origin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatalf("post %s: %v", typ, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// user posts a browser action and fails the test unless it succeeds.
func (e *env) user(sid, typ, data, draft string) {
	e.t.Helper()
	if code, body := e.postAction(sid, typ, data, draft); code != 200 {
		e.t.Fatalf("user %s: %d %s", typ, code, body)
	}
}

// userRejects posts a browser action expected to be rejected by Decide, returning the status
// code and body for the caller to inspect.
func (e *env) userRejects(sid, typ, data, draft string) (int, string) {
	e.t.Helper()
	return e.postAction(sid, typ, data, draft)
}

func contains(t *testing.T, got string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(got, p) {
			t.Fatalf("missing %q in:\n%s", p, got)
		}
	}
}

func TestFullLoop(t *testing.T) {
	e := newEnv(t)
	os.MkdirAll(filepath.Join(e.proj, "src"), 0o700)
	os.WriteFile(filepath.Join(e.proj, "src", "Repo.kt"),
		[]byte("class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n"), 0o600)

	sid := strings.Fields(e.must("", "session", "new", "Implement idea ABC"))[0]
	e.must("", "stage", "add", "Data model")
	e.must("", "thread", "add", "Repository layer")
	e.must("", "block", "add", "file", "--path", "src/Repo.kt")
	e.must("", "annotate", "b_1", "--lines", "3", "Nullable because the cache is lazy.")
	if out := e.must(`{"options":[{"title":"Empty map"},{"title":"Lazy delegate"}]}`, "block", "add", "variants", "--input", "-"); out != "b_2 o_1 o_2\n" {
		t.Fatalf("variants = %q", out)
	}

	e.user(sid, "variant.choose", `{"blockId":"b_2","optionId":"o_2"}`,
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":3,"end":3},"text":"Why not an empty map?"}]}]}`)
	contains(t, e.must("", "wait", "--timeout", "5s"),
		"# Stage st_1 \"Data model\" — 0/1 threads resolved",
		"Comment on b_1, `src/Repo.kt:3`:",
		"    val cache: Map<String, User>? = null",
		"> Why not an empty map?",
		"Chose o_2 \"Lazy delegate\" (block b_2).")

	e.must("", "conclude", "Keep the repository; use a lazy delegate.")
	e.user(sid, "conclusion.accept", `{"threadId":"t_1"}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"), "conclusion accepted")
	contains(t, e.must("", "stage", "summarize"), "Keep the repository; use a lazy delegate.")

	e.must("", "stage", "propose", "Repository stays; cache is a lazy delegate.")
	e.user(sid, "stage.accept", `{"stageId":"st_1"}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"), "## Stage summary — accepted")

	e.user(sid, "session.end", `{}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"), "# Session — end requested")

	e.must("", "export", "--out", "docs/decisions.md")
	data, _ := os.ReadFile(filepath.Join(e.proj, "docs", "decisions.md"))
	if string(data) != "# Implement idea ABC\n\n## 1. Data model\nRepository stays; cache is a lazy delegate.\n" {
		t.Fatalf("export = %q", data)
	}

	e.must("", "session", "close")
	if _, errOut, code := e.tdm(tdmV1, "", "say", "late"); code != 1 || !strings.Contains(errOut, "error: session_closed:") {
		t.Fatalf("say after close: %d %q", code, errOut)
	}
	// Final review finding 5: a closed session must fail `tdm wait` immediately with
	// session_closed (exit 1), not time out (exit 3) — with the guide's "exit 3 → wait again",
	// a timeout here would make an agent loop forever.
	if _, errOut, code := e.tdm(tdmV1, "", "wait", "--timeout", "300ms"); code != 1 || !strings.Contains(errOut, "error: session_closed:") {
		t.Fatalf("wait on closed session: %d %q", code, errOut)
	}
}

func TestSecurity(t *testing.T) {
	e := newEnv(t)
	fields := strings.Fields(e.must("", "session", "new", "S"))
	sid, url := fields[0], fields[1]
	info := e.info()
	base := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	// The page link carries the page token, never the CLI token, and the page sets no cookie.
	if info.PageToken == "" || info.PageToken == info.Token || !strings.Contains(url, "?token="+info.PageToken) {
		t.Fatalf("session URL %q must carry the page token", url)
	}
	resp, err := noRedirect.Get(url)
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	if resp.StatusCode != http.StatusOK || len(resp.Cookies()) != 0 {
		t.Fatalf("page: %d %v", resp.StatusCode, resp.Cookies())
	}
	resp.Body.Close()

	// The page token cannot act as the agent.
	req, err := http.NewRequest("POST", base+"/api/sessions/"+sid+"/commands", strings.NewReader(`{"type":"say","data":{"text":"hi"}}`))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+info.PageToken)
	if resp, err = http.DefaultClient.Do(req); err != nil {
		t.Fatalf("page token on commands: %v", err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("page token on commands: %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp, err = http.Get(base + "/api/sessions/" + sid + "/state")
	if err != nil {
		t.Fatalf("no token: %v", err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d", resp.StatusCode)
	}
	resp.Body.Close()

	req, err = http.NewRequest("POST", base+"/api/sessions/"+sid+"/actions", strings.NewReader(`{"type":"session.end","data":{}}`))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+info.Token)
	req.Header.Set("Origin", "http://evil.example")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("foreign origin: %v", err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestVersionUpgradeRestartsDaemon(t *testing.T) {
	e := newEnv(t)
	e.must("", "session", "new", "S")
	before := e.info()
	if _, errOut, code := e.tdm(tdmV2, "", "session", "list"); code != 0 {
		t.Fatalf("v2 session list: %d %s", code, errOut)
	}
	after := e.info()
	if before.Version != "v1" || after.Version != "v2" || after.PID == before.PID {
		t.Fatalf("before %+v, after %+v", before, after)
	}
	e.tdm(tdmV2, "", "daemon", "stop")
}

func TestStaleDaemonInfoIsReplaced(t *testing.T) {
	e := newEnv(t)
	store.WriteDaemonInfo(e.home, store.DaemonInfo{Port: 1, PID: 999999, Version: "v1", Token: "x"})
	start := time.Now()
	e.must("", "session", "new", "S")
	if info := e.info(); info.Port == 1 || time.Since(start) > 10*time.Second {
		t.Fatalf("stale info not replaced: %+v", info)
	}
}

// TestDaemonRestartAndResume covers spec §13.4 "daemon restart and resume": a user event posted
// through the HTTP actions API but never delivered to a `tdm wait` must survive a daemon restart
// and be returned once a fresh daemon comes up (Ruling R9).
func TestDaemonRestartAndResume(t *testing.T) {
	e := newEnv(t)
	sid := strings.Fields(e.must("", "session", "new", "Resume check"))[0]
	e.must("", "stage", "add", "Data model")
	e.must("", "thread", "add", "Repository layer")

	// Post a user comment but never call `tdm wait`, so it is never marked delivered.
	e.user(sid, "review.submit", `{"threads":[{"threadId":"t_1","message":"Are we sure about this?"}]}`, "")

	portBefore := e.info().Port

	if _, errOut, code := e.tdm(tdmV1, "", "daemon", "stop"); code != 0 {
		t.Fatalf("daemon stop: %d %s", code, errOut)
	}

	// `session show` auto-starts a fresh daemon and must still list the thread as awaiting AI.
	contains(t, e.must("", "session", "show"), "t_1", "awaiting AI")

	// Residual round, Important (I2): the auto-restarted daemon must keep the same port, so a
	// browser tab (and its localStorage draft, keyed by origin) pointed at the old daemon keeps
	// working against the new one.
	if portAfter := e.info().Port; portAfter != portBefore {
		t.Fatalf("daemon restarted on port %d, want the same port %d", portAfter, portBefore)
	}

	// The undelivered user event must still come back from the next `tdm wait`.
	contains(t, e.must("", "wait", "--timeout", "5s"), "Are we sure about this?")
}

// Question message spec, through the real binary: ask, answer with an option (the draft arrives
// first), answer with Other, and withdraw.
func TestQuestionLoop(t *testing.T) {
	e := newEnv(t)
	sid := strings.Fields(e.must("", "session", "new", "Log format"))[0]
	e.must("", "stage", "add", "Storage")
	e.must("", "thread", "add", "Storage format")
	e.must("", "block", "add", "code", "--lang", "go", "--text", "type Event struct{}\n")
	if out := e.must("", "ask", "Must old logs stay readable?", "--option", "Yes", "--option", "No"); out != "q_1 o_1 o_2\n" {
		t.Fatalf("ask = %q", out)
	}
	e.user(sid, "question.answer", `{"questionId":"q_1","optionId":"o_2"}`,
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":1,"end":1},"text":"Why a struct?"}]}]}`)
	out := e.must("", "wait", "--timeout", "5s")
	contains(t, out,
		"## t_1 \"Storage format\" — review submitted",
		"> Why a struct?",
		"## t_1 \"Storage format\" — question answered\n\nAnswered q_1 \"Must old logs stay readable?\": o_2 \"No\".\n")
	if strings.Index(out, "review submitted") > strings.Index(out, "question answered") {
		t.Fatalf("the draft must come first:\n%s", out)
	}

	e.must("", "ask", "Which field holds the version?", "--option", "v", "--option", "version")
	e.user(sid, "question.answer", `{"questionId":"q_2","other":"schemaVersion"}`, "")
	contains(t, e.must("", "wait", "--timeout", "5s"),
		"Answered q_2 \"Which field holds the version?\" with their own answer:\n> schemaVersion\n")
	// An answer never resolves the thread.
	contains(t, e.must("", "session", "show"), "- t_1 \"Storage format\" — open")

	// Review Focus 3: a rejected answer (q_1 is already answered, so it is closed) with a draft
	// saves neither the draft comment nor the answer — the whole batch is atomic.
	if code, body := e.userRejects(sid, "question.answer", `{"questionId":"q_1","optionId":"o_1"}`,
		`{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":1,"end":1},"text":"Ignored, right?"}]}]}`); code != 400 || !strings.Contains(body, `"question_closed"`) {
		t.Fatalf("answer a closed question with a draft: %d %q", code, body)
	}
	if _, errOut, code := e.tdm(tdmV1, "", "wait", "--timeout", "300ms"); code != 3 {
		t.Fatalf("wait after a rejected answer: %d %q", code, errOut)
	}
	if out := e.must("", "session", "show"); strings.Contains(out, "Ignored, right?") {
		t.Fatalf("rejected draft leaked into state:\n%s", out)
	}

	if out := e.must("", "ask", "Compress old logs?", "--option", "Yes", "--option", "No"); out != "q_3 o_5 o_6\n" {
		t.Fatalf("third ask = %q", out)
	}
	if out := e.must("", "ask", "--withdraw", "q_3"); out != "q_3\n" {
		t.Fatalf("withdraw = %q", out)
	}
	if _, errOut, code := e.tdm(tdmV1, "", "ask", "--withdraw", "q_3"); code != 1 || !strings.Contains(errOut, "error: question_closed:") {
		t.Fatalf("withdraw twice: %d %q", code, errOut)
	}
}
