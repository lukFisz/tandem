package daemon

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/lukFisz/tandem/internal/domain"
	"github.com/lukFisz/tandem/internal/editor"
)

//go:embed webdist
var webdist embed.FS

type Config struct {
	Home        string
	Version     string
	Token       string // the CLI's token: every route
	PageToken   string // the review page's token: pageRoutes only
	Port        int
	IdleTimeout time.Duration
}

type Server struct {
	cfg      Config
	mgr      *Manager
	stop     func()
	activity *activity
	probeFn  func() editor.Probe
	openFn   func(editor.Info, string, int) error
}

func NewServer(cfg Config, mgr *Manager, stop func()) *Server {
	return &Server{cfg: cfg, mgr: mgr, stop: stop, activity: newActivity()}
}

func (s *Server) probe() editor.Probe {
	if s.probeFn != nil {
		return s.probeFn()
	}
	return editor.DefaultProbe()
}

func (s *Server) open(e editor.Info, file string, line int) error {
	if s.openFn != nil {
		return s.openFn(e, file, line)
	}
	return editor.Open(e, file, line)
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /api/sessions", s.allSessions)
	mux.HandleFunc("POST /api/sessions", s.createSession)
	mux.HandleFunc("GET /api/projects/{pid}", s.getProject)
	mux.HandleFunc("GET /api/projects/{pid}/sessions", s.listSessions)
	mux.HandleFunc("POST /api/projects/{pid}/active", s.setActive)
	mux.HandleFunc("GET /api/sessions/{sid}/state", s.state)
	mux.HandleFunc("POST /api/sessions/{sid}/commands", s.command)
	mux.HandleFunc("POST /api/sessions/{sid}/actions", s.action)
	mux.HandleFunc("GET /api/sessions/{sid}/render/{what}", s.render)
	mux.HandleFunc("GET /api/sessions/{sid}/events", s.events)
	mux.HandleFunc("GET /api/sessions/{sid}/blobs/{sha}", s.blob)
	mux.HandleFunc("GET /api/sessions/{sid}/wait", s.wait)
	mux.HandleFunc("GET /api/sessions/{sid}/stream", s.stream)
	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("PUT /api/settings", s.putSettings)
	mux.HandleFunc("POST /api/sessions/{sid}/open-file", s.openFile)
	mux.HandleFunc("POST /api/shutdown", s.shutdown)
	mux.HandleFunc("GET /api/", apiNotFound)
	mux.HandleFunc("POST /api/", apiNotFound)
	mux.HandleFunc("PUT /api/", apiNotFound)
	mux.Handle("GET /", s.page())
	return s.guard(mux)
}

// sessionURL is the page link for sid. It carries the page token, never the CLI token: the page
// reads it once, keeps it in localStorage and strips it from the address bar.
func (s *Server) sessionURL(sid string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/s/%s?token=%s", s.cfg.Port, sid, s.cfg.PageToken)
}

// pageRoutes are the routes the review page calls, by mux pattern. The page token works on these
// only, so a leaked page token cannot run agent commands, create sessions, start a wait or stop
// the daemon. Keep in sync with web/src/dev/proxyPolicy.ts.
var pageRoutes = map[string]bool{
	"GET /api/sessions":                     true,
	"GET /api/sessions/{sid}/state":         true,
	"GET /api/sessions/{sid}/stream":        true,
	"GET /api/sessions/{sid}/blobs/{sha}":   true,
	"GET /api/sessions/{sid}/render/{what}": true,
	"POST /api/sessions/{sid}/actions":      true,
	"GET /api/settings":                     true,
	"PUT /api/settings":                     true,
	"POST /api/sessions/{sid}/open-file":    true,
}

// streamPattern is the one route that also takes the page token as ?token=: EventSource cannot
// send an Authorization header.
const streamPattern = "GET /api/sessions/{sid}/stream"

