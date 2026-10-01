package client

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/lukFisz/tandem/internal/store"
)

func fakeDaemon(t *testing.T, version string, onShutdown func()) (*httptest.Server, store.DaemonInfo) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"version":"` + version + `"}`))
	})
	mux.HandleFunc("POST /api/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"ok":true}`))
		if onShutdown != nil {
			go onShutdown()
		}
	})
	hs := httptest.NewServer(mux)
	t.Cleanup(hs.Close)
	u, _ := url.Parse(hs.URL)
	port, _ := strconv.Atoi(u.Port())
	return hs, store.DaemonInfo{Port: port, PID: 1, Version: version, Token: "tok"}
}

func stubStart(t *testing.T, fn func(home string) error) {
	old := StartDaemon
	StartDaemon = fn
	t.Cleanup(func() { StartDaemon = old })
}

func TestConnectReusesRunningDaemon(t *testing.T) {
	home := t.TempDir()
	_, info := fakeDaemon(t, "v1", nil)
	store.WriteDaemonInfo(home, info)
	stubStart(t, func(string) error { t.Fatal("must not start a daemon"); return nil })
	c, err := Connect(context.Background(), home, "v1")
	if err != nil || c.Token() != "tok" {
		t.Fatalf("Connect = %v, %v", c, err)
	}
}

// Review Focus 3: a stale daemon.json is replaced transparently.
func TestConnectRestartsStaleDaemon(t *testing.T) {
	home := t.TempDir()
	dead, info := fakeDaemon(t, "v1", nil)
	dead.Close()
	store.WriteDaemonInfo(home, info)
	started := false
	stubStart(t, func(h string) error {
		started = true
		_, fresh := fakeDaemon(t, "v1", nil)
		return store.WriteDaemonInfo(h, fresh)
	})
	c, err := Connect(context.Background(), home, "v1")
	if err != nil || !started || c.BaseURL() == "http://127.0.0.1:"+strconv.Itoa(info.Port) {
		t.Fatalf("started=%v c=%v err=%v", started, c, err)
	}
}

func TestConnectReplacesOtherVersion(t *testing.T) {
	home := t.TempDir()
	var old *httptest.Server
	shutdown := make(chan struct{})
	old, info := fakeDaemon(t, "v0", func() { old.Close(); close(shutdown) })
	store.WriteDaemonInfo(home, info)
	stubStart(t, func(h string) error {
		_, fresh := fakeDaemon(t, "v1", nil)
		return store.WriteDaemonInfo(h, fresh)
	})
	if _, err := Connect(context.Background(), home, "v1"); err != nil {
		t.Fatal(err)
	}
	// Ruling D6: the old server's shutdown signal may arrive after Connect
	// already observed the failed health check, so wait for it with a
	// timeout instead of a non-blocking select.
	select {
	case <-shutdown:
	case <-time.After(2 * time.Second):
		t.Fatal("old daemon was not asked to shut down")
	}
}

func TestConnectGivesUp(t *testing.T) {
	old := startTimeout
	startTimeout = 200 * time.Millisecond
	t.Cleanup(func() { startTimeout = old })
	stubStart(t, func(string) error { return nil })
	_, err := Connect(context.Background(), t.TempDir(), "v1")
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "daemon_unavailable" || ae.Hint == "" {
		t.Fatalf("err = %v", err)
	}
}

// Fix round 1, controller ruling 1b: concurrent Connect calls that both need
// to auto-start must serialize on the start lock so only one of them starts
// a daemon, and every caller ends up talking to the daemon that won.
func TestConnectStartsDaemonOnceUnderConcurrency(t *testing.T) {
	home := t.TempDir()
	var startCalls int32
	stubStart(t, func(h string) error {
		atomic.AddInt32(&startCalls, 1)
		_, fresh := fakeDaemon(t, "v1", nil)
		return store.WriteDaemonInfo(h, fresh)
	})

	const n = 4
	var wg sync.WaitGroup
	clients := make([]*Client, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			clients[i], errs[i] = Connect(context.Background(), home, "v1")
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("Connect[%d] = %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&startCalls); got != 1 {
		t.Fatalf("StartDaemon called %d times, want 1", got)
	}
	for i := 1; i < n; i++ {
		if clients[i].BaseURL() != clients[0].BaseURL() {
			t.Fatalf("client %d on a different daemon: %s vs %s", i, clients[i].BaseURL(), clients[0].BaseURL())
		}
	}
}

// Fix round 1, controller ruling 2: if the old daemon is still healthy after
// being asked to shut down, Connect must not start a second one on top of it.
func TestConnectGivesUpWhenOldDaemonWontShutDown(t *testing.T) {
	home := t.TempDir()
	old := shutdownTimeout
	shutdownTimeout = 200 * time.Millisecond
	t.Cleanup(func() { shutdownTimeout = old })

	// No onShutdown callback: the fake server answers /api/shutdown but
	// keeps serving /health, simulating a daemon that refuses to die.
	_, info := fakeDaemon(t, "v0", nil)
	if err := store.WriteDaemonInfo(home, info); err != nil {
		t.Fatal(err)
	}
	stubStart(t, func(string) error { t.Fatal("must not start a second daemon"); return nil })

	_, err := Connect(context.Background(), home, "v1")
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "daemon_unavailable" || ae.Hint == "" {
		t.Fatalf("err = %v", err)
	}
}

// Fix round 1, controller ruling 3: the startup poll must honor ctx
// cancellation promptly instead of spinning through startTimeout.
func TestConnectHonoursContextCancellation(t *testing.T) {
	home := t.TempDir()
	stubStart(t, func(string) error { return nil }) // never actually starts anything
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, err := Connect(ctx, home, "v1")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("Connect took %v after cancel, want a prompt return", elapsed)
	}
}

