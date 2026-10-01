package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/lukFisz/tandem/internal/domain"
)

// faultyFile wraps a real *os.File and injects a write or sync failure once, then behaves normally.
type faultyFile struct {
	*os.File
	failWrite int
	failSync  int
}

func (f *faultyFile) Write(p []byte) (int, error) {
	if f.failWrite > 0 {
		f.failWrite--
		return 0, errors.New("injected write failure")
	}
	return f.File.Write(p)
}

func (f *faultyFile) Sync() error {
	if f.failSync > 0 {
		f.failSync--
		return errors.New("injected sync failure")
	}
	return f.File.Sync()
}

// Review Focus 4 (store-level): a failed write must not leave a torn line in the file, and must
// not advance the file position, so a later successful append gives strictly increasing seqs and
// a log that reloads cleanly.
func TestAppendRecoversFromWriteFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	l, _, _, err := OpenLog(path)
	if err != nil {
		t.Fatal(err)
	}
	ff := &faultyFile{File: l.f.(*os.File), failWrite: 1}
	l.f = ff

	if err := l.Append([]domain.Event{event(1, "a")}); err == nil {
		t.Fatal("want injected write failure")
	}
	if err := l.Append([]domain.Event{event(1, "a")}); err != nil {
		t.Fatalf("append after failure: %v", err)
	}
	if err := l.Append([]domain.Event{event(2, "b")}); err != nil {
		t.Fatalf("second append: %v", err)
	}
	l.Close()

	_, evs, warn, err := OpenLog(path)
	if err != nil || warn != "" {
		t.Fatalf("reload after failed write: err=%v warn=%q", err, warn)
	}
	if len(evs) != 2 || evs[0].Seq != 1 || evs[1].Seq != 2 {
		t.Fatalf("want strictly increasing seqs 1,2, got %+v", evs)
	}
}

// Same as above but the write succeeds and Sync fails: the partially-flushed bytes must be
// discarded too, or a later append would duplicate the seq that "succeeded" from the caller's
// point of view.
func TestAppendRecoversFromSyncFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	l, _, _, err := OpenLog(path)
	if err != nil {
		t.Fatal(err)
	}
	ff := &faultyFile{File: l.f.(*os.File), failSync: 1}
	l.f = ff

	if err := l.Append([]domain.Event{event(1, "a")}); err == nil {
		t.Fatal("want injected sync failure")
	}
	if err := l.Append([]domain.Event{event(1, "a")}); err != nil {
		t.Fatalf("append after failure: %v", err)
	}
	if err := l.Append([]domain.Event{event(2, "b")}); err != nil {
		t.Fatalf("second append: %v", err)
	}
	l.Close()

	_, evs, warn, err := OpenLog(path)
	if err != nil || warn != "" {
		t.Fatalf("reload after failed sync: err=%v warn=%q", err, warn)
	}
	if len(evs) != 2 || evs[0].Seq != 1 || evs[1].Seq != 2 {
		t.Fatalf("want strictly increasing seqs 1,2, got %+v", evs)
	}
}
