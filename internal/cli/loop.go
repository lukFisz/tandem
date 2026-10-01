package cli

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/client"
	"github.com/lukaszfiszer/tandem/internal/daemon"
	"github.com/lukaszfiszer/tandem/internal/store"
)

func (a *app) waitCmd() *cobra.Command {
	var timeout time.Duration
	cmd := &cobra.Command{
		Use: "wait", Short: "Block until the user acts; print their actions (exit 3 on timeout)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			format := "md"
			if a.jsonOut {
				format = "json"
			}
			q := url.Values{"timeout": {timeout.String()}, "format": {format}}
			status, body, err := a.rawGetStatus(cmd.Context(), "/wait?"+q.Encode())
			if err != nil {
				return err
			}
			switch {
			case status == http.StatusNoContent:
				if err := a.emit("No events (timeout). Run tdm wait again.", map[string]any{"events": []any{}, "timeout": true}); err != nil {
					return err
				}
				return errTimeout
			case status >= 400:
				return client.DecodeError(status, body)
			}
			if _, err := a.stdout.Write(body); err != nil {
				return err
			}
			// The daemon's JSON body has no trailing newline (json.Marshal, not an Encoder); add
			// one so --json output ends with a newline like every other --json command.
			if a.jsonOut && (len(body) == 0 || body[len(body)-1] != '\n') {
				_, err = fmt.Fprintln(a.stdout)
			}
			return err
		},
	}
	cmd.Flags().DurationVar(&timeout, "timeout", 9*time.Minute, "give up after this long (agent shells often cap commands at ~10m)")
	return cmd
}

func (a *app) logCmd() *cobra.Command {
	var since int64
	var stage string
	cmd := &cobra.Command{
		Use: "log", Short: "Print raw session events as JSON lines", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			q := url.Values{"since": {fmt.Sprint(since)}}
			if stage != "" {
				q.Set("stage", stage)
			}
			body, err := a.rawGet(cmd.Context(), "/events?"+q.Encode())
			if err != nil {
				return err
			}
			_, err = a.stdout.Write(body)
			return err
		},
	}
	cmd.Flags().Int64Var(&since, "since", 0, "only events with seq greater than this")
	cmd.Flags().StringVar(&stage, "stage", "", "only events of this stage")
	return cmd
}

func (a *app) exportCmd() *cobra.Command {
	var stage, out string
	cmd := &cobra.Command{
		Use: "export", Short: "Print (or --out write) the decision document: accepted stage summaries", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			md, err := a.view(cmd.Context(), "export", stage)
			if err != nil {
				return err
			}
			if out == "" {
				return a.emit(md, map[string]string{"markdown": md})
			}
			// Ruling R4: 0600/0700 is for Tandem's own state under TANDEM_HOME; a user-facing
			// file written by --out keeps conventional 0644/0755 modes.
			if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(out, []byte(md), 0o644); err != nil {
				return err
			}
			return a.emit("wrote "+out, map[string]string{"path": out})
		},
	}
	cmd.Flags().StringVar(&stage, "stage", "", "export a single stage")
	cmd.Flags().StringVar(&out, "out", "", "write to this file instead of stdout")
	return cmd
}

func (a *app) daemonCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "daemon", Short: "Inspect or stop the background daemon"}
	status := &cobra.Command{
		Use: "status", Short: "Show whether the daemon runs", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := store.Home()
			if err != nil {
				return err
			}
			_, info, err := client.Existing(cmd.Context(), home)
			if err != nil {
				return a.emit("daemon not running", map[string]bool{"running": false})
			}
			return a.emit(fmt.Sprintf("daemon running: pid %d, port %d, version %s", info.PID, info.Port, info.Version),
				map[string]any{"running": true, "pid": info.PID, "port": info.Port, "version": info.Version})
		},
	}
	stop := &cobra.Command{
		Use: "stop", Short: "Stop the daemon", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := store.Home()
			if err != nil {
				return err
			}
			c, _, err := client.Existing(cmd.Context(), home)
			if err != nil {
				return a.emit("daemon not running", map[string]bool{"stopped": false})
			}
			if err := c.Do(cmd.Context(), http.MethodPost, "/api/shutdown", nil, nil); err != nil {
				return err
			}
			// /api/shutdown answers 200 and stops the server asynchronously (see
			// internal/daemon/api.go), so the process may still hold daemon.lock for a moment
			// after the response comes back. Wait (bounded) for it to actually exit so a caller
			// that immediately starts a new daemon never races this one for the lock.
			if _, err := client.WaitGone(cmd.Context(), c, home); err != nil {
				return err
			}
			return a.emit("daemon stopped", map[string]bool{"stopped": true})
		},
	}
	runCmd := &cobra.Command{
		Use: "run", Short: "Run the daemon in the foreground (started automatically)", Hidden: true, Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := store.Home()
			if err != nil {
				return err
			}
			idle := 30 * time.Minute
			if v := os.Getenv("TANDEM_IDLE_TIMEOUT"); v != "" {
				if idle, err = time.ParseDuration(v); err != nil {
					return &usageError{"TANDEM_IDLE_TIMEOUT: " + err.Error()}
				}
			}
			ctx, cancel := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer cancel()
			return daemon.Run(ctx, daemon.Config{Home: home, Version: a.version, IdleTimeout: idle})
		},
	}
	cmd.AddCommand(status, stop, runCmd)
	return cmd
}