// Fix round 2, controller ruling 1: a daemon that is alive but slow to
// answer /health (here simulated by pointing daemon.json at a dead server
// while a process still holds daemon.lock, as the real daemon does for its
// whole lifetime) must never be mistaken for a crashed one: Connect must not
// delete its daemon.json and must not start a second daemon on top of it.
func TestConnectDoesNotClobberLiveDaemonWithSlowHealth(t *testing.T) {
	home := t.TempDir()

	lockFile, err := os.OpenFile(filepath.Join(home, "daemon.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer lockFile.Close()
	if err := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	defer syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)

	dead, info := fakeDaemon(t, "v1", nil)
	dead.Close()
	if err := store.WriteDaemonInfo(home, info); err != nil {
		t.Fatal(err)
	}

	old := startTimeout
	startTimeout = 200 * time.Millisecond
	t.Cleanup(func() { startTimeout = old })
	stubStart(t, func(string) error { t.Fatal("must not start a daemon while one is alive"); return nil })

	_, err = Connect(context.Background(), home, "v1")
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "daemon_unavailable" {
		t.Fatalf("err = %v", err)
	}
	if _, rerr := store.ReadDaemonInfo(home); rerr != nil {
		t.Fatalf("daemon.json was removed even though the daemon is alive: %v", rerr)
	}
}

// Final review finding 4: a daemon mid-exit (after `tdm daemon stop` or idle shutdown) holds
// daemon.lock until it actually finishes, and until then /health fails. Connect must not just
// poll and give up after startTimeout — once the lock frees, it must fall through to the normal
// remove→start path and succeed, rather than reporting daemon_unavailable.
func TestConnectFallsThroughWhenLockFreesWhileHeld(t *testing.T) {
	home := t.TempDir()
	lockPath := filepath.Join(home, "daemon.lock")
	lockFile, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	// Simulate the old daemon mid-exit: it releases the lock shortly after Connect starts
	// polling, the way the real daemon does when its own Shutdown/Close finally completes.
	go func() {
		time.Sleep(100 * time.Millisecond)
		syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
		lockFile.Close()
	}()

	dead, info := fakeDaemon(t, "v1", nil)
	dead.Close()
	if err := store.WriteDaemonInfo(home, info); err != nil {
		t.Fatal(err)
	}

	old := startTimeout
	startTimeout = 2 * time.Second
	t.Cleanup(func() { startTimeout = old })

	started := false
	stubStart(t, func(h string) error {
		started = true
		_, fresh := fakeDaemon(t, "v1", nil)
		return store.WriteDaemonInfo(h, fresh)
	})

	start := time.Now()
	c, err := Connect(context.Background(), home, "v1")
	if err != nil || !started || c == nil {
		t.Fatalf("started=%v c=%v err=%v", started, c, err)
	}
	if elapsed := time.Since(start); elapsed > startTimeout {
		t.Fatalf("Connect took %v, want well under startTimeout once the lock freed", elapsed)
	}
}

func TestDecodeError(t *testing.T) {
	err := DecodeError(404, []byte(`{"error":{"code":"thread_not_found","message":"no thread t_9","hint":"run x"}}`))
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "thread_not_found" || ae.Hint != "run x" || ae.Status != 404 {
		t.Fatalf("err = %#v", err)
	}
	err = DecodeError(502, []byte("bad gateway"))
	if !errors.As(err, &ae) || ae.Code != "http_error" {
		t.Fatalf("err = %#v", err)
	}
}

// Feature review t_6: the daemon tells the agent's CLI calls apart from the page's requests
// (the dev proxy also sends the Bearer token) by this header.
func TestRawMarksRequestsAsCLI(t *testing.T) {
	got := make(chan string, 1)
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- r.Header.Get(store.ClientHeader)
	}))
	t.Cleanup(hs.Close)
	u, _ := url.Parse(hs.URL)
	port, _ := strconv.Atoi(u.Port())
	c := New(store.DaemonInfo{Port: port, Token: "tok"})
	if _, _, err := c.Raw(context.Background(), http.MethodGet, "/x", nil); err != nil {
		t.Fatal(err)
	}
	if h := <-got; h != store.ClientCLI {
		t.Fatalf("%s = %q, want %q", store.ClientHeader, h, store.ClientCLI)
	}
}
