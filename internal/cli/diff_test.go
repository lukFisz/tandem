package cli

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func writeFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCaptureDiff(t *testing.T) {
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	writeFile(t, dir, "clean.txt", "same\n")
	writeFile(t, dir, ".gitignore", "ignored.txt\n")
	gitRun(t, dir, "add", ".")
	gitRun(t, dir, "commit", "-q", "-m", "init")

	if d := captureDiff(dir, "a.txt"); d != "" {
		t.Fatalf("clean tracked file diff = %q", d)
	}
	writeFile(t, dir, "a.txt", "one\nTWO\nthree\nfour\n")
	d := captureDiff(dir, "a.txt")
	for _, want := range []string{"@@ -1,3 +1,4 @@", " one\n", "-two\n", "+TWO\n", " three\n", "+four\n"} {
		if !strings.Contains(d, want) {
			t.Fatalf("diff lacks %q:\n%s", want, d)
		}
	}
	if d := captureDiff(dir, "clean.txt"); d != "" {
		t.Fatalf("clean diff = %q", d)
	}

	writeFile(t, dir, "new.txt", "x\ny\n")
	d = captureDiff(dir, "new.txt")
	if !strings.Contains(d, "@@ -0,0 +1,2 @@") || !strings.Contains(d, "+x\n+y\n") {
		t.Fatalf("untracked diff:\n%s", d)
	}
	gitRun(t, dir, "add", "new.txt")
	if d2 := captureDiff(dir, "new.txt"); !strings.Contains(d2, "+x\n+y\n") {
		t.Fatalf("staged new file diff:\n%s", d2)
	}

	writeFile(t, dir, "ignored.txt", "z\n")
	if d := captureDiff(dir, "ignored.txt"); d != "" {
		t.Fatalf("ignored file diff = %q", d)
	}
}

func TestCaptureDiffNoDiffCases(t *testing.T) {
	notRepo := t.TempDir()
	writeFile(t, notRepo, "f.txt", "a\n")
	if d := captureDiff(notRepo, "f.txt"); d != "" {
		t.Fatalf("non-repo diff = %q", d)
	}
	noHead := t.TempDir()
	gitRun(t, noHead, "init", "-q")
	writeFile(t, noHead, "f.txt", "a\n")
	if d := captureDiff(noHead, "f.txt"); d != "" {
		t.Fatalf("no-HEAD diff = %q", d)
	}
	t.Setenv("PATH", "")
	if d := captureDiff(noHead, "f.txt"); d != "" {
		t.Fatalf("no-git diff = %q", d)
	}
}

func TestFileBlockCarriesDiff(t *testing.T) {
	startDaemon(t)
	cwd, _ := os.Getwd()
	gitRun(t, cwd, "init", "-q")
	writeFile(t, cwd, "m.txt", "a\nb\n")
	writeFile(t, cwd, "plain.txt", "p\n")
	gitRun(t, cwd, "add", ".")
	gitRun(t, cwd, "commit", "-q", "-m", "init")
	writeFile(t, cwd, "m.txt", "a\nB\n")
	writeFile(t, cwd, "u.txt", "n\n")
	newSession(t)
	must(t, "", "stage", "add", "S")
	must(t, "", "thread", "add", "T")
	must(t, "", "block", "add", "file", "--path", "m.txt")
	must(t, "", "block", "add", "file", "--path", "plain.txt")
	must(t, "", "block", "add", "file", "--path", "u.txt")

	var st struct {
		Blocks map[string]struct {
			DiffSha string `json:"diffSha"`
		}
	}
	if err := json.Unmarshal([]byte(must(t, "", "--json", "session", "show")), &st); err != nil {
		t.Fatal(err)
	}
	if st.Blocks["b_1"].DiffSha == "" || st.Blocks["b_2"].DiffSha != "" || st.Blocks["b_3"].DiffSha == "" {
		t.Fatalf("diff shas = %+v", st.Blocks)
	}
}
