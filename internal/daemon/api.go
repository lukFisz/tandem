package daemon

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/lukFisz/tandem/internal/domain"
	"github.com/lukFisz/tandem/internal/editor"
	"github.com/lukFisz/tandem/internal/render"
	"github.com/lukFisz/tandem/internal/store"
)

const maxBody = 8 << 20

func decodeBody(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(into); err != nil {
		writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "invalid JSON body: "+err.Error(), "")
		return false
	}
	return true
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) (*Session, bool) {
	sess, err := s.mgr.Get(r.PathValue("sid"))
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	if fromCLI(r) {
		sess.TouchAgent()
	}
	return sess, true
}

// fromCLI reports whether the request comes from the tdm CLI, that is, from the agent.
func fromCLI(r *http.Request) bool {
	return r.Header.Get(store.ClientHeader) == store.ClientCLI
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.cfg.Version})
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Project store.Project `json:"project"`
		Title   string        `json:"title"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Project.ID == "" {
		writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "project is required", "")
		return
	}
	// The project's root decides which files open-file may open, so it must be the root the id
	// was derived from (store.ProjectFor), never an arbitrary pair from the request body.
	root := req.Project.RootPath
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || store.NewProject(root).ID != req.Project.ID {
		writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "project id does not match its root path", "")
		return
	}
	req.Project = store.NewProject(root)
	sess, err := s.mgr.Create(req.Project, req.Title)
	if err != nil {
		writeError(w, err)
		return
	}
	if fromCLI(r) {
		sess.TouchAgent()
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": sess.ID(), "url": s.sessionURL(sess.ID())})
}

func (s *Server) allSessions(w http.ResponseWriter, _ *http.Request) {
	list, err := s.mgr.AllSessions()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	p, err := store.LoadProject(s.cfg.Home, r.PathValue("pid"))
	if err != nil {
		writeError(w, err)
		return
	}
	if p == nil {
		writeError(w, &domain.Error{Code: domain.CodeProjectNotFound, Message: "no sessions in this project yet",
			Hint: "run `tdm session new \"<title>\"`"})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	infos, err := s.mgr.Sessions(r.PathValue("pid"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, infos)
}

func (s *Server) setActive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SessionID string `json:"sessionId"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if err := s.mgr.SetActive(r.PathValue("pid"), req.SessionID); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": req.SessionID})
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	var body []byte
	var err error
	sess.Read(func(st *domain.State, _ []domain.Event) { body, err = json.Marshal(st) })
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

type wireCommand struct {
	Type  string               `json:"type"`
	Data  json.RawMessage      `json:"data"`
	Draft *domain.SubmitReview `json:"draft,omitempty"`
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	s.execute(w, r, domain.ActorAI)
}

func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	s.execute(w, r, domain.ActorUser)
}

// execute runs one wire command. For user actions, a non-empty draft is submitted in the same batch first.
func (s *Server) execute(w http.ResponseWriter, r *http.Request, actor domain.Actor) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	var req wireCommand
	if !decodeBody(w, r, &req) {
		return
	}
	cmd, err := domain.DecodeCommand(actor, req.Type, req.Data)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := sess.StoreContent(cmd); err != nil {
		writeError(w, err)
		return
	}
	var cmds []domain.Command
	if actor == domain.ActorUser && req.Draft != nil && len(req.Draft.Threads) > 0 && req.Type != "review.submit" {
		cmds = append(cmds, req.Draft)
	}
	res, err := sess.Execute(append(cmds, cmd)...)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) render(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	stage := r.URL.Query().Get("stage")
	var out string
	var err error
	sess.Read(func(st *domain.State, evs []domain.Event) {
		switch r.PathValue("what") {
		case "show":
			out, err = render.Show(st, evs, sess.Blob)
		case "summarize":
			out, err = render.Summarize(st, stage)
		case "export":
			out, err = render.Export(st, stage)
		default:
			err = &domain.Error{Code: domain.CodeInvalidInput, Message: "unknown view " + r.PathValue("what")}
		}
	})
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Write([]byte(out))
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	stage := r.URL.Query().Get("stage")
	var out []domain.Event
	sess.Read(func(st *domain.State, evs []domain.Event) {
		for _, e := range evs {
			if e.Seq <= since || (stage != "" && domain.EventStageID(st, e) != stage) {
				continue
			}
			out = append(out, e)
		}
	})
	w.Header().Set("Content-Type", "application/x-ndjson")
	enc := json.NewEncoder(w)
	for _, e := range out {
		enc.Encode(e)
	}
}

func (s *Server) blob(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	data, err := sess.Blob(r.PathValue("sha"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "blob_not_found", err.Error(), "")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

func (s *Server) shutdown(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	go s.stop()
}

type settingsView struct {
	Editor  string        `json:"editor"`
	Editors []editor.Info `json:"editors"`
}

func (s *Server) settingsView() (settingsView, error) {
	cfg, err := store.LoadSettings(s.cfg.Home)
	if err != nil {
		return settingsView{}, err
	}
	list := s.probe().Detect()
	picked := editor.Pick(list, cfg.Editor)
	return settingsView{Editor: picked.ID, Editors: list}, nil
}

func (s *Server) getSettings(w http.ResponseWriter, _ *http.Request) {
	v, err := s.settingsView()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Editor string `json:"editor"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	list := s.probe().Detect()
	picked := editor.Pick(list, req.Editor)
	if req.Editor != "" && picked.ID != req.Editor {
		writeErr(w, http.StatusBadRequest, domain.CodeInvalidInput, "editor "+req.Editor+" is not installed",
			"pick one of the detected editors")
		return
	}
	if err := store.SaveSettings(s.cfg.Home, store.Settings{Editor: picked.ID}); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settingsView{Editor: picked.ID, Editors: list})
}

func (s *Server) openFile(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.session(w, r)
	if !ok {
		return
	}
	var req struct {
		Path string `json:"path"`
		Line int    `json:"line"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	p, err := store.LoadProject(s.cfg.Home, sess.pid)
	if err != nil {
		writeError(w, err)
		return
	}
	if p == nil || p.RootPath == "" {
		writeErr(w, http.StatusNotFound, domain.CodeProjectNotFound, "project has no root path", "")
		return
	}
	abs, err := editor.ResolveInRoot(p.RootPath, req.Path)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "path_outside_project", err.Error(), "Tandem only opens files inside the project")
		return
	}
	if _, err := os.Stat(abs); err != nil {
		writeErr(w, http.StatusNotFound, "file_not_found", req.Path+" is not on disk", "the snapshot is frozen; the live file may have moved")
		return
	}
	cfg, err := store.LoadSettings(s.cfg.Home)
	if err != nil {
		writeError(w, err)
		return
	}
	ed := editor.Pick(s.probe().Detect(), cfg.Editor)
	if !ed.Installed {
		writeErr(w, http.StatusBadRequest, "no_editor", "no supported editor is installed",
			"install Cursor, VS Code, Zed, Sublime Text, or a JetBrains IDE")
		return
	}
	if err := s.open(ed, abs, req.Line); err != nil {
		writeErr(w, http.StatusInternalServerError, "open_failed", err.Error(), "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "editor": ed.ID})
}
