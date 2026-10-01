package daemon

import (
	"sync"
	"time"
)

// activity tracks when the daemon was last used and how many long-lived requests are open.
type activity struct {
	mu     sync.Mutex
	last   time.Time
	active int
}

func newActivity() *activity { return &activity{last: time.Now()} }

func (a *activity) Touch() {
	a.mu.Lock()
	a.last = time.Now()
	a.mu.Unlock()
}

func (a *activity) Begin() {
	a.mu.Lock()
	a.active++
	a.last = time.Now()
	a.mu.Unlock()
}

func (a *activity) End() {
	a.mu.Lock()
	a.active--
	a.last = time.Now()
	a.mu.Unlock()
}

// Idle reports whether nothing is open and nothing happened for longer than timeout.
func (a *activity) Idle(timeout time.Duration) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.active == 0 && time.Since(a.last) > timeout
}
