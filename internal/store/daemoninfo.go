package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type DaemonInfo struct {
	Port    int    `json:"port"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
	Token   string `json:"token"`
}

// ClientHeader marks requests sent by the tdm CLI, which the agent drives. The daemon uses it to
// tell them from the page's requests, including the dev server's proxy, which also sends the
// Bearer token.
const (
	ClientHeader = "X-Tandem-Client"
	ClientCLI    = "cli"
)

func daemonFile(home string) string { return filepath.Join(home, "daemon.json") }

func WriteDaemonInfo(home string, info DaemonInfo) error {
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return writeFileAtomic(daemonFile(home), data, 0o600)
}

func ReadDaemonInfo(home string) (DaemonInfo, error) {
	var info DaemonInfo
	data, err := os.ReadFile(daemonFile(home))
	if err != nil {
		return info, err
	}
	err = json.Unmarshal(data, &info)
	return info, err
}

// RemoveDaemonInfo deletes daemon.json; with pid != 0 only when the file belongs to that process.
func RemoveDaemonInfo(home string, pid int) error {
	if pid != 0 {
		if info, err := ReadDaemonInfo(home); err != nil || info.PID != pid {
			return nil
		}
	}
	if err := os.Remove(daemonFile(home)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func portHintFile(home string) string { return filepath.Join(home, "daemon.port") }

// WritePortHint records the port a daemon is listening on in a file that — unlike daemon.json —
// is never removed, including on a clean shutdown or before an auto-restart (client.Connect
// removes daemon.json before starting a replacement daemon). A future Run reads it (ReadPortHint)
// to prefer the same port, so a browser tab's origin (and anything keyed on it, like a
// localStorage draft) survives a daemon restart even though the token always changes.
func WritePortHint(home string, port int) error {
	return writeFileAtomic(portHintFile(home), []byte(strconv.Itoa(port)), 0o600)
}

// ReadPortHint reads back the port written by WritePortHint. It returns an error for a missing,
// unreadable, or corrupt file — callers treat that the same as "no hint" and fall back.
func ReadPortHint(home string) (int, error) {
	data, err := os.ReadFile(portHintFile(home))
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(data)))
}
