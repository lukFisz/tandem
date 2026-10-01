// Package domaintest builds domain states from commands for tests in any package.
package domaintest

import (
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

// Build runs commands through Decide and Apply with sequential seqs, failing the test on any error.
// The session "s_test" titled "Test session" is created first.
func Build(t testing.TB, cmds ...domain.Command) (*domain.State, []domain.Event) {
	t.Helper()
	s := domain.NewState()
	var events []domain.Event
	apply := func(e domain.Event) {
		e.Seq = s.LastSeq + 1
		e.TS = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC).Add(time.Duration(e.Seq) * time.Second)
		if err := s.Apply(e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
		events = append(events, e)
	}
	apply(domain.NewEvent(domain.ActorAI, domain.EvSessionCreated,
		domain.SessionCreated{ID: "s_test", Title: "Test session", ProjectID: "p_test"}))
	for i, c := range cmds {
		evs, _, err := domain.Decide(s, c)
		if err != nil {
			t.Fatalf("command %d (%T): %v", i, c, err)
		}
		for _, e := range evs {
			apply(e)
		}
	}
	return s, events
}

// Try builds all commands but the last, then returns the Decide error of the last one.
func Try(t testing.TB, cmds ...domain.Command) error {
	t.Helper()
	s, _ := Build(t, cmds[:len(cmds)-1]...)
	_, _, err := domain.Decide(s, cmds[len(cmds)-1])
	return err
}
