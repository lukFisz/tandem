package daemon

import (
	"os/exec"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

func TestWaitEventsFiltersProcessExits(t *testing.T) {
	payload := domain.ProcessExitedPayload{ID: "p_1", ThreadID: "t_1", ExitCode: 0}
	user := domain.NewEvent(domain.ActorUser, domain.EvReviewSubmitted, struct{}{})
	ai := domain.NewEvent(domain.ActorAI, domain.EvProcessExited, payload)
	sys := domain.NewEvent(domain.ActorSystem, domain.EvProcessExited, payload)
	evs := []domain.Event{user, ai, sys}
	for i := range evs {
		evs[i].Seq = int64(i + 1)
	}
	got := waitEvents(evs, 0)
	if len(got) != 2 || got[0].Seq != 1 || got[1].Seq != 3 {
		t.Fatalf("waitEvents = %+v", got)
	}
}

func TestPollProcessesMarksGone(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("true")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	if _, err := s.Execute(&domain.AddStage{Title: "A"}, &domain.AddThread{Title: "T"},
		&domain.StartProcess{PID: pid, Cmd: "true"}); err != nil {
		t.Fatal(err)
	}
	m.pollProcesses()
	check := func(code int) {
		t.Helper()
		s.Read(func(st *domain.State, evs []domain.Event) {
			p := st.Process("p_1")
			if p == nil || p.Status != domain.ProcessExited || p.ExitCode == nil || *p.ExitCode != code {
				t.Fatalf("p_1 = %+v, want exit %d", p, code)
			}
			if last := evs[len(evs)-1]; last.Actor != domain.ActorSystem {
				t.Fatalf("last actor = %s", last.Actor)
			}
		})
	}
	check(-1)
	if _, err := s.Execute(&domain.EndProcess{ID: "p_1", ExitCode: 2}); err != nil {
		t.Fatal(err)
	}
	s.Read(func(st *domain.State, _ []domain.Event) {
		if p := st.Process("p_1"); *p.ExitCode != 2 {
			t.Fatalf("exit = %d", *p.ExitCode)
		}
	})
}
