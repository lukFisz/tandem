package cli

import (
	"encoding/json"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/lukaszfiszer/tandem/internal/domain"
)

func (a *app) stageCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "stage", Short: "Add, summarize and propose stages"}

	var goal string
	add := &cobra.Command{
		Use: "add <title>", Short: "Add a stage", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := a.call(cmd.Context(), "stage.add", domain.AddStage{Title: args[0], Goal: goal})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	add.Flags().StringVar(&goal, "goal", "", "what the stage should decide")

	var summarizeStage string
	summarize := &cobra.Command{
		Use: "summarize", Short: "Print the thread conclusions of a stage (input for your summary)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			md, err := a.view(cmd.Context(), "summarize", summarizeStage)
			if err != nil {
				return err
			}
			return a.emit(md, map[string]string{"markdown": md})
		},
	}
	summarize.Flags().StringVar(&summarizeStage, "stage", "", "stage id (default: latest stage not yet accepted)")

	var proposeStage string
	propose := &cobra.Command{
		Use: "propose [summary]", Short: "Propose the stage summary for the user to accept", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "stage.propose", domain.ProposeStageSummary{StageID: proposeStage, Text: text})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	propose.Flags().StringVar(&proposeStage, "stage", "", "stage id (default: latest stage not yet accepted)")

	cmd.AddCommand(add, summarize, propose)
	return cmd
}

func (a *app) threadCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "thread", Short: "Add threads"}
	var stage string
	add := &cobra.Command{
		Use: "add <title>", Short: "Add a thread to a stage", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := a.call(cmd.Context(), "thread.add", domain.AddThread{StageID: stage, Title: args[0]})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	add.Flags().StringVar(&stage, "stage", "", "stage id (default: latest open stage)")
	cmd.AddCommand(add)
	return cmd
}

type variantBlockInput struct {
	domain.BlockContent
	Lines string `json:"lines"`
}

type variantsInput struct {
	Title   string `json:"title"`
	Options []struct {
		Title       string              `json:"title"`
		Description string              `json:"description"`
		Pros        []string            `json:"pros"`
		Cons        []string            `json:"cons"`
		Blocks      []variantBlockInput `json:"blocks"`
	} `json:"options"`
}

