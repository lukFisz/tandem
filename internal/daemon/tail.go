package daemon

import (
	"io"
	"os"
	"strings"

	"github.com/lukFisz/tandem/internal/domain"
)

// tailWindow bounds how much of an output file tailLines reads per call.
const tailWindow = 8 << 10

// tailOutputLines is how many trailing output lines a process card shows.
const tailOutputLines = 3

// tailLines returns the last n lines of the file at path, joined with "\n" and without a trailing
// newline. It reads at most the last tailWindow bytes; if that window starts mid-line, the partial
// first line is dropped unless it is all there is. "\r" is stripped so CRLF output reads cleanly.
// An empty file yields "", nil; a missing one yields "" and an os.IsNotExist error.
func tailLines(path string, n int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	size := info.Size()
	if size == 0 || n <= 0 {
		return "", nil
	}
	start := size - tailWindow
	if start < 0 {
		start = 0
	}
	buf := make([]byte, size-start)
	read, err := f.ReadAt(buf, start)
	if err != nil && err != io.EOF {
		return "", err
	}
	buf = buf[:read]
	// The window starts mid-line unless it is the file start or follows a newline.
	partial := false
	if start > 0 {
		prev := make([]byte, 1)
		if _, err := f.ReadAt(prev, start-1); err == nil && prev[0] != '\n' {
			partial = true
		}
	}
	lines := strings.Split(strings.ReplaceAll(string(buf), "\r", ""), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if partial && len(lines) > 1 {
		lines = lines[1:]
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n"), nil
}

// refreshTails re-reads the output file of every process that has one and is still running, or
// has exited but not had its final read yet, and notifies subscribers if any tail changed. Files
// are read without holding s.mu. Tails are in-memory only; nothing reaches the event log.
func (s *Session) refreshTails() {
	type target struct {
		id, out string
		exited  bool
	}
	s.mu.Lock()
	var targets []target
	for _, p := range s.state.Processes {
		if p.Out == "" {
			continue
		}
		exited := p.Status != domain.ProcessRunning
		if exited && s.tailDone[p.ID] {
			continue
		}
		targets = append(targets, target{p.ID, p.Out, exited})
	}
	s.mu.Unlock()
	if len(targets) == 0 {
		return
	}

	type result struct {
		target
		tail string
		ok   bool
	}
	results := make([]result, 0, len(targets))
	for _, t := range targets {
		tail, err := tailLines(t.out, tailOutputLines)
		results = append(results, result{t, tail, err == nil})
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for _, r := range results {
		if r.exited {
			if s.tailDone == nil {
				s.tailDone = map[string]bool{}
			}
			s.tailDone[r.id] = true
		}
		if !r.ok {
			continue
		}
		// An empty tail is stored as no entry, so it stays out of the snapshot.
		if s.tails[r.id] == r.tail {
			continue
		}
		if r.tail == "" {
			delete(s.tails, r.id)
		} else {
			if s.tails == nil {
				s.tails = map[string]string{}
			}
			s.tails[r.id] = r.tail
		}
		changed = true
	}
	if changed {
		s.notifyLocked()
	}
}
