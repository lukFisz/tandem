package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/guide"
)

// Every visible, runnable command must be documented in the guide.
func TestGuideCoversEveryCommand(t *testing.T) {
	root := (&app{}).rootCmd()
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			if sub.Hidden || sub.Name() == "help" {
				continue
			}
			if sub.Runnable() && !strings.Contains(guide.Guide, sub.CommandPath()) {
				t.Errorf("guide does not mention %q", sub.CommandPath())
			}
			walk(sub)
		}
	}
	walk(root)
}

func TestGuideAndSkillInstall(t *testing.T) {
	if out, _, code := run(t, "", "guide"); code != 0 || !strings.Contains(out, "# Tandem — agent guide") {
		t.Fatalf("guide: %d %q", code, out[:min(len(out), 80)])
	}
	dir := filepath.Join(t.TempDir(), "skills", "tandem")
	out, _, code := run(t, "", "skill", "install", "--dir", dir)
	path := filepath.Join(dir, "SKILL.md")
	if code != 0 || out != "installed "+path+"\n" {
		t.Fatalf("install: %d %q", code, out)
	}
	data, _ := os.ReadFile(path)
	if string(data) != guide.Skill || !strings.HasPrefix(guide.Skill, "---\nname: tandem\n") {
		t.Fatalf("SKILL.md = %q", data)
	}
}
