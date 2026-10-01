//go:build unix

package client

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// lockPollInterval is how often lockExclusive retries a contended lock; a test var.
var lockPollInterval = 20 * time.Millisecond

// lockExclusive blocks, honoring ctx, until it holds an exclusive lock on
// path (created if necessary). The caller must release it with unlockFile.
func lockExclusive(ctx context.Context, path string) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return f, nil
		}
		if err != syscall.EWOULDBLOCK {
			f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(lockPollInterval):
		}
	}
}

func unlockFile(f *os.File) {
	syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	f.Close()
}

// lockHeld reports, without blocking, whether some other process currently
// holds an exclusive lock on path (creating path if it doesn't exist yet).
// It is used to tell a live-but-slow-to-answer daemon (still holding its
// daemon.lock) apart from a genuinely dead one, so Connect never deletes a
// live daemon's daemon.json or starts a second daemon on top of it.
func lockHeld(path string) (bool, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return false, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return false, err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if err == syscall.EWOULDBLOCK {
			return true, nil
		}
		return false, err
	}
	syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return false, nil
}
