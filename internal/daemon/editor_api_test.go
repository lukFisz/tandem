package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lukFisz/tandem/internal/editor"
	"github.com/lukFisz/tandem/internal/store"
)

func fakeProbe(installed ...string) func() editor.Probe {
	set := map[string]bool{}
	for _, id := range installed {
		set[id] = true
	}
	return func() editor.Probe {
		return editor.Probe{LookPath: func(name string) (string, error) {
			want := map[string]string{"cursor": "cursor", "code": "vscode", "zed": "zed", "subl": "sublime", "idea": "idea", "goland": "goland", "webstorm": "webstorm"}
			if id := want[name]; set[id] {
				return "/bin/" + name, nil
			}
			return "", os.ErrNotExist
		}}
	}
}

func TestSettingsListsDetectedEditors(t *testing.T) {
	e := newTestEnv(t)
	e.srv.probeFn = fakeProbe("cursor", "vscode")
	code, out := e.do("GET", "/api/settings", "")
	if code != 200 {
		t.Fatalf("%d %s", code, out)
	}
	var v struct {
		Editor  string
		Editors []struct {
			ID, Name  string
			Installed bool
		}
	}
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		t.Fatal(err)
	}
	if v.Editor != "cursor" {
		t.Fatalf("default editor = %q", v.Editor)
	}
	byID := map[string]bool{}
	for _, ed := range v.Editors {
		byID[ed.ID] = ed.Installed
	}
	if !byID["cursor"] || !byID["vscode"] || byID["zed"] {
		t.Fatalf("installed = %v", byID)
	}
}

func TestPutSettingsPersistsEditor(t *testing.T) {
	e := newTestEnv(t)
	e.srv.probeFn = fakeProbe("cursor", "vscode")
	code, out := e.do("PUT", "/api/settings", `{"editor":"vscode"}`)
	if code != 200 {
		t.Fatalf("%d %s", code, out)
	}
	got, err := store.LoadSettings(e.home)
	if err != nil || got.Editor != "vscode" {
		t.Fatalf("saved %+v, %v", got, err)
	}
	code, out = e.do("PUT", "/api/settings", `{"editor":"zed"}`)
	if code != 400 || !strings.Contains(out, "not installed") {
		t.Fatalf("unknown editor: %d %s", code, out)
	}
}

func TestOpenFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte("package a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e := newTestEnv(t)
	e.srv.probeFn = fakeProbe("cursor")
	var opened struct {
		file string
		line int
		id   string
	}
	e.srv.openFn = func(ed editor.Info, file string, line int) error {
		opened.file, opened.line, opened.id = file, line, ed.ID
		return nil
	}
	body, _ := json.Marshal(map[string]any{"project": store.Project{ID: "p1", RootPath: root, Name: "r"}, "title": "Idea"})
	code, out := e.do("POST", "/api/sessions", string(body))
	if code != 200 {
		t.Fatalf("create: %d %s", code, out)
	}
	var res struct{ ID string }
	json.Unmarshal([]byte(out), &res)
	code, out = e.do("POST", "/api/sessions/"+res.ID+"/open-file", `{"path":"a.go","line":4}`)
	if code != 200 {
		t.Fatalf("open: %d %s", code, out)
	}
	if filepath.Base(opened.file) != "a.go" || opened.line != 4 || opened.id != "cursor" {
		t.Fatalf("opened %+v", opened)
	}

	code, out = e.do("POST", "/api/sessions/"+res.ID+"/open-file", `{"path":"../secret","line":1}`)
	if code != 400 || !strings.Contains(out, "path_outside_project") {
		t.Fatalf("escape: %d %s", code, out)
	}
	code, out = e.do("POST", "/api/sessions/"+res.ID+"/open-file", `{"path":"missing.go","line":1}`)
	if code != 404 || !strings.Contains(out, "file_not_found") {
		t.Fatalf("missing: %d %s", code, out)
	}
}
