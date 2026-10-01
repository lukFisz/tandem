package cli

import (
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/guide"
)

func (a *app) guideCmd() *cobra.Command {
	return &cobra.Command{
		Use: "guide", Short: "Print the agent protocol (read this first)", Args: exactArgs(0),
		RunE: func(*cobra.Command, []string) error {
			return a.emit(guide.Guide, map[string]string{"guide": guide.Guide})
		},
	}
}

func (a *app) skillCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "skill", Short: "Manage the Claude Code skill"}
	var dir string
	install := &cobra.Command{
		Use: "install", Short: "Install the tdm skill for Claude Code", Args: exactArgs(0),
		RunE: func(*cobra.Command, []string) error {
			if dir == "" {
				home, err := os.UserHomeDir()
				if err != nil {
					return err
				}
				dir = filepath.Join(home, ".claude", "skills", "tandem")
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
			path := filepath.Join(dir, "SKILL.md")
			if err := os.WriteFile(path, []byte(guide.Skill), 0o644); err != nil {
				return err
			}
			return a.emit("installed "+path, map[string]string{"path": path})
		},
	}
	install.Flags().StringVar(&dir, "dir", "", "target directory (default ~/.claude/skills/tandem)")
	cmd.AddCommand(install)
	return cmd
}
