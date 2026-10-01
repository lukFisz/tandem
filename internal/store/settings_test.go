package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsMissingIsZero(t *testing.T) {
	s, err := LoadSettings(t.TempDir())
	if err != nil || s.Editor != "" {
		t.Fatalf("got %+v, %v", s, err)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	home := t.TempDir()
	if err := SaveSettings(home, Settings{Editor: "cursor"}); err != nil {
		t.Fatal(err)
	}
	got, err := LoadSettings(home)
	if err != nil || got.Editor != "cursor" {
		t.Fatalf("got %+v, %v", got, err)
	}
	info, err := os.Stat(filepath.Join(home, "settings.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, %v", info.Mode(), err)
	}
}
