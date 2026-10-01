package daemon

import (
	"fmt"
	"net/http"
)

// stream pushes the whole session snapshot on connect and after every change (SSE).
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "internal", "streaming unsupported", "")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	s.activity.Begin()
	defer s.activity.End()
	for {
		changed := sess.Changed()
		snap, err := sess.Snapshot()
		if err != nil {
			return
		}
		if _, err := fmt.Fprintf(w, "event: state\ndata: %s\n\n", snap); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-changed:
		case <-r.Context().Done():
			return
		}
	}
}
