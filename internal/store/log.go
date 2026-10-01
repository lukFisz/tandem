package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

// logFile is the subset of *os.File that Log needs; tests substitute a fault-injecting fake.
type logFile interface {
	io.Writer
	Sync() error
	Truncate(size int64) error
	Seek(offset int64, whence int) (int64, error)
	Close() error
}

// Log is an append-only events.jsonl file with one writer.
type Log struct{ f logFile }

// OpenLog reads every event in path and opens the file for appending, creating it if needed.
// A malformed or unterminated final line (a crash mid-write) is cut off and reported as a warning;
// a malformed line anywhere else is an error.
func OpenLog(path string) (*Log, []domain.Event, string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, nil, "", err
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, nil, "", err
	}
	events, good, warning, err := parseLog(data)
	if err != nil {
		return nil, nil, "", fmt.Errorf("%s: %w", path, err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, nil, "", err
	}
	if err := f.Truncate(int64(good)); err != nil {
		f.Close()
		return nil, nil, "", err
	}
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		f.Close()
		return nil, nil, "", err
	}
	return &Log{f: f}, events, warning, nil
}

// parseLog returns the events and the byte offset just after the last good line.
func parseLog(data []byte) ([]domain.Event, int, string, error) {
	var events []domain.Event
	offset, lineNo := 0, 0
	for offset < len(data) {
		lineNo++
		rest := data[offset:]
		end := bytes.IndexByte(rest, '\n')
		terminated := end >= 0
		if !terminated {
			end = len(rest)
		}
		line, next := rest[:end], offset+end
		if terminated {
			next++
		}
		if len(bytes.TrimSpace(line)) == 0 {
			offset = next
			continue
		}
		var e domain.Event
		err := json.Unmarshal(line, &e)
		if err != nil || !terminated {
			if next < len(data) {
				return nil, 0, "", fmt.Errorf("line %d: %v", lineNo, err)
			}
			return events, offset, fmt.Sprintf("dropped truncated line %d", lineNo), nil
		}
		events = append(events, e)
		offset = next
	}
	return events, offset, "", nil
}

// Append writes the events as JSON lines in one write and fsyncs. On any write or sync failure
// (e.g. disk full) it truncates the file back to its pre-append size and repositions at the end,
// so the log never keeps a torn line and a later append never reuses seqs that "failed" but were
// partially flushed.
func (l *Log) Append(events []domain.Event) error {
	var buf bytes.Buffer
	for _, e := range events {
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	start, err := l.f.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	if _, err := l.f.Write(buf.Bytes()); err != nil {
		return l.revert(start, err)
	}
	if err := l.f.Sync(); err != nil {
		return l.revert(start, err)
	}
	return nil
}

// revert restores the file to the given pre-append offset after a failed write or sync, then
// returns the original error.
func (l *Log) revert(offset int64, cause error) error {
	if terr := l.f.Truncate(offset); terr != nil {
		return fmt.Errorf("%w (and truncate failed: %v)", cause, terr)
	}
	if _, serr := l.f.Seek(offset, io.SeekStart); serr != nil {
		return fmt.Errorf("%w (and seek failed: %v)", cause, serr)
	}
	return cause
}

func (l *Log) Close() error { return l.f.Close() }
