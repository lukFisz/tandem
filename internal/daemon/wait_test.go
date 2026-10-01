package daemon

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lukFisz/tandem/internal/domain"
	"github.com/lukFisz/tandem/internal/store"
)

func (e *testEnv) setupThread(sid string) {
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
}

func (e *testEnv) userMessage(sid, text string) {
	e.t.Helper()
	code, out := e.do("POST", "/api/sessions/"+sid+"/actions",
		`{"type":"review.submit","data":{"threads":[{"threadId":"t_1","message":"`+text+`"}]}}`)
	if code != 200 {
		e.t.Fatalf("action: %d %s", code, out)
	}
}

// tryUserMessage is userMessage's non-fatal counterpart, safe to call from a goroutine (see
// testEnv.tryDo): it reports failure through the returned error instead of calling t.Fatal.
func (e *testEnv) tryUserMessage(sid, text string) error {
	code, out, err := e.tryDo("POST", "/api/sessions/"+sid+"/actions",
		`{"type":"review.submit","data":{"threads":[{"threadId":"t_1","message":"`+text+`"}]}}`)
	if err != nil {
		return err
	}
	if code != 200 {
		return fmt.Errorf("action: %d %s", code, out)
	}
	return nil
}

// Final review finding 1(a): /wait changes state (marks events delivered, supersedes the
// previous waiter) as a side effect of a GET, so unlike other GET routes it must accept only a
// Bearer token — the SameSite=Strict cookie alone (which a same-site page on another local port
// can still send) must not be enough to start a wait.
func TestWaitRejectsCookieOnlyAuth(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	req, err := http.NewRequest("GET", e.hs.URL+"/api/sessions/"+sid+"/wait?timeout=100ms", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "tandem_token", Value: e.token})
	resp, err := e.hs.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cookie-only wait: %d, want 401", resp.StatusCode)
	}
}

// Final review finding 5: with the guide's "exit 3 → wait again", a closed session would make
// an agent loop forever (wait always times out on a closed session, never resolves). The daemon
// must instead answer immediately with the domain session_closed error.
func TestWaitOnClosedSessionReturnsSessionClosedImmediately(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	if code, out := e.command(sid, "session.close", `{}`); code != 200 {
		e.t.Fatalf("session.close: %d %s", code, out)
	}
	start := time.Now()
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=5s", "")
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("wait on closed session took %s, want immediate", elapsed)
	}
	if code != http.StatusBadRequest || !strings.Contains(out, `"code":"session_closed"`) {
		t.Fatalf("wait on closed session: %d %s", code, out)
	}
}

func TestWaitReturnsPendingEventsOnce(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	e.userMessage(sid, "hello")
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=2s", "")
	if code != 200 || !strings.Contains(out, "## t_1 \"T\" — message") || !strings.Contains(out, "> hello") {
		t.Fatalf("wait: %d %s", code, out)
	}
	if code, _ := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=100ms", ""); code != 204 {
		t.Fatalf("second wait should time out, got %d", code)
	}
}

func TestWaitWakesOnNewEventAndJSONFormat(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	msgErr := make(chan error, 1)
	go func() {
		time.Sleep(100 * time.Millisecond)
		msgErr <- e.tryUserMessage(sid, "later")
	}()
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=5s&format=json", "")
	if code != 200 || !strings.Contains(out, `"events":[{"seq":`) || !strings.Contains(out, "later") {
		t.Fatalf("wait: %d %s", code, out)
	}
	if err := <-msgErr; err != nil {
		t.Fatal(err)
	}
}

func TestWaitSuperseded(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	type result struct {
		code int
		err  error
	}
	first := make(chan result, 1)
	go func() {
		code, _, err := e.tryDo("GET", "/api/sessions/"+sid+"/wait?timeout=5s", "")
		first <- result{code, err}
	}()
	time.Sleep(100 * time.Millisecond)
	second := make(chan result, 1)
	go func() {
		code, _, err := e.tryDo("GET", "/api/sessions/"+sid+"/wait?timeout=300ms", "")
		second <- result{code, err}
	}()
	r := <-first
	if r.err != nil {
		t.Fatal(r.err)
	}
	if r.code != http.StatusConflict {
		t.Fatalf("first wait got %d, want 409", r.code)
	}
	if r := <-second; r.err != nil {
		t.Fatal(r.err)
	}
}

// Review Focus 5: a wait whose client went away must not mark events delivered.
func TestWaitDisconnectDoesNotDeliver(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.hs.URL+"/api/sessions/"+sid+"/wait?timeout=5s", nil)
	req.Header.Set("Authorization", "Bearer secret")
	e.hs.Client().Do(req) // returns when ctx expires
	time.Sleep(50 * time.Millisecond)
	e.userMessage(sid, "after disconnect")
	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=2s", "")
	if code != 200 || !strings.Contains(out, "after disconnect") {
		t.Fatalf("event lost: %d %s", code, out)
	}
}

