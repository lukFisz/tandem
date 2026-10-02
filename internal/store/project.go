package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Project struct {
	ID              string `json:"id"`
	RootPath        string `json:"rootPath"`
	Name            string `json:"name"`
	ActiveSessionID string `json:"activeSessionId,omitempty"`
}

// ProjectFor identifies the project containing dir: its git root, or dir itself outside git.
func ProjectFor(dir string) (Project, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return Project{}, err
	}
	if out, err := exec.Command("git", "-C", root, "rev-parse", "--show-toplevel").Output(); err == nil {
		root = strings.TrimSpace(string(out))
	}
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	return NewProject(root), nil
}

// NewProject is the project rooted at root, an absolute, already-resolved path. Its id is derived
// from the root, so an id always names the same root.
func NewProject(root string) Project {
	sum := sha256.Sum256([]byte(root))
	return Project{ID: hex.EncodeToString(sum[:])[:12], RootPath: root, Name: filepath.Base(root)}
}

// ValidProjectID reports whether id is usable as a single directory name under projects/: a
// project id never contains a path separator and is never "." or "..", so it cannot point
// outside TANDEM_HOME/projects.
func ValidProjectID(id string) bool {
	return id != "" && id != "." && id != ".." && !strings.ContainsAny(id, `/\`) && !strings.ContainsRune(id, 0)
}

func projectFile(home, id string) string { return filepath.Join(ProjectDir(home, id), "project.json") }

// LoadProject returns nil, nil when the project has never been saved, or when id is not a valid
// project id (see ValidProjectID).
func LoadProject(home, id string) (*Project, error) {
	if !ValidProjectID(id) {
		return nil, nil
	}
	data, err := os.ReadFile(projectFile(home, id))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func SaveProject(home string, p Project) error {
	if !ValidProjectID(p.ID) {
		return fmt.Errorf("invalid project id %q", p.ID)
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(projectFile(home, p.ID), data, 0o600)
}

// SessionIndex maps every session id on disk to its project id.
func SessionIndex(home string) (map[string]string, error) {
	matches, err := filepath.Glob(filepath.Join(home, "projects", "*", "sessions", "*"))
	if err != nil {
		return nil, err
	}
	idx := make(map[string]string, len(matches))
	for _, m := range matches {
		idx[filepath.Base(m)] = filepath.Base(filepath.Dir(filepath.Dir(m)))
	}
	return idx, nil
}
