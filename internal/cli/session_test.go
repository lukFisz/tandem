package cli

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

func TestSessionLifecycle(t *testing.T) {
	startDaemon(t)
	out := must(t, "", "session", "new", "Implement idea ABC")
	fields := strings.Fields(out)
	sid := fields[0]
	if !regexp.MustCompile(`^s_[0-9a-f]{6}$`).MatchString(sid) || !strings.Contains(fields[1], "/s/"+sid+"?token=") {
		t.Fatalf("session new printed %q", out)
	}
	if show := must(t, "", "session", "show"); !strings.HasPrefix(show, "# Session "+sid+" \"Implement idea ABC\" — active\n") {
		t.Fatalf("show = %q", show)
	}
	sid2 := newSession(t)
	if list := must(t, "", "session", "list"); !strings.Contains(list, "* "+sid2) || !strings.Contains(list, "  "+sid) {
		t.Fatalf("list = %q", list)
	}
	must(t, "", "session", "use", sid)
	if show := must(t, "", "--session", sid2, "session", "show"); !strings.Contains(show, "\"Test\"") {
		t.Fatalf("--session ignored: %q", show)
	}
	t.Setenv("TANDEM_SESSION", sid2)
	if show := must(t, "", "session", "show"); !strings.Contains(show, "\"Test\"") {
		t.Fatalf("TANDEM_SESSION ignored: %q", show)
	}
	t.Setenv("TANDEM_SESSION", "")
	var state struct {
		Session struct{ ID string } `json:"session"`
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &state); err != nil || state.Session.ID != sid {
		t.Fatalf("json show: %+v %v", state, err)
	}
	if out := must(t, "", "open"); !strings.Contains(out, "/s/"+sid+"?token=") {
		t.Fatalf("open = %q", out)
	}
	if out := must(t, "", "session", "close"); out != "closed "+sid+"\n" {
		t.Fatalf("close = %q", out)
	}
}

func TestNoActiveSession(t *testing.T) {
	startDaemon(t)
	_, errOut, code := run(t, "", "session", "show")
	if code != 1 || !strings.Contains(errOut, "error: no_active_session:") || !strings.Contains(errOut, "hint: run `tdm session new") {
		t.Fatalf("code %d, stderr %q", code, errOut)
	}
	_, errOut, _ = run(t, "", "--json", "session", "show")
	var body struct {
		Error struct{ Code, Hint string } `json:"error"`
	}
	if json.Unmarshal([]byte(errOut), &body) != nil || body.Error.Code != "no_active_session" {
		t.Fatalf("json error = %q", errOut)
	}
}

func TestUsageErrorsExitTwo(t *testing.T) {
	startDaemon(t)
	for _, args := range [][]string{{"session", "new"}, {"session", "list", "extra"}, {"nope"}, {"session", "show", "--bogus"}} {
		if _, errOut, code := run(t, "", args...); code != 2 || !strings.Contains(errOut, "error: usage:") {
			t.Fatalf("tdm %v: code %d, stderr %q", args, code, errOut)
		}
	}
}