// Review Focus 5 (deterministic, handler-level): pending user events already exist and the
// request context is already cancelled before the handler ever runs. The plan's
// TestWaitDisconnectDoesNotDeliver above never has pending events during the disconnected wait,
// so it does not by itself exercise the ctx.Err() guard in wait(); this test does.
func TestWaitHandlerDoesNotDeliverOnAlreadyCancelledContext(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	e.userMessage(sid, "pending before disconnect")

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled before the handler runs
	req := httptest.NewRequest("GET", "/api/sessions/"+sid+"/wait?timeout=2s", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.SetPathValue("sid", sid)
	rec := httptest.NewRecorder()

	e.srv.wait(rec, req)

	// The request context was cancelled by the client going away (not by a superseding wait), so
	// the handler must answer 503 daemon_stopping — never an empty 200 — while still leaving the
	// events undelivered.
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d (daemon_stopping)", rec.Code, http.StatusServiceUnavailable)
	}

	sess, err := e.srv.mgr.Get(sid)
	if err != nil {
		t.Fatal(err)
	}
	var delivered, last int64
	sess.Read(func(st *domain.State, _ []domain.Event) { delivered, last = st.Delivered, st.LastSeq })
	if delivered >= last {
		t.Fatalf("event marked delivered despite cancelled request context: delivered=%d last=%d", delivered, last)
	}

	code, out := e.do("GET", "/api/sessions/"+sid+"/wait?timeout=2s", "")
	if code != 200 || !strings.Contains(out, "pending before disconnect") {
		t.Fatalf("event lost: %d %s", code, out)
	}
}

// Review round 1, finding 1: when ctx is cancelled because another `tdm wait` superseded this one
// (ErrWaitSuperseded, not a plain client disconnect) and pending events exist at the same time,
// the handler must still answer 409 wait_superseded per spec §6 — never an empty 200 — and must
// not mark those events delivered.
func TestWaitHandlerRespondsSupersededWithPendingEvents(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.setupThread(sid)
	e.userMessage(sid, "pending during supersede")

	sess, err := e.srv.mgr.Get(sid)
	if err != nil {
		t.Fatal(err)
	}
	// BeginWait/end simulates a first waiter that a second BeginWait call then supersedes,
	// producing an ErrWaitSuperseded-caused context — exactly what wait() would hand itself if a
	// second `tdm wait` arrived while this one was still deciding what to write.
	ctx, end := sess.BeginWait(context.Background())
	defer end()
	_, end2 := sess.BeginWait(context.Background()) // supersedes the first wait
	defer end2()

	req := httptest.NewRequest("GET", "/api/sessions/"+sid+"/wait?timeout=2s", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.SetPathValue("sid", sid)
	rec := httptest.NewRecorder()

	e.srv.wait(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (wait_superseded)", rec.Code, http.StatusConflict)
	}
	if !strings.Contains(rec.Body.String(), "wait_superseded") {
		t.Fatalf("body = %s, want wait_superseded", rec.Body.String())
	}

	var delivered, last int64
	sess.Read(func(st *domain.State, _ []domain.Event) { delivered, last = st.Delivered, st.LastSeq })
	if delivered >= last {
		t.Fatalf("event marked delivered despite superseded wait: delivered=%d last=%d", delivered, last)
	}
}

func TestStreamSendsSnapshots(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.hs.URL+"/api/sessions/"+sid+"/stream", nil)
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := e.hs.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	readData := func() string {
		for sc.Scan() {
			if line := sc.Text(); strings.HasPrefix(line, "data: ") {
				return line
			}
		}
		t.Fatal("stream ended")
		return ""
	}
	if first := readData(); !strings.Contains(first, `"waiting":false`) {
		t.Fatalf("first snapshot: %s", first)
	}
	e.command(sid, "stage.add", `{"title":"Streamed"}`)
	if next := readData(); !strings.Contains(next, "Streamed") {
		t.Fatalf("next snapshot: %s", next)
	}
}

func TestRunWritesInfoAndStopsWhenIdle(t *testing.T) {
	home := t.TempDir()
	done := make(chan error, 1)
	go func() {
		done <- Run(context.Background(), Config{Home: home, Version: "v1", IdleTimeout: 200 * time.Millisecond})
	}()
	deadline := time.Now().Add(2 * time.Second)
	var info store.DaemonInfo
	var err error
	for time.Now().Before(deadline) {
		if info, err = store.ReadDaemonInfo(home); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || info.Port == 0 || len(info.Token) < 32 || info.Version != "v1" {
		t.Fatalf("daemon info = %+v, %v", info, err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("daemon did not stop when idle")
	}
	if _, err := store.ReadDaemonInfo(home); err == nil {
		t.Fatal("daemon.json should be removed on exit")
	}
}
