// Package daemon is the single process that owns all Tandem state and serves the HTTP API.
package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lukFisz/tandem/internal/domain"
	"github.com/lukFisz/tandem/internal/store"
)

type Manager struct {
	home     string
	mu       sync.Mutex
	sessions map[string]*Session // loaded sessions
	index    map[string]string   // session id → project id, for everything on disk
}

type SessionInfo struct {
	ID     string               `json:"id"`
	Title  string               `json:"title"`
	Status domain.SessionStatus `json:"status"`
	Active bool                 `json:"active"`
}

func NewManager(home string) (*Manager, error) {
	idx, err := store.SessionIndex(home)
	if err != nil {
		return nil, err
	}
	return &Manager{home: home, sessions: map[string]*Session{}, index: idx}, nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.sessions {
		s.log.Close()
		delete(m.sessions, id)
	}
	return nil
}

func (m *Manager) Create(p store.Project, title string) (*Session, error) {
	if strings.TrimSpace(title) == "" {
		return nil, &domain.Error{Code: domain.CodeInvalidInput, Message: "session title is required"}
	}
	if !store.ValidProjectID(p.ID) {
		return nil, &domain.Error{Code: domain.CodeInvalidInput, Message: "invalid project id " + strconv.Quote(p.ID)}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	sid := domain.NewSessionID()
	for m.index[sid] != "" {
		sid = domain.NewSessionID()
	}
	s, err := m.load(p.ID, sid)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	err = s.appendLocked(domain.NewEvent(domain.ActorAI, domain.EvSessionCreated,
		domain.SessionCreated{ID: sid, Title: title, ProjectID: p.ID}))
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	m.index[sid] = p.ID
	m.sessions[sid] = s
	if existing, err := store.LoadProject(m.home, p.ID); err == nil && existing != nil {
		p = *existing
	}
	p.ActiveSessionID = sid
	return s, store.SaveProject(m.home, p)
}

func sessionNotFound(sid string) error {
	return &domain.Error{Code: domain.CodeSessionNotFound, Message: fmt.Sprintf("no session %s", sid),
		Hint: "run `tdm session list` to see this project's sessions"}
}

func (m *Manager) Get(sid string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.getLocked(sid)
}

func (m *Manager) getLocked(sid string) (*Session, error) {
	if s := m.sessions[sid]; s != nil {
		return s, nil
	}
	pid := m.index[sid]
	if pid == "" {
		return nil, sessionNotFound(sid)
	}
	s, err := m.load(pid, sid)
	if err != nil {
		return nil, err
	}
	m.sessions[sid] = s
	return s, nil
}

func (m *Manager) load(pid, sid string) (*Session, error) {
	dir := store.SessionDir(m.home, pid, sid)
	l, events, warning, err := store.OpenLog(filepath.Join(dir, "events.jsonl"))
	if err != nil {
		return nil, err
	}
	if warning != "" {
		log.Printf("session %s: %s", sid, warning)
	}
	st, err := domain.Replay(events)
	if err != nil {
		l.Close()
		return nil, fmt.Errorf("session %s: %w", sid, err)
	}
	return &Session{id: sid, pid: pid, dir: dir, log: l, events: events, state: st,
		changed: make(chan struct{}), now: time.Now}, nil
}

// Sessions lists the sessions of a project, in a deterministic (id-sorted) order.
func (m *Manager) Sessions(pid string) ([]SessionInfo, error) {
	p, err := store.LoadProject(m.home, pid)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var ids []string
	for sid, owner := range m.index {
		if owner == pid {
			ids = append(ids, sid)
		}
	}
	sort.Strings(ids)
	out := make([]SessionInfo, 0, len(ids))
	for _, sid := range ids {
		s, err := m.getLocked(sid)
		if err != nil {
			return nil, err
		}
		s.Read(func(st *domain.State, _ []domain.Event) {
			out = append(out, SessionInfo{ID: sid, Title: st.Session.Title, Status: st.Session.Status,
				Active: p != nil && p.ActiveSessionID == sid})
		})
	}
	return out, nil
}

// SessionSummary is one row of the web UI's session list.
type SessionSummary struct {
	ID          string               `json:"id"`
	Title       string               `json:"title"`
	Status      domain.SessionStatus `json:"status"`
	ProjectName string               `json:"projectName"`
	Active      bool                 `json:"active"`
}

// AllSessions lists every session on disk, grouped by project (project id order, then session id).
func (m *Manager) AllSessions() ([]SessionSummary, error) {
	m.mu.Lock()
	seen := map[string]bool{}
	var pids []string
	for _, pid := range m.index {
		if !seen[pid] {
			seen[pid] = true
			pids = append(pids, pid)
		}
	}
	m.mu.Unlock()
	sort.Strings(pids)
	out := []SessionSummary{}
	for _, pid := range pids {
		name := pid
		if p, err := store.LoadProject(m.home, pid); err == nil && p != nil {
			name = p.Name
		}
		infos, err := m.Sessions(pid)
		if err != nil {
			return nil, err
		}
		for _, i := range infos {
			out = append(out, SessionSummary{ID: i.ID, Title: i.Title, Status: i.Status, ProjectName: name, Active: i.Active})
		}
	}
	return out, nil
}

func (m *Manager) SetActive(pid, sid string) error {
	m.mu.Lock()
	owner := m.index[sid]
	m.mu.Unlock()
	if owner != pid {
		return sessionNotFound(sid)
	}
	p, err := store.LoadProject(m.home, pid)
	if err != nil || p == nil {
		return &domain.Error{Code: domain.CodeProjectNotFound, Message: "unknown project " + pid}
	}
	p.ActiveSessionID = sid
	return store.SaveProject(m.home, *p)
}

// Session is one loaded session. All mutation goes through its mutex: one writer, one order.
type Session struct {
	mu      sync.Mutex
	id, pid string
	dir     string
	log     *store.Log
	events  []domain.Event
	state   *domain.State
	changed chan struct{}
	now     func() time.Time

	agentSeen   time.Time // last CLI call, or start/end of a tdm wait; zero until the agent shows up
	agentPushed time.Time // the agentSeen value TouchAgent last pushed to subscribers

	waiting    bool
	waitSeq    int
	waitCancel context.CancelCauseFunc

	// tails holds the last output lines of processes with an output file, by process id;
	// tailDone marks exited processes whose final read is done. In memory only (see tail.go).
	tails    map[string]string
	tailDone map[string]bool
}

func (s *Session) ID() string { return s.id }

// Execute decides and applies the commands as one atomic batch.
func (s *Session) Execute(cmds ...domain.Command) (domain.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var batch []domain.Event
	var res domain.Result
	for _, c := range cmds {
		if err := s.checkFileQuotes(c); err != nil {
			return domain.Result{}, err
		}
		evs, r, err := domain.Decide(s.state, c)
		if err != nil {
			s.rebuild()
			return domain.Result{}, err
		}
		for _, e := range evs {
			e = s.stamp(e)
			if err := s.state.Apply(e); err != nil {
				s.rebuild()
				return domain.Result{}, err
			}
			batch = append(batch, e)
		}
		res = r
	}
	return res, s.persist(batch)
}

func (s *Session) stamp(e domain.Event) domain.Event {
	e.Seq = s.state.LastSeq + 1
	e.TS = s.now().UTC()
	return e
}

// appendLocked stamps, applies and persists one event (session.created, agent.delivered).
func (s *Session) appendLocked(e domain.Event) error {
	e = s.stamp(e)
	if err := s.state.Apply(e); err != nil {
		s.rebuild()
		return err
	}
	return s.persist([]domain.Event{e})
}

func (s *Session) persist(batch []domain.Event) error {
	if len(batch) == 0 {
		return nil
	}
	if err := s.log.Append(batch); err != nil {
		s.rebuild()
		return err
	}
	s.events = append(s.events, batch...)
	s.notifyLocked()
	return nil
}

// rebuild restores the state from persisted events after a failed batch.
func (s *Session) rebuild() {
	st, err := domain.Replay(s.events)
	if err != nil {
		panic(fmt.Sprintf("session %s: persisted events no longer replay: %v", s.id, err))
	}
	s.state = st
}

func (s *Session) notifyLocked() {
	close(s.changed)
	s.changed = make(chan struct{})
}

func (s *Session) Read(fn func(st *domain.State, events []domain.Event)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s.state, s.events)
}