func (a *app) blockCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "block", Short: "Add content blocks to a thread"}
	add := &cobra.Command{Use: "add", Short: "Add a note, code, file, markdown or variants block"}

	var thread, supersedes string
	send := func(cmd *cobra.Command, b domain.AddBlock) error {
		b.ThreadID, b.Supersedes = thread, supersedes
		res, err := a.call(cmd.Context(), "block.add", b)
		if err != nil {
			return err
		}
		return a.emit(strings.Join(append([]string{res.ID}, res.OptionIDs...), " "), res)
	}

	var noteText string
	note := &cobra.Command{
		Use: "note", Short: "Add a markdown note (--text or stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			text, err := a.text(noteText, nil)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindNote, Text: text}})
		},
	}
	note.Flags().StringVar(&noteText, "text", "", "note text (default: stdin)")

	var codeText, lang string
	code := &cobra.Command{
		Use: "code", Short: "Add a code snippet (--text or stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			text, err := a.text(codeText, nil)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindCode, Lang: lang, Text: text}})
		},
	}
	code.Flags().StringVar(&codeText, "text", "", "code (default: stdin)")
	code.Flags().StringVar(&lang, "lang", "", "language, e.g. kotlin, java, go, python")
	code.MarkFlagRequired("lang")

	var filePath, fileLines string
	file := &cobra.Command{
		Use: "file", Short: "Snapshot a file (or --lines of it)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := a.pathContent(domain.KindFile, filePath, fileLines)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: c})
		},
	}
	file.Flags().StringVar(&filePath, "path", "", "file path")
	file.Flags().StringVar(&fileLines, "lines", "", "line range N or N-M")
	file.MarkFlagRequired("path")

	var mdPath, mdLines string
	markdown := &cobra.Command{
		Use: "markdown", Short: "Add a markdown document (--path or stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			if mdPath != "" {
				c, err := a.pathContent(domain.KindMarkdown, mdPath, mdLines)
				if err != nil {
					return err
				}
				return send(cmd, domain.AddBlock{BlockContent: c})
			}
			text, err := a.text("", nil)
			if err != nil {
				return err
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindMarkdown, Text: text}})
		},
	}
	markdown.Flags().StringVar(&mdPath, "path", "", "markdown file (default: stdin)")
	markdown.Flags().StringVar(&mdLines, "lines", "", "line range N or N-M")

	var input string
	variants := &cobra.Command{
		Use: "variants", Short: "Add 2+ options for the user to choose from (JSON on stdin)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			if input != "-" {
				return &usageError{"pass the variants JSON on stdin with --input -"}
			}
			raw, err := a.readStdin()
			if err != nil {
				return err
			}
			var in variantsInput
			if err := json.Unmarshal([]byte(raw), &in); err != nil {
				return &cliError{Code: domain.CodeInvalidInput, Message: "invalid variants JSON: " + err.Error(),
					Hint: "see `tdm guide` for the variants format"}
			}
			v := &domain.Variants{Title: in.Title}
			for _, o := range in.Options {
				opt := domain.VariantOption{Title: o.Title, Description: o.Description, Pros: o.Pros, Cons: o.Cons}
				for _, b := range o.Blocks {
					c := b.BlockContent
					if c.Path != "" && (c.Kind == domain.KindFile || c.Kind == domain.KindMarkdown) {
						if c, err = a.pathContent(c.Kind, c.Path, b.Lines); err != nil {
							return err
						}
					}
					opt.Blocks = append(opt.Blocks, c)
				}
				v.Options = append(v.Options, opt)
			}
			return send(cmd, domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindVariants}, Variants: v})
		},
	}
	variants.Flags().StringVar(&input, "input", "", "must be - (read JSON from stdin)")
	variants.MarkFlagRequired("input")

	add.PersistentFlags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	add.PersistentFlags().StringVar(&supersedes, "supersedes", "", "id of the block this one replaces")
	add.AddCommand(note, code, file, markdown, variants)
	cmd.AddCommand(add)
	return cmd
}

// pathContent snapshots a file as file/markdown block content; the daemon stores Content as a blob.
func (a *app) pathContent(kind domain.BlockKind, path, lines string) (domain.BlockContent, error) {
	p, err := a.project()
	if err != nil {
		return domain.BlockContent{}, err
	}
	rel, content, first, err := readExcerpt(p.RootPath, path, lines)
	if err != nil {
		return domain.BlockContent{}, err
	}
	lang := domain.LangFromPath(rel)
	if kind == domain.KindMarkdown {
		lang = "markdown"
	}
	c := domain.BlockContent{Kind: kind, Path: rel, Lang: lang, Content: content, FirstLine: first}
	if kind == domain.KindFile {
		c.Diff = captureDiff(p.RootPath, rel)
	}
	return c, nil
}

