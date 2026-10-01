// Package cli implements the agent-facing tdm commands.
package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/spf13/cobra"

	"github.com/lukFisz/tandem/internal/client"
	"github.com/lukFisz/tandem/internal/domain"
	"github.com/lukFisz/tandem/internal/store"
)

type app struct {
	version        string
	stdin          io.Reader
	stdout, stderr io.Writer
	jsonOut        bool
	sessionFlag    string
	client         *client.Client
}

type usageError struct{ msg string }

func (e *usageError) Error() string { return e.msg }

type cliError struct{ Code, Message, Hint string }

func (e *cliError) Error() string { return e.Code + ": " + e.Message }

var errTimeout = errors.New("wait timed out")

// Execute runs tdm with args and returns the process exit code.
func Execute(version string, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	a := &app{version: version, stdin: stdin, stdout: stdout, stderr: stderr}
	root := a.rootCmd()
	root.SetArgs(args)
	root.SetIn(stdin)
	root.SetOut(stdout)
	root.SetErr(stderr)
	return a.report(root.ExecuteContext(context.Background()))
}

func (a *app) rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:           "tdm",
		Short:         "Work through AI output with a human, stage by stage, thread by thread",
		Long:          "Tandem is driven by an AI agent. Run `tdm guide` for the full protocol.",
		Version:       a.version,
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.CompletionOptions.DisableDefaultCmd = true
	root.PersistentFlags().BoolVar(&a.jsonOut, "json", false, "print JSON instead of text")
	root.PersistentFlags().StringVar(&a.sessionFlag, "session", "", "session id (default: $TANDEM_SESSION, then the project's active session)")
	root.SetFlagErrorFunc(func(_ *cobra.Command, err error) error { return &usageError{err.Error()} })
	root.AddCommand(a.commands()...)
	return root
}

func (a *app) commands() []*cobra.Command {
	return []*cobra.Command{
		a.sessionCmd(), a.openCmd(), a.stageCmd(), a.threadCmd(), a.blockCmd(), a.annotateCmd(),
		a.sayCmd(), a.askCmd(), a.concludeCmd(), a.processCmd(),
		a.waitCmd(), a.logCmd(), a.exportCmd(), a.daemonCmd(),
		a.guideCmd(), a.skillCmd(),
	}
}

func exactArgs(n int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) != n {
			return &usageError{fmt.Sprintf("%s takes %d argument(s), got %d", cmd.CommandPath(), n, len(args))}
		}
		return nil
	}
}

func maxArgs(n int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) > n {
			return &usageError{fmt.Sprintf("%s takes at most %d argument(s), got %d", cmd.CommandPath(), n, len(args))}
		}
		return nil
	}
}

func isCobraUsage(err error) bool {
	m := err.Error()
	return strings.HasPrefix(m, "unknown command") || strings.HasPrefix(m, "required flag") ||
		strings.HasPrefix(m, "unknown flag") || strings.HasPrefix(m, "unknown shorthand flag")
}

// report prints err (text or JSON) to stderr and maps it to an exit code.
func (a *app) report(err error) int {
	if err == nil {
		return 0
	}
	if errors.Is(err, errTimeout) {
		return 3
	}
	body, exit := domain.Error{Code: "error", Message: err.Error()}, 1
	var ae *client.APIError
	var ce *cliError
	var ue *usageError
	switch {
	case errors.As(err, &ae):
		body = domain.Error{Code: ae.Code, Message: ae.Message, Hint: ae.Hint}
	case errors.As(err, &ce):
		body = domain.Error{Code: ce.Code, Message: ce.Message, Hint: ce.Hint}
	case errors.As(err, &ue) || isCobraUsage(err):
		body, exit = domain.Error{Code: "usage", Message: err.Error(), Hint: "run `tdm <command> --help`"}, 2
	}
	if a.jsonOut {
		json.NewEncoder(a.stderr).Encode(map[string]any{"error": body})
		return exit
	}
	fmt.Fprintf(a.stderr, "error: %s: %s\n", body.Code, body.Message)
	if body.Hint != "" {
		fmt.Fprintf(a.stderr, "hint: %s\n", body.Hint)
	}
	return exit
}