func (s *Session) Changed() <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.changed
}

// MarkDelivered records that user events up to upTo reached the agent. upTo is clamped to the
// last known seq: it can never mark as delivered an event that has not been written yet
// (Review Focus 5 — a caller must not be able to mark ahead of the log).
func (s *Session) MarkDelivered(upTo int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if upTo > s.state.LastSeq {
		upTo = s.state.LastSeq
	}
	if upTo <= s.state.Delivered {
		return nil
	}
	return s.appendLocked(domain.NewEvent(domain.ActorSystem, domain.EvAgentDelivered, domain.AgentDelivered{UpTo: upTo}))
}

// agentPushEvery throttles snapshot pushes caused only by agent CLI calls: the page needs
// agentSeenAt to the minute, not a new snapshot for every read-only command.
const agentPushEvery = time.Minute

// TouchAgent records a CLI call from the agent.
func (s *Session) TouchAgent() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentSeen = s.now()
	if s.agentSeen.Sub(s.agentPushed) >= agentPushEvery {
		s.agentPushed = s.agentSeen
		s.notifyLocked()
	}
}

func (s *Session) Snapshot() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var seen int64
	if !s.agentSeen.IsZero() {
		seen = s.agentSeen.UnixMilli()
	}
	var output map[string]string
	if len(s.tails) > 0 {
		output = make(map[string]string, len(s.tails))
		for id, tail := range s.tails {
			output[id] = tail
		}
	}
	return json.Marshal(struct {
		State         *domain.State     `json:"state"`
		Waiting       bool              `json:"waiting"`
		AgentSeenAt   int64             `json:"agentSeenAt,omitempty"`
		ProcessOutput map[string]string `json:"processOutput,omitempty"`
	}{s.state, s.waiting, seen, output})
}

func (s *Session) PutBlob(content []byte) (string, error) {
	return store.PutBlob(filepath.Join(s.dir, "blobs"), content)
}

func (s *Session) Blob(sha string) ([]byte, error) {
	return store.GetBlob(filepath.Join(s.dir, "blobs"), sha)
}
