package daemon

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

type testEnv struct {
	t     *testing.T
	srv   *Server
	hs    *httptest.Server
	token string
	home  string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	home := t.TempDir()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	mgr := newManager(t, home)
	cfg := Config{Home: home, Version: "test", Token: "secret", Port: ln.Addr().(*net.TCPAddr).Port, IdleTimeout: time.Hour}
	srv := NewServer(cfg, mgr, func() {})
	hs := &httptest.Server{Listener: ln, Config: &http.Server{Handler: srv.Handler()}}
	hs.Start()
	t.Cleanup(hs.Close)
	return &testEnv{t: t, srv: srv, hs: hs, token: "secret", home: home}
}

// do sends a request with the bearer token; extra headers are given as key, value pairs.
func (e *testEnv) do(method, path, body string, hdr ...string) (int, string) {
	e.t.Helper()
	code, out, err := e.tryDo(method, path, body, hdr...)
	if err != nil {
		e.t.Fatal(err)
	}
	return code, out
}

// tryDo is do's non-fatal counterpart: it reports errors through its return value instead of
// calling t.Fatal, so it is safe to call from a goroutine (the testing package requires that
// t.Fatal/FailNow only ever run on the goroutine running the test).
func (e *testEnv) tryDo(method, path, body string, hdr ...string) (int, string, error) {
	req, err := http.NewRequest(method, e.hs.URL+path, strings.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Authorization", "Bearer "+e.token)
	for i := 0; i+1 < len(hdr); i += 2 {
		if hdr[i] == "Host" {
			req.Host = hdr[i+1]
		} else {
			req.Header.Set(hdr[i], hdr[i+1])
		}
	}
	resp, err := e.hs.Client().Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), nil
}

func (e *testEnv) session() string {
	e.t.Helper()
	body, _ := json.Marshal(map[string]any{"project": store.Project{ID: "p1", RootPath: "/r", Name: "r"}, "title": "Idea"})
	code, out := e.do("POST", "/api/sessions", string(body))
	var res struct{ ID, URL string }
	json.Unmarshal([]byte(out), &res)
	if code != 200 || !strings.HasPrefix(res.ID, "s_") || !strings.Contains(res.URL, "/s/"+res.ID+"?token=secret") {
		e.t.Fatalf("create session: %d %s", code, out)
	}
	return res.ID
}

func (e *testEnv) command(sid, typ, data string) (int, string) {
	return e.do("POST", "/api/sessions/"+sid+"/commands", `{"type":"`+typ+`","data":`+data+`}`)
}

func TestHealthNeedsNoToken(t *testing.T) {
	e := newTestEnv(t)
	resp, err := http.Get(e.hs.URL + "/health")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("health: %v %v", resp, err)
	}
}

func TestGuard(t *testing.T) {
	e := newTestEnv(t)
	e.token = ""
	if code, _ := e.do("GET", "/api/projects/p1", ""); code != 401 {
		t.Fatalf("missing token: %d", code)
	}
	e.token = "secret"
	if code, out := e.do("GET", "/api/projects/p1", "", "Host", "evil.example:80"); code != 403 || !strings.Contains(out, "bad_host") {
		t.Fatalf("bad host: %d %s", code, out)
	}
	if code, out := e.do("POST", "/api/shutdown", "", "Origin", "http://evil.example"); code != 403 || !strings.Contains(out, "bad_origin") {
		t.Fatalf("bad origin: %d %s", code, out)
	}
}

// Final review finding 9: a bare token in the Authorization header (missing the "Bearer "
// prefix) must not be accepted as if it were the cookie or a correctly-formed bearer token.
func TestBearerRequiresPrefix(t *testing.T) {
	e := newTestEnv(t)
	req, err := http.NewRequest("GET", e.hs.URL+"/api/projects/p1", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", e.token) // no "Bearer " prefix
	resp, err := e.hs.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bare token without Bearer prefix: %d, want 401", resp.StatusCode)
	}
}

