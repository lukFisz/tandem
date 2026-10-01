package daemon

import (
	"errors"
	"log"
	"os"
	"syscall"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

const procPollEvery = 500 * time.Millisecond

func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

func (s *Session) runningPIDs() []struct {
	id  string
	pid int
} {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []struct {
		id  string
		pid int
	}
	for _, p := range s.state.Processes {
		if p.Status == domain.ProcessRunning {
			out = append(out, struct {
				id  string
				pid int
			}{p.ID, p.PID})
		}
	}
	return out
}

func (s *Session) markGone(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.state.Process(id)
	if p == nil || p.Status != domain.ProcessRunning {
		return
	}
	if err := s.appendLocked(domain.NewEvent(domain.ActorSystem, domain.EvProcessExited,
		domain.ProcessExitedPayload{ID: p.ID, ThreadID: p.ThreadID, ExitCode: -1})); err != nil {
		log.Printf("session %s: record exit of %s: %v", s.id, id, err)
	}
}

func (m *Manager) watchProcesses(ctxDone <-chan struct{}) {
	tick := time.NewTicker(procPollEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctxDone:
			return
		case <-tick.C:
			m.pollProcesses()
		}
	}
}

// pollProcesses marks every running process whose PID has vanished as exited (code -1, unknown),
// then refreshes the output tails; a process that just vanished gets its final read here.
func (m *Manager) pollProcesses() {
	m.mu.Lock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.Unlock()
	for _, s := range sessions {
		for _, p := range s.runningPIDs() {
			if !pidAlive(p.pid) {
				s.markGone(p.id)
			}
		}
		s.refreshTails()
	}
}
