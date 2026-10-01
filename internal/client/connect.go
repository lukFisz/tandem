package client

import (
	"context"
	"net/http"
	"path/filepath"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

// StartDaemon launches the daemon in the background; tests replace it.
var StartDaemon = startDaemonProcess

var startTimeout = 5 * time.Second

// shutdownTimeout bounds how long waitGone waits for an old daemon to
// actually exit (release its lock) after being asked to shut down; a test var.
var shutdownTimeout = 3 * time.Second

// Existing returns a client for a running, healthy daemon without starting one.
func Existing(ctx context.Context, home string) (*Client, store.DaemonInfo, error) {
	info, err := store.ReadDaemonInfo(home)
	if err != nil {
		return nil, info, err
	}
	c := New(info)
	v, err := c.Health(ctx)
	info.Version = v
	return c, info, err
}

func daemonLockPath(home string) string { return filepath.Join(home, "daemon.lock") }

// Connect returns a client for a daemon running this exact version, starting
// or replacing one if needed.
//
// Only one daemon may run per home at a time (spec §7), and concurrent CLI
// invocations can race to auto-start one: the remove-start-poll sequence
// below runs under an exclusive, process-wide lock on home/start.lock so
// only one caller ever starts a daemon; the rest re-check Existing once they
// acquire the lock and reuse whatever the winner started.
//
// A daemon that is alive but slow to answer /health (or the daemon.lock
// probe below) must never be mistaken for a dead one: before removing
// daemon.json or starting a new daemon, Connect checks whether a process
// still holds daemon.lock and, if so, only waits for it to answer instead.
func Connect(ctx context.Context, home, version string) (*Client, error) {
	if c, info, err := Existing(ctx, home); err == nil {
		if info.Version == version {
			return c, nil
		}
		_ = c.Do(ctx, http.MethodPost, "/api/shutdown", nil, nil)
		gone, err := WaitGone(ctx, c, home)
		if err != nil {
			return nil, err
		}
		if !gone {
			return nil, &APIError{Code: "daemon_unavailable",
				Message: "an existing tdm daemon did not shut down",
				Hint:    "run `tdm daemon stop` and try again"}
		}
	}

	lockFile, err := lockExclusive(ctx, filepath.Join(home, "start.lock"))
	if err != nil {
		return nil, err
	}
	defer unlockFile(lockFile)

	if c, info, err := Existing(ctx, home); err == nil && info.Version == version {
		return c, nil
	}

	held, err := lockHeld(daemonLockPath(home))
	if err != nil {
		return nil, err
	}
	if held {
		// A process still holds daemon.lock: either a live daemon just slow to answer /health,
		// or one mid-exit (after `tdm daemon stop` or idle shutdown) that will release the lock
		// once it actually finishes. Never remove its daemon.json or start a second daemon on
		// top of it while the lock is held — but once it frees, fall through to the normal
		// remove→start path below instead of giving up.
		c, stillHeld, err := waitForLockRelease(ctx, home, version, startTimeout)
		if err != nil {
			return nil, err
		}
		if c != nil {
			return c, nil
		}
		if stillHeld {
			return nil, &APIError{Code: "daemon_unavailable",
				Message: "the daemon is busy or unresponsive",
				Hint:    "try again or run `tdm daemon stop`"}
		}
	}

	if err := store.RemoveDaemonInfo(home, 0); err != nil {
		return nil, err
	}
	if err := StartDaemon(home); err != nil {
		return nil, &APIError{Code: "daemon_unavailable", Message: "start daemon: " + err.Error()}
	}
	c, err := pollForDaemon(ctx, home, version, startTimeout)
	if err != nil {
		return nil, err
	}
	if c != nil {
		return c, nil
	}
	return nil, &APIError{Code: "daemon_unavailable", Message: "the tdm daemon did not start in time",
		Hint: "check " + filepath.Join(home, "daemon.log")}
}

// pollForDaemon polls Existing until it returns a healthy same-version
// daemon or timeout elapses; it returns (nil, nil) on a plain timeout and
// (nil, ctx.Err()) if ctx is cancelled first.
func pollForDaemon(ctx context.Context, home, version string, timeout time.Duration) (*Client, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c, info, err := Existing(ctx, home); err == nil && info.Version == version {
			return c, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	return nil, nil
}

// waitForLockRelease polls while home/daemon.lock is held by another process, looking for a
// healthy same-version daemon (the slow-to-answer-/health case). It returns a client if one
// appears; otherwise it returns (nil, false, nil) as soon as the lock frees — signalling the
// caller to fall through to the normal remove→start path — or (nil, true, nil) if the lock is
// still held when timeout elapses.
func waitForLockRelease(ctx context.Context, home, version string, timeout time.Duration) (*Client, bool, error) {
	lockPath := daemonLockPath(home)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c, info, err := Existing(ctx, home); err == nil && info.Version == version {
			return c, true, nil
		}
		held, err := lockHeld(lockPath)
		if err != nil {
			return nil, true, err
		}
		if !held {
			return nil, false, nil
		}
		select {
		case <-ctx.Done():
			return nil, true, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	return nil, true, nil
}

// WaitGone polls until the old daemon has actually exited — proven by it
// releasing daemon.lock, not merely by /health failing, since the process
// keeps the lock until its own Shutdown/Close finishes — bounded by
// shutdownTimeout. It reports whether the daemon is gone; ctx cancellation
// is returned as an error rather than folded into "not gone".
//
// Callers: Connect uses it after asking an old, differently-versioned
// daemon to shut down. `tdm daemon stop` (internal/cli/loop.go) uses it too
// — /api/shutdown answers 200 and then stops the server asynchronously, so
// without this the CLI command would return before the process actually
// released the lock.
func WaitGone(ctx context.Context, c *Client, home string) (bool, error) {
	lockPath := daemonLockPath(home)
	deadline := time.Now().Add(shutdownTimeout)
	for time.Now().Before(deadline) {
		if _, err := c.Health(ctx); err != nil {
			held, lerr := lockHeld(lockPath)
			if lerr != nil {
				return false, lerr
			}
			if !held {
				return true, nil
			}
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	return false, nil
}
