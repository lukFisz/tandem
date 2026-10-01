//go:build unix

package daemon

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// acquireLock takes a non-blocking exclusive lock on path (created if
// necessary), held until releaseLock is called or the process exits. It
// fails immediately, without blocking, if another process already holds it.
func acquireLock(path string) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if err == syscall.EWOULDBLOCK {
			return nil, errors.New("another daemon is running")
		}
		return nil, err
	}
	return f, nil
}

func releaseLock(f *os.File) {
	syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	f.Close()
}
