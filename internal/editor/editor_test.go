package editor

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDetectLookPath(t *testing.T) {
	p := Probe{LookPath: func(name string) (string, error) {
		if name == "cursor" {
			return "/bin/cursor", nil
		}
		return "", errors.New("not found")
	}}
	list := p.Detect()
	if !list[0].Installed || list[0].ID != "cursor" || list[0].bin != "/bin/cursor" {
		t.Fatalf("cursor = %+v", list[0])
	}
	if list[1].Installed {
		t.Fatal("vscode should not be installed")
	}
}

func TestDetectAppBundle(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "Cursor.app", "Contents", "Resources", "app", "bin", "cursor")
	if err := os.MkdirAll(filepath.Dir(bin), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("x"), 0o700); err != nil {
		t.Fatal(err)
	}
	p := Probe{LookPath: func(string) (string, error) { return "", errors.New("no") }, AppRoot: root}
	list := p.Detect()
	if !list[0].Installed || list[0].bin != bin {
		t.Fatalf("cursor app = %+v", list[0])
	}
}

func TestPick(t *testing.T) {
	list := []Info{
		{ID: "cursor", Installed: false},
		{ID: "vscode", Installed: true, bin: "/bin/code"},
		{ID: "zed", Installed: true, bin: "/bin/zed"},
	}
	if got := Pick(list, "zed"); got.ID != "zed" {
		t.Fatalf("pick zed = %+v", got)
	}
	if got := Pick(list, "cursor"); got.ID != "vscode" {
		t.Fatalf("missing id falls back to first installed, got %+v", got)
	}
	if got := Pick(list, ""); got.ID != "vscode" {
		t.Fatalf("default = %+v", got)
	}
	if got := Pick(nil, "vscode"); got.Installed {
		t.Fatal("empty list")
	}
}

func TestResolveInRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	abs, err := ResolveInRoot(root, "a.go")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(abs) != "a.go" {
		t.Fatalf("abs = %s", abs)
	}
	if _, err := ResolveInRoot(root, "../secret"); err == nil {
		t.Fatal("want escape error")
	}
	if _, err := ResolveInRoot(root, ""); err == nil {
		t.Fatal("want empty path error")
	}
}

func TestGLineArgs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip()
	}
	got := gLine("/tmp/a.go", 12)
	if len(got) != 2 || got[0] != "-g" || got[1] != "/tmp/a.go:12" {
		t.Fatalf("args = %v", got)
	}
	if got := gLine("/tmp/a.go", 0); len(got) != 1 || got[0] != "/tmp/a.go" {
		t.Fatalf("no line = %v", got)
	}
}
