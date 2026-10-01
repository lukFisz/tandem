package cli

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/client"
	"github.com/lukaszfiszer/tandem/internal/domain"
)

// selfExecutable is the binary `tdm process run` re-execs into; tests point it at the test binary.
var selfExecutable = os.Executable

// endRetryDelays is the backoff between process.end attempts in the supervisor (~5 s in total).
var endRetryDelays = []time.Duration{250 * time.Millisecond, 500 * time.Millisecond, time.Second, 1500 * time.Millisecond, 2 * time.Second}

// commandAfterDash returns the args after `--`, or a usage error when there is no `--`, anything
// stands before it, or nothing follows it.
func commandAfterDash(cmd *cobra.Command, args []string) ([]string, error) {
	dash := cmd.ArgsLenAtDash()
	if dash < 0 || len(args) == dash {
		return nil, &usageError{"put the command after --, e.g. `tdm process run --out /tmp/out.txt -- go test ./...`"}
	}
	if dash > 0 {
		return nil, &usageError{fmt.Sprintf("unexpected argument(s) before --: %s", strings.Join(args[:dash], " "))}
	}
	return args, nil
}

// shellJoin joins args into a command line a shell would split back into the same args: an arg
// that is empty or holds whitespace or shell metacharacters is single-quoted, with each embedded
// quote written as quote, backslash, quote, quote.
func shellJoin(args []string) string {
	out := make([]string, len(args))
	for i, s := range args {
		if s != "" && !strings.ContainsAny(s, " \t\n\r'\"\\$`!*?[]{}()<>|&;#~") {
			out[i] = s
			continue
		}
		out[i] = "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
	}
	return strings.Join(out, " ")
}

// processRunCmd is `tdm process run`: start a command in the background as a card.
//
// Handshake between the CLI (parent) and the hidden `tdm process supervise` (child):
//
//  1. The parent starts the supervisor in its own session (Setsid, so a closing terminal or the
//     agent's shell tool does not take it down) with a stdin pipe, and does not wait for it.
//  2. The parent registers the card with process.start using the supervisor's PID. The card must
//     carry that PID so the daemon's poller can still mark it exit -1 if the supervisor dies.
//  3. The parent writes the returned id (p_N) plus "\n" to the supervisor's stdin and closes it.
//     The id is only known after step 2, and the supervisor needs it to end the card, hence stdin
//     rather than an argument. If step 2 fails, the parent kills the supervisor instead, and the
//     supervisor, reading EOF without an id, would exit without running anything anyway.
//  4. The supervisor runs the command with its output in --out, waits for it and records the real
//     exit code with a supervised process.end, which wakes `tdm wait`.
func (a *app) processRunCmd() *cobra.Command {
	var out, thread string
	cmd := &cobra.Command{
		Use:   "run --out <path> [--thread t_N] -- <cmd> [args...]",
		Short: "Run a command in the background as a card → p_N <path>; its exit code is recorded when it ends",
		RunE: func(cmd *cobra.Command, args []string) error {
			if out == "" {
				return &usageError{"--out is required: the file that receives the command's stdout and stderr"}
			}
			command, err := commandAfterDash(cmd, args)
			if err != nil {
				return err
			}
			abs, err := filepath.Abs(out)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			// Resolve the session now and pin it for the supervisor, so its process.end reaches the
			// same session even if the project's active session changes meanwhile.
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			sid, err := a.sessionID(ctx, c)
			if err != nil {
				return err
			}
			self, err := selfExecutable()
			if err != nil {
				return err
			}
			sup := exec.Command(self, append([]string{"--session", sid, "process", "supervise", "--out", abs, "--"}, command...)...)
			sup.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
			devnull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
			if err != nil {
				return err
			}
			defer devnull.Close()
			sup.Stdout, sup.Stderr = devnull, devnull
			stdin, err := sup.StdinPipe()
			if err != nil {
				return err
			}
			if err := sup.Start(); err != nil {
				return fmt.Errorf("start supervisor: %w", err)
			}
			abort := func() {
				stdin.Close()
				sup.Process.Kill()
				sup.Wait()
			}
			a.sessionFlag = sid
			res, err := a.call(ctx, "process.start", domain.StartProcess{ThreadID: thread, PID: sup.Process.Pid, Cmd: shellJoin(command), Out: abs})
			if err != nil {
				abort()
				return err
			}
			if _, err := io.WriteString(stdin, res.ID+"\n"); err != nil {
				abort()
				return fmt.Errorf("hand %s to the supervisor: %w", res.ID, err)
			}
			stdin.Close()
			// The supervisor must outlive this CLI call: never Wait on it.
			sup.Process.Release()
			return a.emit(res.ID+" "+abs, map[string]string{"id": res.ID, "out": abs})
		},
	}
	cmd.Flags().StringVar(&out, "out", "", "file that receives the command's stdout and stderr (truncated)")
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	return cmd
}

// processSuperviseCmd is the hidden child of `tdm process run`; see processRunCmd for the handshake.
func (a *app) processSuperviseCmd() *cobra.Command {
	var out string
	cmd := &cobra.Command{
		Use:    "supervise --out <path> -- <cmd> [args...]",
		Short:  "Internal: run a command for `tdm process run` and record its exit code",
		Hidden: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Catch (not ignore) these: an ignored disposition would be inherited by the command,
			// while a caught one is reset to the default when it is exec'd.
			sigs := make(chan os.Signal, 1)
			signal.Notify(sigs, syscall.SIGHUP, syscall.SIGINT)
			go func() {
				for range sigs {
				}
			}()

			command, err := commandAfterDash(cmd, args)
			if err != nil {
				return err
			}
			if out == "" {
				return &usageError{"--out is required"}
			}
			line, _ := bufio.NewReader(a.stdin).ReadString('\n')
			id := strings.TrimSpace(line)
			if id == "" {
				return &cliError{Code: "error", Message: "no process id on stdin"}
			}
			f, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
			if err != nil {
				return err
			}
			code := runSupervised(f, command)
			f.Close()
			a.endSupervised(cmd.Context(), id, code)
			return nil
		},
	}
	cmd.Flags().StringVar(&out, "out", "", "output file")
	return cmd
}

// runSupervised runs command with stdout and stderr in f and returns its exit code:
// 127 when it cannot start, 128+signal when a signal killed it.
func runSupervised(f *os.File, command []string) int {
	c := exec.Command(command[0], command[1:]...)
	c.Stdout, c.Stderr = f, f
	if err := c.Start(); err != nil {
		fmt.Fprintf(f, "tdm: %v\n", err)
		return 127
	}
	err := c.Wait()
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if !errors.As(err, &ee) {
		fmt.Fprintf(f, "tdm: %v\n", err)
		return 1
	}
	if ws, ok := ee.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	if code := ee.ExitCode(); code >= 0 {
		return code
	}
	return 1
}

// endSupervised records the exit code, retrying while the daemon is unreachable. It gives up
// silently: the daemon's PID poller then marks the card exit -1 once this process is gone.
func (a *app) endSupervised(ctx context.Context, id string, code int) {
	for i := 0; ; i++ {
		_, err := a.call(ctx, "process.end", domain.EndProcess{ID: id, ExitCode: code, Supervised: true})
		var ae *client.APIError
		if err == nil || (errors.As(err, &ae) && ae.Code != "daemon_unavailable") || i >= len(endRetryDelays) {
			return
		}
		a.client = nil // reconnect: the daemon may have restarted on a new port
		time.Sleep(endRetryDelays[i])
	}
}
