package daemon

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

var agentT0 = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)

// setClock swaps the session clock under its lock, so handler goroutines (which read it under
// the same lock) see the change without a data race.
func setClock(s *Session, now func() time.Time) {
	s.mu.Lock()
	s.now = now
	s.mu.Unlock()
}

func agentSeenAt(t *testing.T, s *Session) int64 {
	t.Helper()
	b, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var snap struct {
		AgentSeenAt int64 `json:"agentSeenAt"`
	}
	if err := json.Unmarshal(b, &snap); err != nil {
		t.Fatal(err)
	}
	return snap.AgentSeenAt
}

func TestSnapshotOmitsAgentSeenAtUntilTheAgentShowsUp(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := s.Snapshot()
	if strings.Contains(string(b), "agentSeenAt") {
		t.Fatalf("snapshot = %s", b)
	}
}

// Review Focus 5: only the CLI counts as the agent. Bearer requests without the client header
// (the dev server's proxy) must never refresh agentSeenAt.
func TestAgentSeenOnlyForCLIRequests(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session() // Bearer, no client header
	sess, err := e.srv.mgr.Get(sid)
	if err != nil {
		t.Fatal(err)
	}
	setClock(sess, func() time.Time { return agentT0 })
	e.do("GET", "/api/sessions/"+sid+"/state", "")
	e.command(sid, "stage.add", `{"title":"A"}`)
	if got := agentSeenAt(t, sess); got != 0 {
		t.Fatalf("requests without %s set agentSeenAt = %d", store.ClientHeader, got)
	}
	e.do("GET", "/api/sessions/"+sid+"/state", "", store.ClientHeader, store.ClientCLI)
	if got := agentSeenAt(t, sess); got != agentT0.UnixMilli() {
		t.Fatalf("agentSeenAt = %d, want %d", got, agentT0.UnixMilli())
	}
}

func TestCreateSessionFromCLIMarksAgentSeen(t *testing.T) {
	e := newTestEnv(t)
	body, _ := json.Marshal(map[string]any{"project": store.Project{ID: "p1", RootPath: "/r", Name: "r"}, "title": "Idea"})
	code, out := e.do("POST", "/api/sessions", string(body), store.ClientHeader, store.ClientCLI)
	var res struct{ ID string }
	json.Unmarshal([]byte(out), &res)
	sess, err := e.srv.mgr.Get(res.ID)
	if code != 200 || err != nil {
		t.Fatalf("create: %d %s %v", code, out, err)
	}
	if agentSeenAt(t, sess) == 0 {
		t.Fatal("tdm session new must count as agent contact")
	}
}

func TestTouchAgentPushesAtMostOncePerMinute(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	now := agentT0
	s.now = func() time.Time { return now }
	pushed := func() bool {
		ch := s.Changed()
		s.TouchAgent()
		select {
		case <-ch:
			return true
		default:
			return false
		}
	}
	if !pushed() {
		t.Fatal("first contact must push a snapshot")
	}
	now = agentT0.Add(30 * time.Second)
	if pushed() {
		t.Fatal("contact 30s after the last push must not push")
	}
	if got := agentSeenAt(t, s); got != now.UnixMilli() {
		t.Fatalf("agentSeenAt = %d, want the latest contact %d", got, now.UnixMilli())
	}
	now = agentT0.Add(61 * time.Second)
	if !pushed() {
		t.Fatal("contact a minute after the last push must push")
	}
}

// Review Focus 4: a tdm wait keeps the agent connected. When it returns (for example after the user
// took 20 minutes to answer), its end counts as contact, so the page does not flip to "AI not
// connected" when waiting turns false.
func TestWaitStartAndEndCountAsAgentContact(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	now := agentT0
	s.now = func() time.Time { return now }
	_, end := s.BeginWait(context.Background())
	if got := agentSeenAt(t, s); got != agentT0.UnixMilli() {
		t.Fatalf("after BeginWait agentSeenAt = %d", got)
	}
	now = agentT0.Add(20 * time.Minute)
	end()
	if got := agentSeenAt(t, s); got != now.UnixMilli() {
		t.Fatalf("after the wait ended agentSeenAt = %d, want %d", got, now.UnixMilli())
	}
}