// Final review finding 1(b): a cookie-authenticated request (no valid Bearer header) must be
// rejected when Sec-Fetch-Site says the request came from another site — a page on another
// local port is "same-site" but not the Tandem origin, and its GETs still carry the SameSite=Strict
// cookie since they share the top-level site. Absent, "same-origin" or "none" must still work
// (browsers that omit the header, and same-origin navigation/fetch).
func TestCookieAuthRejectsSameSiteAndCrossSite(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	path := "/api/sessions/" + sid + "/state"
	for _, sfs := range []string{"same-site", "cross-site"} {
		req, err := http.NewRequest("GET", e.hs.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: "tandem_token", Value: e.token})
		req.Header.Set("Sec-Fetch-Site", sfs)
		resp, err := e.hs.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("Sec-Fetch-Site=%s: %d, want 403", sfs, resp.StatusCode)
		}
	}
	for _, sfs := range []string{"same-origin", "none", ""} {
		req, err := http.NewRequest("GET", e.hs.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: "tandem_token", Value: e.token})
		if sfs != "" {
			req.Header.Set("Sec-Fetch-Site", sfs)
		}
		resp, err := e.hs.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("Sec-Fetch-Site=%q: %d, want 200", sfs, resp.StatusCode)
		}
	}
}

func TestTokenQuerySetsCookie(t *testing.T) {
	e := newTestEnv(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(e.hs.URL + "/s/s_abc123?token=secret")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != "/s/s_abc123" {
		t.Fatalf("redirect: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	c := resp.Cookies()
	if len(c) != 1 || c[0].Name != "tandem_token" || !c[0].HttpOnly || c[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie = %+v", c)
	}
	req, _ := http.NewRequest("GET", e.hs.URL+"/s/s_abc123", nil)
	req.AddCookie(c[0])
	resp, _ = client.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("page with cookie: %d", resp.StatusCode)
	}
}

// Carried from Task 9 review: the token-exchange redirect must not become an open redirect for
// a protocol-relative path like //evil.example/x, including the backslash variant browsers
// normalise to // (review round 1, finding 4).
func TestTokenQueryRedirectRejectsProtocolRelativePath(t *testing.T) {
	e := newTestEnv(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	resp, err := client.Get(e.hs.URL + "//evil.example/x?token=secret&extra=1")
	if err != nil {
		t.Fatal(err)
	}
	if loc := resp.Header.Get("Location"); resp.StatusCode != http.StatusSeeOther || loc != "/evil.example/x?extra=1" {
		t.Fatalf("redirect: %d %q", resp.StatusCode, loc)
	}

	resp, err = client.Get(e.hs.URL + "/%5Cevil.example/x?token=secret&extra=1")
	if err != nil {
		t.Fatal(err)
	}
	if loc := resp.Header.Get("Location"); resp.StatusCode != http.StatusSeeOther || loc != "/evil.example/x?extra=1" {
		t.Fatalf("backslash redirect: %d %q", resp.StatusCode, loc)
	}
}

// Carried from Task 9 review: unknown /api/ paths must get a JSON 404, not the placeholder page.
func TestUnknownAPIPathReturnsJSON404(t *testing.T) {
	e := newTestEnv(t)
	if code, out := e.do("GET", "/api/nope", ""); code != 404 || !strings.Contains(out, `"code":"not_found"`) {
		t.Fatalf("unknown api path: %d %s", code, out)
	}
	if code, out := e.do("POST", "/api/nope", ""); code != 404 || !strings.Contains(out, `"code":"not_found"`) {
		t.Fatalf("unknown api path (POST): %d %s", code, out)
	}
}

func TestCommandsStateAndErrors(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	if code, out := e.command(sid, "stage.add", `{"title":"Data model"}`); code != 200 || out != "{\"id\":\"st_1\"}\n" {
		t.Fatalf("stage.add: %d %q", code, out)
	}
	code, out := e.do("GET", "/api/sessions/"+sid+"/state", "")
	if code != 200 || !strings.Contains(out, `"title":"Data model"`) {
		t.Fatalf("state: %d %s", code, out)
	}
	code, out = e.command(sid, "thread.add", `{"title":"x","stageId":"st_9"}`)
	if code != 404 || !strings.Contains(out, `"code":"stage_not_found"`) || !strings.Contains(out, `"hint"`) {
		t.Fatalf("error: %d %s", code, out)
	}
	if code, _ := e.command(sid, "variant.choose", `{}`); code != 400 {
		t.Fatalf("agent sending user command: %d", code)
	}
	if code, _ := e.do("GET", "/api/sessions/s_nope00/state", ""); code != 404 {
		t.Fatalf("unknown session: %d", code)
	}
	code, out = e.do("GET", "/api/projects/p1", "")
	if code != 200 || !strings.Contains(out, `"activeSessionId":"`+sid+`"`) {
		t.Fatalf("project: %d %s", code, out)
	}
	if code, _ := e.do("GET", "/api/projects/nope", ""); code != 404 {
		t.Fatalf("unknown project: %d", code)
	}
}

func TestFileBlockContentBecomesBlob(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	code, out := e.command(sid, "block.add", `{"type":"file","path":"a.kt","lang":"kotlin","content":"x\ny\n","firstLine":3}`)
	if code != 200 {
		t.Fatalf("block.add: %d %s", code, out)
	}
	_, state := e.do("GET", "/api/sessions/"+sid+"/state", "")
	var snap struct {
		Blocks map[string]struct {
			BlobSHA   string `json:"blobSha"`
			FirstLine int    `json:"firstLine"`
			LineCount int    `json:"lineCount"`
		} `json:"blocks"`
	}
	json.Unmarshal([]byte(state), &snap)
	b := snap.Blocks["b_1"]
	if b.FirstLine != 3 || b.LineCount != 2 {
		t.Fatalf("block = %+v", b)
	}
	if code, blob := e.do("GET", "/api/sessions/"+sid+"/blobs/"+b.BlobSHA, ""); code != 200 || blob != "x\ny\n" {
		t.Fatalf("blob: %d %q", code, blob)
	}
}

func TestActionWithDraftAndEvents(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	e.command(sid, "block.add", `{"type":"code","lang":"go","text":"a\nb\n"}`)
	e.command(sid, "block.add", `{"type":"variants","variants":{"options":[{"title":"X"},{"title":"Y"}]}}`)
	code, out := e.do("POST", "/api/sessions/"+sid+"/actions",
		`{"type":"variant.choose","data":{"blockId":"b_2","optionId":"o_1"},
		  "draft":{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":2,"end":2},"text":"hm"}]}]}}`,
		"Origin", e.hs.URL)
	if code != 200 {
		t.Fatalf("action: %d %s", code, out)
	}
	_, events := e.do("GET", "/api/sessions/"+sid+"/events?since=5", "")
	lines := strings.Split(strings.TrimSpace(events), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"review.submitted"`) || !strings.Contains(lines[1], `"variant.chosen"`) {
		t.Fatalf("events after 5:\n%s", events)
	}
	_, all := e.do("GET", "/api/sessions/"+sid+"/events?stage=st_1", "")
	if n := len(strings.Split(strings.TrimSpace(all), "\n")); n != 6 {
		t.Fatalf("stage filter returned %d events", n)
	}
}

func TestAllSessionsListsEveryProject(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session() // project p1, name "r", title "Idea"
	code, out := e.do("POST", "/api/sessions", `{"project":{"id":"p2","rootPath":"/q","name":"q"},"title":"Other"}`)
	if code != 200 {
		t.Fatalf("create: %d %s", code, out)
	}
	code, out = e.do("GET", "/api/sessions", "")
	var list []SessionSummary
	if err := json.Unmarshal([]byte(out), &list); err != nil || code != 200 {
		t.Fatalf("list: %d %s %v", code, out, err)
	}
	if len(list) != 2 || list[0].ID != sid || list[0].ProjectName != "r" || !list[0].Active ||
		list[1].Title != "Other" || list[1].ProjectName != "q" || !list[1].Active {
		t.Fatalf("list = %+v", list)
	}
}

func TestAllSessionsEmptyIsArray(t *testing.T) {
	e := newTestEnv(t)
	if code, out := e.do("GET", "/api/sessions", ""); code != 200 || strings.TrimSpace(out) != "[]" {
		t.Fatalf("empty list: %d %q", code, out)
	}
}

func TestRenderAndSessions(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	code, out := e.do("GET", "/api/sessions/"+sid+"/render/export", "")
	if code != 200 || out != "# Idea\n" {
		t.Fatalf("export: %d %q", code, out)
	}
	if code, _ := e.do("GET", "/api/sessions/"+sid+"/render/nope", ""); code != 400 {
		t.Fatalf("unknown view: %d", code)
	}
	sid2 := e.session()
	if code, _ := e.do("POST", "/api/projects/p1/active", `{"sessionId":"`+sid+`"}`); code != 200 {
		t.Fatal("set active")
	}
	_, list := e.do("GET", "/api/projects/p1/sessions", "")
	var infos []SessionInfo
	json.Unmarshal([]byte(list), &infos)
	active := map[string]bool{}
	for _, i := range infos {
		active[i.ID] = i.Active
	}
	if len(infos) != 2 || !active[sid] || active[sid2] {
		t.Fatalf("sessions = %+v", infos)
	}
}

// Question message spec: ask/withdraw are agent commands, question.answer a user action. A draft
// sent with an answer lands first as its own review.submitted, in one atomic batch (Review Focus 3).
func TestQuestionActions(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	e.command(sid, "block.add", `{"type":"code","lang":"go","text":"a\nb\n"}`)
	if code, out := e.command(sid, "ask", `{"text":"Keep it?","options":["Yes","No"]}`); code != 200 || out != "{\"id\":\"q_1\",\"optionIds\":[\"o_1\",\"o_2\"]}\n" {
		t.Fatalf("ask: %d %q", code, out)
	}
	action := func(body string) (int, string) {
		return e.do("POST", "/api/sessions/"+sid+"/actions", body, "Origin", e.hs.URL)
	}
	draft := `"draft":{"threads":[{"threadId":"t_1","comments":[{"blockId":"b_1","lines":{"start":2,"end":2},"text":"hm"}]}]}`
	if code, out := action(`{"type":"question.answer","data":{"questionId":"q_1","optionId":"o_2"},` + draft + `}`); code != 200 {
		t.Fatalf("answer: %d %s", code, out)
	}
	_, events := e.do("GET", "/api/sessions/"+sid+"/events?since=5", "")
	lines := strings.Split(strings.TrimSpace(events), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"review.submitted"`) || !strings.Contains(lines[1], `"question.answered"`) {
		t.Fatalf("events after 5:\n%s", events)
	}
	// A rejected answer saves nothing, not even its draft.
	code, out := action(`{"type":"question.answer","data":{"questionId":"q_1","optionId":"o_1"},` + draft + `}`)
	if code != 400 || !strings.Contains(out, `"code":"question_closed"`) {
		t.Fatalf("second answer: %d %s", code, out)
	}
	if _, after := e.do("GET", "/api/sessions/"+sid+"/events?since=7", ""); strings.TrimSpace(after) != "" {
		t.Fatalf("a rejected answer wrote events:\n%s", after)
	}
	if code, out := e.command(sid, "question.withdraw", `{"questionId":"q_9"}`); code != 404 || !strings.Contains(out, `"code":"question_not_found"`) {
		t.Fatalf("withdraw unknown: %d %s", code, out)
	}
	if code, _ := e.command(sid, "question.answer", `{"questionId":"q_1","optionId":"o_1"}`); code != 400 {
		t.Fatalf("agent sending a user command: %d", code)
	}
}

func TestFileBlockDiffBecomesBlob(t *testing.T) {
	e := newTestEnv(t)
	sid := e.session()
	e.command(sid, "stage.add", `{"title":"A"}`)
	e.command(sid, "thread.add", `{"title":"T"}`)
	code, out := e.command(sid, "block.add", `{"type":"file","path":"a.kt","content":"x\ny\n","diff":"@@ -1 +1 @@\n-w\n+x\n"}`)
	if code != 200 {
		t.Fatalf("block.add: %d %s", code, out)
	}
	_, state := e.do("GET", "/api/sessions/"+sid+"/state", "")
	var snap struct {
		Blocks map[string]struct {
			DiffSHA string `json:"diffSha"`
			Diff    string `json:"diff"`
		} `json:"blocks"`
	}
	json.Unmarshal([]byte(state), &snap)
	b := snap.Blocks["b_1"]
	if b.DiffSHA == "" || b.Diff != "" {
		t.Fatalf("block = %+v", b)
	}
	if code, blob := e.do("GET", "/api/sessions/"+sid+"/blobs/"+b.DiffSHA, ""); code != 200 || blob != "@@ -1 +1 @@\n-w\n+x\n" {
		t.Fatalf("blob: %d %q", code, blob)
	}
}
