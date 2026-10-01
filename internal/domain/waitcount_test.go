package domain

import (
	"testing"
	"time"
)

func TestWaitCountCountsAgentDelivered(t *testing.T) {
	s := NewState()
	if s.WaitCount() != 0 {
		t.Fatalf("fresh WaitCount = %d", s.WaitCount())
	}
	for i := 1; i <= 3; i++ {
		e := NewEvent(ActorSystem, EvAgentDelivered, AgentDelivered{UpTo: int64(i)})
		e.Seq = s.LastSeq + 1
		e.TS = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC).Add(time.Duration(e.Seq) * time.Second)
		if err := s.Apply(e); err != nil {
			t.Fatal(err)
		}
	}
	if s.WaitCount() != 3 {
		t.Fatalf("WaitCount = %d, want 3", s.WaitCount())
	}
}
