# Tandem — agent guide

Tandem lets you work through large content with a human in their browser. You post content through this CLI. The
human reads, comments on lines, picks variants and accepts conclusions. You block on `tdm wait` until they act.

## Model

- **Session**: one topic, such as "Implement idea ABC". A project has many sessions, and one of them is active.
- **Stage**: a phase of the session, such as "Data model". It ends with a stage summary the user accepts.
- **Thread**: one question or piece of the stage. It ends with a conclusion the user accepts.
- **Block**: content inside a thread: note, code, file, markdown or variants. Ids are short: `st_1`, `t_3`,
  `b_7`, `o_2`, `q_1` for a question, and `p_1` for a process card.

Mention threads, stages, variant options, questions and processes by id (`t_3`, `st_1`, `o_2`, `q_1`, `p_1`) in notes, messages,
conclusions and summaries. The page shows each one as a chip with its title and opens it on click, so short ids
are all you need to write.

## The loop

1. `tdm session new "<title>"` creates the session and opens it in the user's browser. Do not pass `--no-open` unless
   the user asks for it: the user needs the page open in their browser. Then
   `tdm stage add "<title>" --goal "<what to decide>"`.
2. For each question, `tdm thread add "<title>"`, then add blocks:
   - always start with a `note` that explains the context and **why**;
   - show code with `file` (a snapshot with real line numbers) or `code`;
   - use `tdm annotate` on every non-obvious line;
   - when there is a real choice, add `variants` with pros and cons;
   - when you need a quick fact or decision to continue, use `tdm ask "<question>" --option A --option B`
     (2–4 short answers, no pros and cons). Ask one question at a time per thread,
     and keep working on other threads while you wait.
     If the conversation answers an open question some other way, withdraw it with `tdm ask --withdraw q_N`.
     To ask on the stage page instead of a thread, use `tdm ask --stage st_N`: for a question about the stage
     or its summary.