// emit prints text, or v as JSON with --json.
func (a *app) emit(text string, v any) error {
	if a.jsonOut {
		enc := json.NewEncoder(a.stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(v)
	}
	_, err := fmt.Fprintln(a.stdout, strings.TrimRight(text, "\n"))
	return err
}

func (a *app) connect(ctx context.Context) (*client.Client, error) {
	if a.client != nil {
		return a.client, nil
	}
	home, err := store.Home()
	if err != nil {
		return nil, err
	}
	c, err := client.Connect(ctx, home, a.version)
	if err != nil {
		return nil, err
	}
	a.client = c
	return c, nil
}

func (a *app) project() (store.Project, error) { return store.ProjectFor(".") }

var errNoActive = &cliError{Code: "no_active_session", Message: "no active session for this project",
	Hint: "run `tdm session new \"<title>\"` or pass --session <id>"}

// sessionID resolves --session, then $TANDEM_SESSION, then the project's active session.
func (a *app) sessionID(ctx context.Context, c *client.Client) (string, error) {
	if a.sessionFlag != "" {
		return a.sessionFlag, nil
	}
	if v := os.Getenv("TANDEM_SESSION"); v != "" {
		return v, nil
	}
	p, err := a.project()
	if err != nil {
		return "", err
	}
	var proj store.Project
	if err := c.Do(ctx, http.MethodGet, "/api/projects/"+p.ID, nil, &proj); err != nil {
		var ae *client.APIError
		if errors.As(err, &ae) && ae.Code == domain.CodeProjectNotFound {
			return "", errNoActive
		}
		return "", err
	}
	if proj.ActiveSessionID == "" {
		return "", errNoActive
	}
	return proj.ActiveSessionID, nil
}

// call sends an agent command to the current session.
func (a *app) call(ctx context.Context, typ string, data any) (domain.Result, error) {
	var res domain.Result
	c, err := a.connect(ctx)
	if err != nil {
		return res, err
	}
	sid, err := a.sessionID(ctx, c)
	if err != nil {
		return res, err
	}
	err = c.Do(ctx, http.MethodPost, "/api/sessions/"+sid+"/commands", map[string]any{"type": typ, "data": data}, &res)
	return res, err
}

// rawGetStatus connects, resolves the current session id, and issues a raw
// GET for path (relative to /api/sessions/{sid}), returning the status
// as-is. Most callers want rawGet below; wait needs the raw status itself
// (204 means timeout, not an error) so it cannot use rawGet's blanket
// status>=400 check.
func (a *app) rawGetStatus(ctx context.Context, path string) (int, []byte, error) {
	c, err := a.connect(ctx)
	if err != nil {
		return 0, nil, err
	}
	sid, err := a.sessionID(ctx, c)
	if err != nil {
		return 0, nil, err
	}
	return c.Raw(ctx, http.MethodGet, "/api/sessions/"+sid+path, nil)
}

// rawGet is rawGetStatus with any status>=400 decoded into an error.
//
// Ruling D1: this factors the connect -> session id -> Raw request ->
// status>=400 -> DecodeError sequence shared by session show --json, view,
// and (Task 14) log into one small helper.
func (a *app) rawGet(ctx context.Context, path string) ([]byte, error) {
	status, body, err := a.rawGetStatus(ctx, path)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, client.DecodeError(status, body)
	}
	return body, nil
}

// view fetches a rendered markdown view (show, summarize, export) of the current session.
func (a *app) view(ctx context.Context, what, stage string) (string, error) {
	path := "/render/" + what
	if stage != "" {
		path += "?stage=" + url.QueryEscape(stage)
	}
	body, err := a.rawGet(ctx, path)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// readStdin returns piped stdin, or "" when stdin is an interactive terminal.
func (a *app) readStdin() (string, error) {
	if f, ok := a.stdin.(*os.File); ok {
		if fi, err := f.Stat(); err == nil && fi.Mode()&os.ModeCharDevice != 0 {
			return "", nil
		}
	}
	b, err := io.ReadAll(a.stdin)
	return string(b), err
}

// text takes the value from the flag, else the joined args, else stdin.
func (a *app) text(flag string, args []string) (string, error) {
	t := flag
	if t == "" && len(args) > 0 {
		t = strings.Join(args, " ")
	}
	if t == "" {
		s, err := a.readStdin()
		if err != nil {
			return "", err
		}
		t = s
	}
	if strings.TrimSpace(t) == "" {
		return "", &usageError{"text is required: pass it as an argument, with --text, or on stdin"}
	}
	return t, nil
}

func openBrowser(u string) error {
	if os.Getenv("TANDEM_NO_BROWSER") != "" {
		return nil
	}
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	return exec.Command(name, u).Start()
}
