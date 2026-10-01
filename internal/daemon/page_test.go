package daemon

import (
	"strings"
	"testing"
)

// The embedded build (web/ → webdist) must be the real app, not the old placeholder.
func TestPageServesBuiltUI(t *testing.T) {
	e := newTestEnv(t)
	for _, path := range []string{"/", "/s/s_abc123"} {
		code, body := e.do("GET", path, "")
		if code != 200 || !strings.Contains(body, `<div id="root"></div>`) || !strings.Contains(body, `/assets/`) {
			t.Fatalf("GET %s: %d %q", path, code, body[:min(len(body), 200)])
		}
	}
}
