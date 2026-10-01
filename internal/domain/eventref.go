package domain

import "encoding/json"

type eventRef struct {
	ID       string `json:"id"`
	StageID  string `json:"stageId"`
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	Threads  []struct {
		ThreadID string `json:"threadId"`
	} `json:"threads"`
}

// EventThreadIDs returns the threads an event refers to; session- and stage-level events return nil.
func EventThreadIDs(s *State, e Event) []string {
	var r eventRef
	if json.Unmarshal(e.Data, &r) != nil {
		return nil
	}
	switch {
	case len(r.Threads) > 0:
		ids := make([]string, 0, len(r.Threads))
		for _, t := range r.Threads {
			ids = append(ids, t.ThreadID)
		}
		return ids
	case r.ThreadID != "":
		return []string{r.ThreadID}
	case r.BlockID != "":
		if b := s.Blocks[r.BlockID]; b != nil {
			return []string{b.ThreadID}
		}
	case e.Type == EvThreadCreated:
		return []string{r.ID}
	}
	return nil
}

// EventStageID returns the stage an event belongs to, or "" for session-level events.
func EventStageID(s *State, e Event) string {
	if ids := EventThreadIDs(s, e); len(ids) > 0 {
		if t := s.Threads[ids[0]]; t != nil {
			return t.StageID
		}
	}
	var r eventRef
	if json.Unmarshal(e.Data, &r) != nil {
		return ""
	}
	if r.StageID != "" {
		return r.StageID
	}
	if e.Type == EvStageCreated {
		return r.ID
	}
	return ""
}

// PendingUserEvents returns the user events after the delivered cursor, in order.
func PendingUserEvents(events []Event, delivered int64) []Event {
	var out []Event
	for _, e := range events {
		if e.Actor == ActorUser && e.Seq > delivered {
			out = append(out, e)
		}
	}
	return out
}
