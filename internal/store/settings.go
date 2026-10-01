package store

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings is the user-wide Tandem config in TANDEM_HOME/settings.json.
type Settings struct {
	Editor string `json:"editor,omitempty"`
}

func settingsFile(home string) string { return filepath.Join(home, "settings.json") }

// LoadSettings returns zero settings when the file is missing.
func LoadSettings(home string) (Settings, error) {
	data, err := os.ReadFile(settingsFile(home))
	if os.IsNotExist(err) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, err
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

func SaveSettings(home string, s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(settingsFile(home), data, 0o600)
}
