package cli

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/spf13/cobra"
)

type sessionInfo struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
	Active bool   `json:"active"`
}

func (a *app) sessionCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "session", Short: "Create, list, switch and close sessions"}

	var noOpen bool
	newCmd := &cobra.Command{
		Use: "new <title>", Short: "Create a session, make it active and open the browser", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			p, err := a.project()
			if err != nil {
				return err
			}
			var res struct {
				ID  string `json:"id"`
				URL string `json:"url"`
			}
			if err := c.Do(ctx, http.MethodPost, "/api/sessions", map[string]any{"project": p, "title": args[0]}, &res); err != nil {
				return err
			}
			if !noOpen {
				if err := openBrowser(res.URL); err != nil {
					fmt.Fprintf(a.stderr, "warning: could not open a browser: %v\n", err)
				}
			}
			return a.emit(res.ID+" "+res.URL, res)
		},
	}
	newCmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open the browser")

	list := &cobra.Command{
		Use: "list", Short: "List this project's sessions (* = active)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			p, err := a.project()
			if err != nil {
				return err
			}
			var infos []sessionInfo
			if err := c.Do(ctx, http.MethodGet, "/api/projects/"+p.ID+"/sessions", nil, &infos); err != nil {
				return err
			}
			sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
			if len(infos) == 0 {
				return a.emit("No sessions yet. Run `tdm session new \"<title>\"`.", infos)
			}
			var b strings.Builder
			for _, s := range infos {
				mark := " "
				if s.Active {
					mark = "*"
				}
				fmt.Fprintf(&b, "%s %s %q — %s\n", mark, s.ID, s.Title, s.Status)
			}
			return a.emit(b.String(), infos)
		},
	}

	use := &cobra.Command{
		Use: "use <session-id>", Short: "Make a session the project's active session", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			p, err := a.project()
			if err != nil {
				return err
			}
			if err := c.Do(ctx, http.MethodPost, "/api/projects/"+p.ID+"/active", map[string]string{"sessionId": args[0]}, nil); err != nil {
				return err
			}
			return a.emit(args[0], map[string]string{"id": args[0]})
		},
	}

	show := &cobra.Command{
		Use: "show", Short: "Show stages, threads and the user input awaiting you", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			if a.jsonOut {
				body, err := a.rawGet(ctx, "/state")
				if err != nil {
					return err
				}
				_, err = a.stdout.Write(append(body, '\n'))
				return err
			}
			md, err := a.view(ctx, "show", "")
			if err != nil {
				return err
			}
			return a.emit(md, nil)
		},
	}

	closeCmd := &cobra.Command{
		Use: "close", Short: "Close the session (read-only afterwards)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			res, err := a.call(cmd.Context(), "session.close", struct{}{})
			if err != nil {
				return err
			}
			return a.emit("closed "+res.ID, res)
		},
	}

	cmd.AddCommand(newCmd, list, use, show, closeCmd)
	return cmd
}

func (a *app) openCmd() *cobra.Command {
	return &cobra.Command{
		Use: "open", Short: "Open the current session in the browser", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()
			c, err := a.connect(ctx)
			if err != nil {
				return err
			}
			sid, err := a.sessionID(ctx, c)
			if err != nil {
				return err
			}
			u := c.BaseURL() + "/s/" + sid + "?token=" + c.PageToken()
			if err := openBrowser(u); err != nil {
				return err
			}
			return a.emit(u, map[string]string{"url": u})
		},
	}
}
