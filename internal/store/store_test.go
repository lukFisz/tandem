package store

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lukFisz/tandem/internal/domain"
)

func event(seq int64, typ string) domain.Event {
	e := domain.NewEvent(domain.ActorAI, typ, map[string]int64{"n": seq})
	e.Seq = seq
	return e
}

func TestLogRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s", "events.jsonl")
	l, evs, warn, err := OpenLog(path)
	if err != nil || len(evs) != 0 || warn != "" {
		t.Fatalf("open empty: %v %v %q", evs, err, warn)
	}
	if err := l.Append([]domain.Event{event(1, "a"), event(2, "b")}); err != nil {
		t.Fatal(err)
	}
	l.Close()
	l, evs, warn, err = OpenLog(path)
	if err != nil || warn != "" || len(evs) != 2 || evs[1].Type != "b" || evs[1].Seq != 2 {
		t.Fatalf("reopen: %+v %v %q", evs, err, warn)
	}
	l.Close()
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("log mode = %v", info.Mode().Perm())
	}
}

func TestLogDropsTruncatedLastLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	l, _, _, _ := OpenLog(path)
	l.Append([]domain.Event{event(1, "a")})
	l.Close()
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString(`{"seq":2,"ty`)
	f.Close()

	l, evs, warn, err := OpenLog(path)
	if err != nil || len(evs) != 1 || warn == "" {
		t.Fatalf("got %d events, err %v, warn %q", len(evs), err, warn)
	}
	if err := l.Append([]domain.Event{event(2, "b")}); err != nil {
		t.Fatal(err)
	}
	l.Close()
	_, evs, warn, err = OpenLog(path)
	if err != nil || len(evs) != 2 || warn != "" {
		t.Fatalf("after repair: %d events, err %v, warn %q", len(evs), err, warn)
	}
}

func TestLogRejectsCorruptMiddleLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	os.WriteFile(path, []byte("garbage\n{\"seq\":2,\"type\":\"a\",\"data\":{}}\n"), 0o600)
	if _, _, _, err := OpenLog(path); err == nil || !strings.Contains(err.Error(), "line 1") {
		t.Fatalf("want line 1 error, got %v", err)
	}
}

func TestBlobs(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "blobs")
	a, err := PutBlob(dir, []byte("hello\n"))
	if err != nil || len(a) != 64 {
		t.Fatalf("PutBlob = %q, %v", a, err)
	}
	b, _ := PutBlob(dir, []byte("hello\n"))
	if a != b {
		t.Fatal("same content must give the same id")
	}
	got, err := GetBlob(dir, a)
	if err != nil || string(got) != "hello\n" {
		t.Fatalf("GetBlob = %q, %v", got, err)
	}
	if _, err := GetBlob(dir, "../../etc/passwd"); err == nil {
		t.Fatal("GetBlob must reject non-sha ids")
	}
}

func TestProjectForGitSubdir(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, out)
	}
	sub := filepath.Join(root, "a", "b")
	os.MkdirAll(sub, 0o700)
	p1, err1 := ProjectFor(sub)
	p2, err2 := ProjectFor(root)
	want, _ := filepath.EvalSymlinks(root)
	if err1 != nil || err2 != nil || p1.ID != p2.ID || p1.RootPath != want || len(p1.ID) != 12 {
		t.Fatalf("p1=%+v p2=%+v want root %s", p1, p2, want)
	}
}

func TestProjectForNonGit(t *testing.T) {
	dir := t.TempDir()
	p, err := ProjectFor(dir)
	want, _ := filepath.EvalSymlinks(dir)
	if err != nil || p.RootPath != want || p.Name != filepath.Base(want) {
		t.Fatalf("p = %+v, err = %v", p, err)
	}
}

func TestProjectSaveLoadAndIndex(t *testing.T) {
	home := t.TempDir()
	if p, err := LoadProject(home, "nope"); p != nil || err != nil {
		t.Fatalf("missing project: %v %v", p, err)
	}
	want := Project{ID: "abc", RootPath: "/x", Name: "x", ActiveSessionID: "s_1"}
	if err := SaveProject(home, want); err != nil {
		t.Fatal(err)
	}
	got, err := LoadProject(home, "abc")
	if err != nil || *got != want {
		t.Fatalf("got %+v, %v", got, err)
	}
	os.MkdirAll(SessionDir(home, "abc", "s_1"), 0o700)
	idx, err := SessionIndex(home)
	if err != nil || idx["s_1"] != "abc" {
		t.Fatalf("index = %v, %v", idx, err)
	}
}

func TestDaemonInfo(t *testing.T) {
	home := t.TempDir()
	if _, err := ReadDaemonInfo(home); err == nil {
		t.Fatal("want error when missing")
	}
	info := DaemonInfo{Port: 1234, PID: 42, Version: "v1", Token: "tok"}
	if err := WriteDaemonInfo(home, info); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(filepath.Join(home, "daemon.json")); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v", st.Mode().Perm())
	}
	got, err := ReadDaemonInfo(home)
	if err != nil || got != info {
		t.Fatalf("got %+v, %v", got, err)
	}
	RemoveDaemonInfo(home, 7) // another pid: keep
	if _, err := ReadDaemonInfo(home); err != nil {
		t.Fatal("file removed by a different pid")
	}
	RemoveDaemonInfo(home, 42)
	if _, err := ReadDaemonInfo(home); err == nil {
		t.Fatal("file should be removed")
	}
}

func TestProjectIDMustBeOneDirectoryName(t *testing.T) {
	home := t.TempDir()
	for _, id := range []string{"", ".", "..", "../x", "a/b", `a\b`} {
		if ValidProjectID(id) {
			t.Fatalf("ValidProjectID(%q) = true", id)
		}
		if err := SaveProject(home, Project{ID: id, RootPath: "/x"}); err == nil {
			t.Fatalf("SaveProject(%q) succeeded", id)
		}
		if p, err := LoadProject(home, id); p != nil || err != nil {
			t.Fatalf("LoadProject(%q) = %v, %v", id, p, err)
		}
	}
	if p := NewProject("/a/b"); !ValidProjectID(p.ID) || p.Name != "b" || p.RootPath != "/a/b" {
		t.Fatalf("NewProject = %+v", p)
	}
}
