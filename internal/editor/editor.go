package editor

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Info is one editor the page can pick.
type Info struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	bin       string
	args      func(file string, line int) []string
}

type spec struct {
	id, name string
	bins     []string
	apps     []string // names under AppRoot, macOS
	appBin   string   // path inside the .app
	args     func(file string, line int) []string
}

func gLine(file string, line int) []string {
	if line > 0 {
		return []string{"-g", fmt.Sprintf("%s:%d", file, line)}
	}
	return []string{file}
}

func colonLine(file string, line int) []string {
	if line > 0 {
		return []string{fmt.Sprintf("%s:%d", file, line)}
	}
	return []string{file}
}

func jetbrainsLine(file string, line int) []string {
	if line > 0 {
		return []string{"--line", fmt.Sprintf("%d", line), file}
	}
	return []string{file}
}

var catalog = []spec{
	{id: "cursor", name: "Cursor", bins: []string{"cursor"},
		apps: []string{"Cursor.app"}, appBin: "Contents/Resources/app/bin/cursor", args: gLine},
	{id: "vscode", name: "Visual Studio Code", bins: []string{"code"},
		apps: []string{"Visual Studio Code.app"}, appBin: "Contents/Resources/app/bin/code", args: gLine},
	{id: "zed", name: "Zed", bins: []string{"zed"},
		apps: []string{"Zed.app"}, appBin: "Contents/MacOS/cli", args: colonLine},
	{id: "sublime", name: "Sublime Text", bins: []string{"subl"},
		apps: []string{"Sublime Text.app"}, appBin: "Contents/SharedSupport/bin/subl", args: colonLine},
	{id: "idea", name: "IntelliJ IDEA", bins: []string{"idea"},
		apps: []string{"IntelliJ IDEA.app", "IntelliJ IDEA CE.app"}, appBin: "Contents/MacOS/idea", args: jetbrainsLine},
	{id: "goland", name: "GoLand", bins: []string{"goland"},
		apps: []string{"GoLand.app"}, appBin: "Contents/MacOS/goland", args: jetbrainsLine},
	{id: "webstorm", name: "WebStorm", bins: []string{"webstorm"},
		apps: []string{"WebStorm.app"}, appBin: "Contents/MacOS/webstorm", args: jetbrainsLine},
}

// Probe finds installed editors. Tests swap LookPath and AppRoot.
type Probe struct {
	LookPath func(file string) (string, error)
	AppRoot  string
}

func DefaultProbe() Probe {
	root := "/Applications"
	if runtime.GOOS != "darwin" {
		root = ""
	}
	return Probe{LookPath: exec.LookPath, AppRoot: root}
}

// Detect returns the catalog with Installed set. Order is the default-pick order.
func (p Probe) Detect() []Info {
	out := make([]Info, 0, len(catalog))
	for _, sp := range catalog {
		info := Info{ID: sp.id, Name: sp.name, args: sp.args}
		if bin := p.find(sp); bin != "" {
			info.Installed, info.bin = true, bin
		}
		out = append(out, info)
	}
	return out
}

func (p Probe) find(sp spec) string {
	for _, name := range sp.bins {
		if bin, err := p.LookPath(name); err == nil && bin != "" {
			return bin
		}
	}
	if p.AppRoot == "" {
		return ""
	}
	for _, app := range sp.apps {
		bin := filepath.Join(p.AppRoot, app, sp.appBin)
		if st, err := os.Stat(bin); err == nil && !st.IsDir() {
			return bin
		}
	}
	return ""
}

// Pick returns the installed editor with id, or the first installed, or a zero Info.
func Pick(list []Info, id string) Info {
	if id != "" {
		for _, e := range list {
			if e.ID == id && e.Installed {
				return e
			}
		}
	}
	for _, e := range list {
		if e.Installed {
			return e
		}
	}
	return Info{}
}

// Open starts the editor on file, optionally at line. It does not wait.
func Open(e Info, file string, line int) error {
	if !e.Installed || e.bin == "" {
		return fmt.Errorf("editor %s is not installed", e.ID)
	}
	cmd := exec.Command(e.bin, e.args(file, line)...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

// ResolveInRoot joins root and a project-relative slash path, rejecting escapes.
func ResolveInRoot(root, rel string) (string, error) {
	if rel == "" {
		return "", fmt.Errorf("path is required")
	}
	abs, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(abs); err == nil {
		abs = r
	} else if dir, err := filepath.EvalSymlinks(filepath.Dir(abs)); err == nil {
		abs = filepath.Join(dir, filepath.Base(abs))
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(rootAbs); err == nil {
		rootAbs = r
	}
	got, err := filepath.Rel(rootAbs, abs)
	if err != nil || got == ".." || strings.HasPrefix(got, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside the project", rel)
	}
	return abs, nil
}