func (a *app) annotateCmd() *cobra.Command {
	var lines string
	cmd := &cobra.Command{
		Use: "annotate <block-id> <text>", Short: "Attach a note to lines of a code, file or markdown block", Args: exactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			r, err := domain.ParseLineRange(lines)
			if err != nil {
				return &usageError{err.Error()}
			}
			res, err := a.call(cmd.Context(), "annotate", domain.Annotate{BlockID: args[0], Lines: r, Text: args[1]})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	cmd.Flags().StringVar(&lines, "lines", "", "line range N or N-M (file line numbers)")
	cmd.MarkFlagRequired("lines")
	return cmd
}

func (a *app) sayCmd() *cobra.Command {
	var thread, stage string
	cmd := &cobra.Command{
		Use: "say [text]", Short: "Post a chat message to a thread, or to a stage page with --stage", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if thread != "" && stage != "" {
				return &usageError{"pass --thread or --stage, not both"}
			}
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "say", domain.Say{ThreadID: thread, StageID: stage, Text: text})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	cmd.Flags().StringVar(&stage, "stage", "", "stage id: post on the stage page instead of a thread")
	return cmd
}

func (a *app) askCmd() *cobra.Command {
	var thread, stage, withdraw string
	var options []string
	cmd := &cobra.Command{
		Use: "ask [question]", Short: "Ask the user a quick question with 2–4 answer buttons (or --withdraw q_N)", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if withdraw != "" {
				if len(args) > 0 || len(options) > 0 || thread != "" || stage != "" {
					return &usageError{"--withdraw takes only the question id"}
				}
				res, err := a.call(cmd.Context(), "question.withdraw", domain.WithdrawQuestion{QuestionID: withdraw})
				if err != nil {
					return err
				}
				return a.emit(res.ID, res)
			}
			if thread != "" && stage != "" {
				return &usageError{"pass --thread or --stage, not both"}
			}
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "ask", domain.Ask{ThreadID: thread, StageID: stage, Text: text, Options: options})
			if err != nil {
				return err
			}
			return a.emit(strings.Join(append([]string{res.ID}, res.OptionIDs...), " "), res)
		},
	}
	// StringArray, not StringSlice: an answer may contain commas.
	cmd.Flags().StringArrayVar(&options, "option", nil, "an answer button; repeat 2 to 4 times")
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	cmd.Flags().StringVar(&stage, "stage", "", "stage id: ask on the stage page instead of a thread")
	cmd.Flags().StringVar(&withdraw, "withdraw", "", "withdraw the open question q_N")
	return cmd
}

func (a *app) processCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "process", Short: "Attach a background command to a thread card"}

	var startThread, cmdline, startOut string
	var pid int
	start := &cobra.Command{
		Use: "start", Short: "Attach a PID you already started to a card → p_N", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, _ []string) error {
			out := startOut
			if out != "" {
				// The daemon reads the file from its own working directory, so pass it absolute.
				abs, err := filepath.Abs(out)
				if err != nil {
					return err
				}
				out = abs
			}
			res, err := a.call(cmd.Context(), "process.start", domain.StartProcess{ThreadID: startThread, PID: pid, Cmd: cmdline, Out: out})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	start.Flags().IntVar(&pid, "pid", 0, "pid of the command you started in the background")
	start.Flags().StringVar(&cmdline, "cmd", "", "command line to show on the card")
	start.Flags().StringVar(&startOut, "out", "", "file the command writes its output to; its last lines show on the card")
	start.Flags().StringVar(&startThread, "thread", "", "thread id (default: latest open thread)")
	start.MarkFlagRequired("pid")
	start.MarkFlagRequired("cmd")

	var exitCode int
	end := &cobra.Command{
		Use: "end <id>", Short: "Record the exit code of p_N", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := a.call(cmd.Context(), "process.end", domain.EndProcess{ID: args[0], ExitCode: exitCode})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	end.Flags().IntVar(&exitCode, "exit", 0, "exit code")
	end.MarkFlagRequired("exit")

	cmd.AddCommand(a.processRunCmd(), a.processSuperviseCmd(), start, end)
	return cmd
}

func (a *app) concludeCmd() *cobra.Command {
	var thread string
	cmd := &cobra.Command{
		Use: "conclude [text]", Short: "Propose the thread's conclusion for the user to accept", Args: maxArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			text, err := a.text("", args)
			if err != nil {
				return err
			}
			res, err := a.call(cmd.Context(), "conclude", domain.Conclude{ThreadID: thread, Text: text})
			if err != nil {
				return err
			}
			return a.emit(res.ID, res)
		},
	}
	cmd.Flags().StringVar(&thread, "thread", "", "thread id (default: latest open thread)")
	return cmd
}
