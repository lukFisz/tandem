package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

type Actor string

const (
	ActorAI     Actor = "ai"
	ActorUser   Actor = "user"
	ActorSystem Actor = "system"
)

// Event is one line of events.jsonl. Seq and TS are assigned when the event is appended to a session.
type Event struct {
	Seq   int64           `json:"seq"`
	TS    time.Time       `json:"ts"`
	Actor Actor           `json:"actor"`
	Type  string          `json:"type"`
	V     int             `json:"v"`
	Data  json.RawMessage `json:"data"`
}

// NewEvent builds an unsequenced event. Payloads are plain structs, so marshalling cannot fail.
func NewEvent(actor Actor, typ string, payload any) Event {
	data, err := json.Marshal(payload)
	if err != nil {
		panic(fmt.Sprintf("marshal %s payload: %v", typ, err))
	}
	return Event{Actor: actor, Type: typ, V: 1, Data: data}
}

func (e Event) Decode(into any) error {
	if err := json.Unmarshal(e.Data, into); err != nil {
		return fmt.Errorf("event %d (%s): %w", e.Seq, e.Type, err)
	}
	return nil
}
