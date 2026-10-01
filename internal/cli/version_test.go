package cli

import (
	"os"
	"path/filepath"
	"testing"
)

// Final review finding 2: cmd/tdm/main.go defaults version to "dev", and the README builds
// without -ldflags, so every rebuild is "dev" and client.Connect (equality check) never notices
// a rebuilt daemon is outdated. ResolveVersion turns "dev" into "dev-" + a hash of the running
// executable, so two different builds get two different versions.
func TestResolveVersionPassesThroughNonDev(t *testing.T) {
	if got := ResolveVersion("v1.2.3"); got != "v1.2.3" {
		t.Fatalf("ResolveVersion(v1.2.3) = %q, want unchanged", got)
	}
}

func TestVersionFromFileDiffersForDifferentContent(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a")
	b := filepath.Join(dir, "b")
	if err := os.WriteFile(a, []byte("binary contents one"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b, []byte("binary contents two, different"), 0o755); err != nil {
		t.Fatal(err)
	}
	va, err := versionFromFile(a)
	if err != nil {
		t.Fatal(err)
	}
	vb, err := versionFromFile(b)
	if err != nil {
		t.Fatal(err)
	}
	if va == vb {
		t.Fatalf("versionFromFile gave the same version %q for different files", va)
	}
	if va[:4] != "dev-" || len(va) != len("dev-")+12 {
		t.Fatalf("versionFromFile = %q, want \"dev-\" + 12 hex chars", va)
	}
}

func TestVersionFromFileSameContentSameVersion(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a")
	b := filepath.Join(dir, "b")
	os.WriteFile(a, []byte("identical bytes"), 0o755)
	os.WriteFile(b, []byte("identical bytes"), 0o755)
	va, err := versionFromFile(a)
	if err != nil {
		t.Fatal(err)
	}
	vb, err := versionFromFile(b)
	if err != nil {
		t.Fatal(err)
	}
	if va != vb {
		t.Fatalf("versionFromFile(a)=%q != versionFromFile(b)=%q for identical content", va, vb)
	}
}
