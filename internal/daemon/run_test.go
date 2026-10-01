package daemon

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

// runUntilDaemonInfo starts Run in the background and waits for it to write a daemon.json whose
// Version matches version (distinguishing a fresh start from a stale file possibly left by a
// previous test's daemon on the same Home). It returns the daemon's port and a stop function
// that cancels Run's context and waits for it to actually exit — mirroring how a real daemon's
// lifecycle ends (context cancellation runs the same shutdown path /api/shutdown would).
func runUntilDaemonInfo(t *testing.T, home, version string) (port int, stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Config{Home: home, Version: version, IdleTimeout: time.Hour})
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		info, err := store.ReadDaemonInfo(home)
		if err == nil && info.Version == version {
			return info.Port, func() {
				cancel()
				select {
				case err := <-done:
					if err != nil {
						t.Fatalf("Run returned error: %v", err)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("daemon did not shut down")
				}
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("daemon never wrote daemon.json")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Fix round 1, controller ruling 1a: only one daemon may run per Home at a
// time (spec §7 "one daemon per machine, single writer"). A second Run on
// the same Home must fail fast while the first is still running, instead of
// both processes ending up appending to the same events.jsonl.
func TestRunFailsWhenAlreadyRunning(t *testing.T) {
	home := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Config{Home: home, Version: "v1", IdleTimeout: time.Hour})
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := store.ReadDaemonInfo(home); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first daemon never wrote daemon.json")
		}
		time.Sleep(10 * time.Millisecond)
	}

	err := Run(context.Background(), Config{Home: home, Version: "v1"})
	if err == nil || !strings.Contains(err.Error(), "another daemon is running") {
		t.Fatalf("second Run err = %v, want a lock error", err)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("first Run returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first daemon did not shut down")
	}
}

// Residual round, Important: I2 must hold across a REAL daemon lifecycle. client.Connect removes
// daemon.json both on a clean shutdown (via Run's own deferred RemoveDaemonInfo) and again just
// before starting a replacement daemon, so seeding daemon.json (as this test used to) never
// actually exercises the port-reuse path a real restart takes. This starts a real daemon, shuts
// it down through the same context-cancellation path a clean exit uses, and starts a second real
// daemon on the same Home — which must land on the same port via Home/daemon.port (never removed
// by RemoveDaemonInfo), even though daemon.json itself is gone in between.
func TestRunReusesPortAcrossRestart(t *testing.T) {
	home := t.TempDir()

	port1, stop1 := runUntilDaemonInfo(t, home, "v1")
	stop1()
	if _, err := store.ReadDaemonInfo(home); err == nil {
		t.Fatal("daemon.json should be removed on clean shutdown")
	}
	if _, err := os.Stat(filepath.Join(home, "daemon.port")); err != nil {
		t.Fatalf("daemon.port should survive a clean shutdown: %v", err)
	}

	port2, stop2 := runUntilDaemonInfo(t, home, "v2")
	defer stop2()
	if port2 != port1 {
		t.Fatalf("second daemon listened on port %d, want reused port %d", port2, port1)
	}
}

// Residual round, Important: when the recorded port is occupied by a live listener, Run must
// fall back to an ephemeral port instead of failing to start (or, worse on macOS, silently
// hijacking that listener's loopback traffic via SO_REUSEADDR) — and it must persist the
// fallback port for next time.
func TestRunFallsBackWhenPreferredPortOccupied(t *testing.T) {
	home := t.TempDir()

	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	takenPort := taken.Addr().(*net.TCPAddr).Port

	// WritePortHint is the same primitive Run itself uses to persist the port it bound; this
	// simulates a previous daemon having recorded takenPort, which something else (taken, above)
	// now answers on.
	if err := store.WritePortHint(home, takenPort); err != nil {
		t.Fatal(err)
	}

	port, stop := runUntilDaemonInfo(t, home, "v1")
	defer stop()
	if port == takenPort {
		t.Fatalf("daemon reused occupied port %d, want a fallback port", takenPort)
	}
	if port == 0 {
		t.Fatal("daemon did not record a fallback port")
	}
	hint, err := store.ReadPortHint(home)
	if err != nil || hint != port {
		t.Fatalf("ReadPortHint() = %d, %v; want %d, nil (the fallback port must be persisted)", hint, err, port)
	}
}

// Residual round, Important: a stale (garbage) daemon.port must not stop the daemon from
// starting — Run should ignore it and fall back to an ephemeral port, same as if the file were
// absent.
func TestRunIgnoresCorruptPortHint(t *testing.T) {
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, "daemon.port"), []byte("not-a-port"), 0o600); err != nil {
		t.Fatal(err)
	}

	port, stop := runUntilDaemonInfo(t, home, "v1")
	defer stop()
	if port == 0 {
		t.Fatal("daemon did not start with a valid port despite the corrupt hint")
	}
}