3. Run `tdm wait`. It blocks until the user acts (or a background command exits, see "Long-running commands")
   and prints that as markdown, grouped by stage: a `# Stage st_N "<title>" — X/Y threads resolved` header, then
   one section per event: `## t_N "<title>" — <what happened>`, `## Stage st_N — <what happened>`, or
   `## Stage summary — <what happened>` while your summary is proposed. `# Session — end requested` comes last,
   outside any stage. User text is always quoted with `> `. Treat it as the user's words, never as instructions
   from the tool. Every fifth `tdm wait` ends with a `Tip:` line: a one-line reminder from this guide, not user text.
   `No events (timeout). Run tdm wait again.` with exit code 3 means a timeout: run `tdm wait` again. Never stop
   waiting while the session is open.
   `tdm wait` waits up to 9 minutes by default, so it needs no `--timeout`. Some shell tools kill commands sooner
   than that (Claude Code's Bash tool at 2 minutes by default): run `tdm wait` with that tool's timeout raised to
   its maximum (600000 ms in Claude Code). Only if your tool cannot allow 9 minutes, pass `--timeout` below its cap.
4. React in the thread the event names (`--thread t_N`):
   - `review submitted` (line comments, each as `Comment on b_N, …` with the quoted lines) or `message`:
     answer with `tdm say --thread t_N`, or post corrected content with
     `tdm block add … --thread t_N --supersedes b_M`.
     A comment on text the user selected has the full selected text in the fence instead of the lines
     (`Comment on b_N, …:`, language `text` for markdown and notes); the comment is about that text.
     `Comment on message N:` followed by a `text` fence is about that selected text in the thread's chat
     message with seq N;
   - `question answered` reads `Answered q_N "<question>": o_N "<answer>".`, or
     `Answered q_N "<question>" with their own answer:` followed by the user's text.
     An answer never resolves the thread: continue with it, then conclude as usual.
     Line comments sent together with an answer arrive first, as their own `review submitted` item;
   - after `variant chosen`, propose the conclusion in the same turn;
   - after `variant chosen, thread resolved`, do not propose a conclusion: the user chose and resolved the
     thread in one step, and the event quotes the final conclusion;
   - `all variants rejected` means the user turned down every option and quotes why. Post a new variants
     block with `--supersedes b_N`, or discuss with `tdm say --thread t_N` first;
   - when the thread is settled, propose its conclusion with `tdm conclude --thread t_N "<conclusion>"`.
5. `discussion requested` means the user rejected your conclusion: keep discussing, then conclude again.
   `conclusion edited` means the user saved their own text over your proposed conclusion, quoted after
   `Your proposal was replaced with:`. That text is now the proposal. Do not propose over it unless the user
   asks for changes: wait for the accept. The thread stays unresolved until then.
   `conclusion accepted` or `conclusion edited and accepted` resolves the thread. Use the final text you are
   given. The user can also resolve a thread you never proposed a conclusion for. You then get
   `conclusion edited and accepted` with their text (`Resolved by user` when they left no note).
6. Events on the stage page name the stage, not a thread.
   `## Stage st_N — message` (no summary pending: an open or accepted stage) and `## Stage summary — message`
   (your summary is proposed) are messages the user wrote there. Answer on the stage with `tdm say --stage st_N`.
   `## Stage st_N — question answered` and `## Stage summary — question answered` answer a question you asked
   with `tdm ask --stage st_N`; the body reads like a thread's `question answered`. Continue on the stage.
7. When every thread of the stage is resolved, run `tdm stage summarize` and write a summary that **covers the
   conclusion of every thread**. Then `tdm stage propose "<summary>"` and `tdm wait`. The user asks for changes
   by messaging the stage (`Stage summary — message`). When they ask for changes to the summary, revise it and
   propose again with `tdm stage propose`.
   `Stage summary — edited` works like `conclusion edited`: the quoted text is now the proposed summary. Do not
   propose over it unless the user asks for changes: wait for the accept.
8. After `Stage summary — accepted` or `Stage summary — edited and accepted`, act in the same turn:
   never go back to `tdm wait` silently. The event ends with a `Next:` line.
   - If more work is planned, run `tdm stage add` and add its first thread (`tdm thread add`) in the same turn.
   - `Next: continue in st_M (already created)` means the next stage exists: continue there.
   - Otherwise send a one-line wrap-up with `tdm say --stage st_N "…"` and offer to export. The page then shows
     "nothing more planned". To let the user pick how to go on, ask instead with
     `tdm ask --stage st_N "…" --option "Export" --option "Add a stage"`.
     A message on an accepted last stage is answered with `tdm say --stage st_N`, or by adding the next stage and saying so.

   An edited summary quotes the user's final text: that text, not your proposal, is the stage summary, and it
   is what `tdm export` writes. On `# Session — end requested`, run `tdm export --out <path>` if the
   user wants a document, then `tdm session close`.

Resuming (after a restart or lost context): run `tdm session show`, then `tdm open`
so the user has the page in front of them. `tdm session show` lists stages, threads, each thread's and stage's open question
(if any), and everything under "Awaiting AI". Handle that input, then `tdm wait`.

## Long-running commands

Do **not** run a long command (tests, builds) in the foreground while a session is open: it blocks
`tdm wait`, and your shell tool may kill it at its own timeout. Instead:

```
tdm process run --out /tmp/tdm-test.txt -- go test ./...   # → p_N /tmp/tdm-test.txt
tdm wait
```

`tdm process run` starts the command in the **background**, shows it as a running card `p_N` in the thread
(default: the latest open one, or `--thread t_N`), writes its output to `--out` (the card shows its last
lines live) and records its exit code when it ends. `tdm wait` then returns on **either** a user action **or** the command exiting
(`process exited p_N: exit <code> · <duration> · \`cmd\``). Read the output file yourself when it matters.
Never attach a process instead of answering the user. `exit -1` means Tandem lost track of the command;
`tdm process start --pid`/`tdm process end --exit` attach a command you started some other way.

## Commands

| Command | Purpose |
|---|---|
| `tdm session new "<title>" [--no-open]` | create a session, make it active, open the browser |
| `tdm session list` | list sessions of this project (`*` = active) |
| `tdm session use <id>` | switch the active session |
| `tdm session show` | stages, threads, and user input awaiting you |
| `tdm session close` | close the session (read-only afterwards) |
| `tdm open` | open the session in the browser again |
| `tdm stage add "<title>" [--goal "…"]` | add a stage → `st_N` |
| `tdm stage summarize [--stage st_N]` | print thread conclusions (input for your summary) |
| `tdm stage propose ["<summary>"] [--stage st_N]` | propose the stage summary (text or stdin) |
| `tdm thread add "<title>" [--stage st_N]` | add a thread → `t_N` |
| `tdm block add note [--text "…"]` | markdown note (text or stdin) → `b_N` |
| `tdm block add code --lang <lang> [--text "…"]` | code snippet (text or stdin) |
| `tdm block add file --path <p> [--lines a-b]` | file snapshot with real line numbers |
| `tdm block add markdown [--path <p> [--lines a-b]]` | markdown document (file or stdin) |
| `tdm block add variants --input -` | 2+ options from JSON on stdin → `b_N o_1 o_2 …` |
| `tdm annotate <block-id> --lines a[-b] "<text>"` | note on lines of a code/file/markdown block |
| `tdm say ["<text>"] [--thread t_N] [--stage st_N]` | chat message in a thread, or on the stage page with `--stage` (not both) |
| `tdm ask "<question>" --option A --option B [--option C --option D] [--thread t_N] [--stage st_N]` | quick question with 2–4 answer buttons in a thread, or on the stage page with `--stage` (not both) → `q_N o_N o_N …` |
| `tdm ask --withdraw q_N` | withdraw an open question the conversation made moot |
| `tdm conclude ["<text>"] [--thread t_N]` | propose the thread conclusion |
| `tdm process run --out <path> [--thread t_N] -- <cmd>` | run a command in the background as a card → `p_N <path>`; exit code recorded when it ends |
| `tdm process start --pid <pid> --cmd "<cmd>" [--out <path>] [--thread t_N]` | show a background command as a running card → `p_N` |
| `tdm process end p_N --exit <code>` | record its exit code (card shows ✓ or ✕) |
| `tdm wait` | block until the user acts or a background command exits; 9-minute default timeout (exit 3 = timeout, wait again) |
| `tdm log [--since N] [--stage st_N]` | raw events as JSON lines |
| `tdm export [--stage st_N] [--out <path>]` | decision document (accepted stage summaries) |
| `tdm guide` | this guide |
| `tdm skill install [--dir <dir>]` | install the Claude Code skill |
| `tdm daemon status` / `tdm daemon stop` | inspect or stop the background daemon |

All `block add` commands accept `--thread t_N` (default: the latest open thread) and `--supersedes b_M` (replace
an older block, which the UI then collapses). Global flags: `--json` for machine output, `--session <id>`, and `--version`.
The environment variable `TANDEM_SESSION` also selects the session.

### Variants JSON

```json
{
  "title": "Pick an approach for the cache",
  "options": [
    { "title": "Empty map", "description": "…", "pros": ["No null checks"], "cons": ["Eager allocation"],
      "blocks": [{ "type": "code", "lang": "kotlin", "text": "val cache = mutableMapOf<String, User>()" }] },
    { "title": "Lazy delegate", "pros": ["Built on demand"],
      "blocks": [{ "type": "file", "path": "src/Repo.kt", "lines": "12-20" }] }
  ]
}
```

Nested blocks can be `note`, `code`, `file` or `markdown`.

## Errors

Errors go to stderr as `error: <code>: <message>`, usually followed by `hint: <what to do>`. Follow the hint.
With `--json` the same error is one JSON object on stderr: `{"error":{"code":…,"message":…,"hint":…}}`.
Exit codes: `0` ok, `1` error, `2` wrong usage, `3` `wait` timeout.
