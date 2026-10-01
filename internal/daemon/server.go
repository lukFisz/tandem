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

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/editor"
)

//go:embed webdist
var webdist embed.FS

type Config struct {
	Home        string
	Version     string
	Token       string
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

func (s *Server) sessionURL(sid string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/s/%s?token=%s", s.cfg.Port, sid, s.cfg.Token)
}

// guard enforces Host, Origin and token checks (spec §7 Security).
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		if r.URL.Path == "/health" {
			// Idle means "no API requests": /health is not an API request.
			next.ServeHTTP(w, r)
			return
		}
		if tok := r.URL.Query().Get("token"); tok != "" && r.Method == http.MethodGet && !strings.HasPrefix(r.URL.Path, "/api/") {
			if !s.validToken(tok) {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid token", "open the page with `tdm open`")
				return
			}
			s.activity.Touch()
			http.SetCookie(w, &http.Cookie{Name: "tandem_token", Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			q := r.URL.Query()
			q.Del("token")
			// Build the redirect target ourselves ("/" + trimmed path + query) instead of
			// reusing r.URL.RequestURI(): a protocol-relative path like //evil.example/x (or a
			// backslash variant like /\evil.example/x, which browsers normalise to //) would
			// otherwise redirect the browser off-host (open redirect). Trim both '/' and '\' so
			// no combination of leading slashes/backslashes survives.
			target := "/" + strings.TrimLeft(r.URL.Path, "/\\")
			if enc := q.Encode(); enc != "" {
				target += "?" + enc
			}
			http.Redirect(w, r, target, http.StatusSeeOther)
			return
		}
		// require the literal "Bearer " prefix: without it, a bare token in the Authorization
		// header would be treated the same as a correctly-formed bearer token.
		bearerTok, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		validBearer := hasBearer && s.validToken(bearerTok)

		cookie := ""
		if c, err := r.Cookie("tandem_token"); err == nil {
			cookie = c.Value
		}
		validCookie := s.validToken(cookie)

		// /wait changes state as a side effect of a GET (supersedes the previous waiter, marks
		// events delivered — see BeginWait/MarkDelivered): unlike every other GET route it must
		// accept only a Bearer token. SameSite=Strict still sends the cookie on a request from
		// another page on the same top-level site (e.g. 127.0.0.1:<other-port>), which is not
		// this app, so the cookie alone must never be enough to start a wait.
		isWait := strings.HasPrefix(r.URL.Path, "/api/sessions/") && strings.HasSuffix(r.URL.Path, "/wait")
		if isWait {
			if !validBearer {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "the wait endpoint requires a Bearer token", "run `tdm wait`")
				return
			}
		} else if !validBearer {
			if !validCookie {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "missing or invalid token", "open the page with `tdm open`")
				return
			}
			// Cookie-authenticated (no Bearer header): a page on another local port is
			// same-site, so its GETs still carry this SameSite=Strict cookie. Sec-Fetch-Site
			// tells us the request's actual relationship to this origin; reject anything that
			// isn't same-origin (absent or "none" means a browser that doesn't send the header,
			// or a user-typed/bookmarked navigation, both of which are fine).
			if sfs := r.Header.Get("Sec-Fetch-Site"); sfs == "same-site" || sfs == "cross-site" {
				writeErr(w, http.StatusForbidden, "forbidden", "cross-site request ("+sfs+")", "")
				return
			}
		}
		s.activity.Touch()
		next.ServeHTTP(w, r)
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