// contentSecurityPolicy allows only the embedded UI's own scripts, styles, fonts and API: no
// inline scripts, no remote images (markdown from untrusted content cannot beacon out), and no
// framing.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
	"form-action 'none'; frame-ancestors 'none'"

// guard enforces Host, Origin and token checks (spec §7 Security).
//
// There are two tokens and no cookie. The CLI sends its token as a Bearer header and may call any
// route. The page sends the page token as a Bearer header (or ?token= on the stream) and may call
// pageRoutes only. A cookie would be sent to every port on 127.0.0.1 — cookies are not scoped by
// port — so any other local web server the browser visits would receive it.
func (s *Server) guard(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		if !s.allowedHost(r.Host) {
			writeErr(w, http.StatusForbidden, "bad_host", "unexpected Host header "+r.Host, "")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if o := r.Header.Get("Origin"); o != "" && !s.allowedHost(strings.TrimPrefix(o, "http://")) {
				writeErr(w, http.StatusForbidden, "bad_origin", "cross-origin request from "+o, "")
				return
			}
		}
		_, pattern := mux.Handler(r)
		switch pattern {
		case "GET /health":
			// Idle means "no API requests": /health is not an API request.
			mux.ServeHTTP(w, r)
			return
		case "GET /":
			// The embedded UI holds no data or secrets; it authenticates its own API calls.
			mux.ServeHTTP(w, r)
			return
		}
		// require the literal "Bearer " prefix: without it, a bare token in the Authorization
		// header would be treated the same as a correctly-formed bearer token.
		tok, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !hasBearer && pattern == streamPattern {
			tok = r.URL.Query().Get("token")
		}
		switch {
		case hasBearer && s.validToken(tok):
			// The CLI: every route.
		case s.validPageToken(tok):
			if !pageRoutes[pattern] {
				writeErr(w, http.StatusForbidden, "forbidden", "the page token cannot call "+r.Method+" "+r.URL.Path, "")
				return
			}
			// Defense in depth: the page only ever calls its own origin.
			if sfs := r.Header.Get("Sec-Fetch-Site"); sfs == "same-site" || sfs == "cross-site" {
				writeErr(w, http.StatusForbidden, "forbidden", "cross-site request ("+sfs+")", "")
				return
			}
		default:
			writeErr(w, http.StatusUnauthorized, "unauthorized", "missing or invalid token", "open the page with `tdm open`")
			return
		}
		s.activity.Touch()
		mux.ServeHTTP(w, r)
	})
}

// apiNotFound answers unknown /api/ paths with a JSON 404 instead of falling through to the
// placeholder HTML page.
func apiNotFound(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusNotFound, "not_found", "unknown API path "+r.URL.Path, "")
}

func (s *Server) allowedHost(h string) bool {
	return h == fmt.Sprintf("127.0.0.1:%d", s.cfg.Port) || h == fmt.Sprintf("localhost:%d", s.cfg.Port)
}

func (s *Server) validToken(t string) bool {
	return t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(s.cfg.Token)) == 1
}

func (s *Server) validPageToken(t string) bool {
	return t != "" && s.cfg.PageToken != "" && subtle.ConstantTimeCompare([]byte(t), []byte(s.cfg.PageToken)) == 1
}

// page serves the embedded UI; any non-file path gets index.html (client-side routing).
func (s *Server) page() http.Handler {
	sub, _ := fs.Sub(webdist, "webdist")
	files := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(sub, strings.TrimPrefix(r.URL.Path, "/")); err != nil || r.URL.Path == "/" {
			http.ServeFileFS(w, r, sub, "index.html")
			return
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, message, hint string) {
	writeJSON(w, status, map[string]any{"error": domain.Error{Code: code, Message: message, Hint: hint}})
}

func writeError(w http.ResponseWriter, err error) {
	var de *domain.Error
	if errors.As(err, &de) {
		status := http.StatusBadRequest
		if de.NotFound() {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]any{"error": de})
		return
	}
	writeErr(w, http.StatusInternalServerError, "internal", err.Error(), "")
}
