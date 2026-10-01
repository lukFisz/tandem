package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/lukFisz/tandem/internal/domain"
	"github.com/lukFisz/tandem/internal/render"
)

var ErrWaitSuperseded = errors.New("wait superseded")

// BeginWait makes the caller the session's only waiter; a previous waiter is cancelled with ErrWaitSuperseded.
func (s *Session) BeginWait(parent context.Context) (context.Context, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.waitCancel != nil {
		s.waitCancel(ErrWaitSuperseded)
	}
	ctx, cancel := context.WithCancelCause(parent)
	s.waitSeq++
	mine := s.waitSeq
	s.waitCancel, s.waiting = cancel, true
	s.agentSeen = s.now()
	s.notifyLocked()
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			cancel(nil)
			s.mu.Lock()
			defer s.mu.Unlock()
			// The agent stayed connected for the whole wait: its end counts as contact too, so
			// a long wait that just returned does not read as a silent agent (Review Focus 4).
			s.agentSeen = s.now()
			if s.waitSeq == mine {
				s.waitCancel, s.waiting = nil, false
				s.notifyLocked()
			}
		})
	}
}

func (s *Server) wait(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	timeout := 9 * time.Minute
	if v := r.URL.Query().Get("timeout"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 || d > time.Hour {
			writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "timeout must be a duration between 0 and 1h", "")
			return
		}
		timeout = d
	}
	asJSON := r.URL.Query().Get("format") == "json"

	// A closed session never produces new pending events, so waiting on it would otherwise only
	// time out — and per the guide, "exit 3 → wait again" would loop forever. Answer immediately
	// with the same session_closed error a command would get.
	var closed bool
	sess.Read(func(st *domain.State, _ []domain.Event) { closed = st.Session.Status == domain.SessionClosed })
	if closed {
		writeError(w, domain.SessionClosedError(sess.ID()))
		return
	}

	s.activity.Begin()
	defer s.activity.End()
	ctx, end := sess.BeginWait(r.Context())
	defer end()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		changed := sess.Changed()
		var body []byte
		var upTo int64
		var err error
		sess.Read(func(st *domain.State, evs []domain.Event) {
			pending := waitEvents(evs, st.Delivered)
			if len(pending) == 0 {
				return
			}
			upTo = pending[len(pending)-1].Seq
			if asJSON {
				body, err = json.Marshal(map[string]any{"events": pending})
			} else {
				var md string
				md, err = render.Wait(st, pending, sess.Blob)
				body = []byte(md)
			}
		})
		if err != nil {
			writeError(w, err)
			return
		}
		if body != nil {
			if ctx.Err() != nil {
				// ctx is cancelled not only by client disconnect but also by a superseding wait
				// or daemon shutdown; either way we must not mark these events delivered, but a
				// superseding/shutdown waiter still needs the same cause-based status the
				// ctx.Done() branch below would have given it — an empty 200 would break the
				// spec §6 "previous waiter gets wait_superseded" contract. Writing to a client
				// that already disconnected is harmless (the write is simply discarded).
				respondCause(w, ctx)
				return
			}
			if asJSON {
				w.Header().Set("Content-Type", "application/json")
			} else {
				w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			}
			if _, err := w.Write(body); err != nil {
				return // write failed: leave the events undelivered, the next wait redelivers them
			}
			// Flush and check the error: a buffered w.Write can succeed even though the
			// underlying connection is already gone, so only a successful Flush proves the
			// bytes actually reached the client.
			if err := http.NewResponseController(w).Flush(); err != nil {
				return // flush failed: leave the events undelivered, the next wait redelivers them
			}
			// At-least-once delivery: the body was written and flushed to the client above. If
			// MarkDelivered fails now, the response was already sent, so we can only log and let
			// the events stay undelivered — the next wait redelivers them, which is acceptable (a
			// rare duplicate), unlike losing them.
			if err := sess.MarkDelivered(upTo); err != nil {
				log.Printf("session %s: mark delivered up to %d: %v", sess.ID(), upTo, err)
			}
			return
		}
		select {
		case <-changed:
		case <-timer.C:
			w.WriteHeader(http.StatusNoContent)
			return
		case <-ctx.Done():
			respondCause(w, ctx)
			return
		}
	}
}

// waitEvents is the user actions plus daemon-detected (ActorSystem) process-exit events after
// delivered, in seq order. The agent's own `tdm process end` must not wake its own wait.
func waitEvents(events []domain.Event, delivered int64) []domain.Event {
	var out []domain.Event
	for _, e := range events {
		if e.Seq <= delivered {
			continue
		}
		if e.Actor == domain.ActorUser || (e.Type == domain.EvProcessExited && e.Actor == domain.ActorSystem) {
			out = append(out, e)
		}
	}
	return out
}

// respondCause writes the 409 wait_superseded or 503 daemon_stopping response that matches why
// ctx was cancelled. It never marks anything delivered.
func respondCause(w http.ResponseWriter, ctx context.Context) {
	if errors.Is(context.Cause(ctx), ErrWaitSuperseded) {
		writeErr(w, http.StatusConflict, "wait_superseded", "another tdm wait started for this session",
			"only one agent should wait per session")
	} else {
		writeErr(w, http.StatusServiceUnavailable, "daemon_stopping", "the wait was interrupted", "run `tdm wait` again")
	}
}
