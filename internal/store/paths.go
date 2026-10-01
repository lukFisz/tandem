package store

import (
	"os"
	"path/filepath"
)

// Home is TANDEM_HOME or ~/.tandem.
func Home() (string, error) {
	if h := os.Getenv("TANDEM_HOME"); h != "" {
		return h, nil
	}
	u, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(u, ".tandem"), nil
}

func ProjectDir(home, pid string) string { return filepath.Join(home, "projects", pid) }

func SessionDir(home, pid, sid string) string {
	return filepath.Join(ProjectDir(home, pid), "sessions", sid)
}
