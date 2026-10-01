package cli

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
)

// ResolveVersion returns version unchanged unless it is "dev" — the default in cmd/tdm/main.go,
// which every plain `go build` (as README's install instructions do, with no -ldflags) leaves
// in place. In that case client.Connect's exact-match version check can never tell an outdated
// "dev" daemon apart from a freshly rebuilt "dev" CLI, so it never replaces it. Instead we
// compute "dev-" + the first 12 hex chars of a sha256 of the running executable and use that as
// the version for both the CLI and the daemon it starts: two different builds now get two
// different versions, and Connect replaces the daemon as intended.
func ResolveVersion(version string) string {
	if version != "dev" {
		return version
	}
	exe, err := os.Executable()
	if err != nil {
		return version
	}
	v, err := versionFromFile(exe)
	if err != nil {
		return version
	}
	return v
}

// versionFromFile hashes the file at path and returns "dev-" + the first 12 hex chars of its
// sha256, so it is a pure function of the executable's bytes and easy to test without ldflags.
func versionFromFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return "dev-" + hex.EncodeToString(h.Sum(nil))[:12], nil
}
