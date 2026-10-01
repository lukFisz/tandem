# Tandem — design spec

Status: draft for review · Date: 2026-09-25

## 1. Problem & goal

Content produced by AI agents (code, documents, plans) is large and hard to read in a terminal. It lacks the
"why" notes, a way to compare options, and a structure that breaks it into digestible pieces.

**Tandem** is a CLI, driven by an AI agent, that runs a local web page where the user and the agent work through a
topic **stage by stage, thread by thread**. The agent posts notes, code, file excerpts, documents and variants.
The user reads, comments on specific lines, picks variants, and accepts conclusions. The agent waits for the
user's actions with a blocking command, reacts, and records conclusions. The accepted stage summaries form the
final decision document.

Use cases: brainstorming, code review, refining documents.

**Audience.** MVP: a personal tool (one user, one machine, Claude Code as the main agent). Target: open source,
agent-agnostic. The CLI contract is therefore designed as if it were public from day one.

Everything in the repo (code, docs, UI, CLI output) is in English.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Sessions | Many sessions per project, one *active*; `--session <id>` / `TANDEM_SESSION` override |
| Project id | Hash of git root path; fallback to hash of `cwd` |
| Thread lifecycle | AI proposes a conclusion → user accepts / edits / requests discussion |
| Stage lifecycle | Same mechanism: AI proposes a stage summary → user accepts / requests changes |
| Block types (MVP) | `note`, `code`, `file`, `markdown`, `variants` + AI line annotations + user line comments |
| File excerpts | Snapshot at time of adding (post-MVP: detect file changes) |
| Language | Go single binary with embedded web UI |
| Process model | One daemon per machine, auto-started, idle auto-shutdown |
| Storage | Event log (JSONL) per session in `~/.tandem/`, blobs for snapshots; no undo |
| User → AI delivery | Draft + "Send to AI" for line comments; chat, variant choice, and conclusion actions are sent immediately (and flush the draft) |
| CLI output | Compact markdown/text by default (LLM-friendly); `--json` on every command |
| Export | `tdm export`: session title + accepted stage summaries only |
| Agent onboarding | `tdm guide` (embedded protocol) + `tdm skill install` (Claude Code skill) |
| Frontend | React + Vite + TypeScript, Shiki, markdown-it |
| Look | Layout B (nav + thread timeline); style "editorial + IDE code" hybrid, light/dark |
| Process | TDD for every layer |

## 3. Domain model

```
Project   id = hash(git root | cwd)          (project.json: root path, active session id)
 └─ Session   s_<6 chars>   title            status: active | closed
     └─ Stage   st_N   title, goal?          status: open | summary_proposed | accepted
         ├─ summary (proposed text / accepted text)
         └─ Thread   t_N   title             status: open | conclusion_proposed | resolved
             ├─ blocks[]       b_N   (note | code | file | markdown | variants), may supersede an older block
             │   └─ annotations[]    AI notes anchored to line ranges (code, file, markdown)
             ├─ comments[]     user line comments (delivered via review.submitted)
             ├─ messages[]     chat, actor ai | user
             └─ conclusion     proposed text → accepted text
```

- Ids inside a session are short and sequential (`st_1`, `t_3`, `b_7`, `o_2`) to keep agent output cheap in tokens.
  Session ids are random (`s_8f2a1c`).
- **Awaiting AI** is a derived per-thread flag: the thread has user events delivered to the agent after the
  agent's last action in that thread (message, block, conclusion). `tdm session show` lists these threads, which
  makes resuming safe.

### Rules (enforced by the daemon, each covered by tests)

- Threads/blocks can only be added to an `open` stage; adding to an `accepted` stage → error.
- `tdm conclude` sets the thread to `conclusion_proposed`; a new proposal replaces the previous one.
- `conclusion.discussion_requested` returns the thread to `open`.
- `tdm stage propose` requires all threads in the stage to be `resolved`; otherwise the error lists the open
  threads in its hint.
- `stage.summary.changes_requested` returns the stage to `open`.
- `block add --supersedes b_N`: the old block stays in the log; the UI collapses it to one line ("superseded by b_M").
- Closed sessions are read-only.

## 4. Block types

| Type | Input | Notes |
|---|---|---|
| `note` | `--text` or stdin (markdown) | The "why" / context from the AI, rendered as prose |
| `code` | `--lang <lang>` + `--text` or stdin | Highlighted; Java, Kotlin, Go, Python at minimum (Shiki supports more) |
| `file` | `--path <p> --lines <a-b>` (lines optional = whole file) | Snapshot stored as a blob; line numbers match the real file; language from extension |
| `markdown` | `--path <p> [--lines]` or stdin | Rendered; each rendered top-level element keeps its source line range (markdown-it `token.map`) so annotations and comments anchor to lines |
| `variants` | `--input -` JSON | 2–N options, each: `title`, `description?`, `pros[]`, `cons[]`, `blocks[]` (nested note/code/file/markdown). User chooses one (optional comment) or rejects all (comment required) |

**Annotations:** `tdm annotate <blockId> --lines 14-15 "text"` for `code`, `file`, `markdown` blocks.

**User line comments:** select line(s) on the page → comment → it goes to the draft.

Variants input example:

```json
{
  "title": "Pick an approach for the cache",
  "options": [
    { "title": "Empty map", "pros": ["No null checks"], "cons": ["Eager allocation"],
      "blocks": [{ "type": "code", "lang": "kotlin", "text": "val cache = mutableMapOf<String, User>()" }] },
    { "title": "Lazy delegate", "pros": ["Built on demand", "Non-null type"], "cons": [] }
  ]
}
```

## 5. CLI

### Conventions

- **stdout:** compact markdown/text by default. `--json` on every command gives a stable, complete contract
  (includes `seq`, `ts`, full ids).
- **stderr + exit code** for errors:
  ```
  error: thread_not_found: no thread t_9 in session s_8f2a1c
  hint: run `tdm session show` to list threads
  ```
  With `--json`: `{"error":{"code":"…","message":"…","hint":"…"}}`.
- **Exit codes:** `0` ok, `1` error, `2` usage error, `3` `wait` timeout.
- **Global:** `--session <id>`, env `TANDEM_SESSION`, `TANDEM_HOME` (default `~/.tandem`).
- **Defaults:** omitted `--stage` → the latest open stage; omitted `--thread` → the latest open thread.
- **Complex input:** `--input -` reads JSON from stdin.
- **Text input:** `--text "…"` or stdin.

### Commands

```
tdm session new "<title>" [--no-open]       → "s_8f2a1c <url>"; sets active; starts the daemon if needed
tdm session list                            → sessions of this project, active marked
tdm session use <id>
tdm session show                            → markdown: stages, threads, statuses, awaiting-AI threads
tdm session close
tdm open                                    → opens the browser on the active session

tdm stage add "<title>" [--goal "…"]        → st_N
tdm thread add "<title>" [--stage st_N]     → t_N

tdm block add note     [--thread t_N] (--text … | stdin)                         → b_N
tdm block add code     --lang <lang> (--text … | stdin)                          → b_N
tdm block add file     --path <p> [--lines a-b]                                  → b_N
tdm block add markdown (--path <p> [--lines a-b] | stdin)                        → b_N
tdm block add variants --input -                                                 → b_N (+ option ids)
  (all block add: [--thread t_N] [--supersedes b_M])
tdm annotate <blockId> --lines a[-b] "<text>"

tdm say "<text>" [--thread t_N | --stage st_N]  AI chat message in a thread or on a stage page
tdm conclude "<text>" [--thread t_N]        propose a thread conclusion
tdm stage summarize [--stage st_N]          → markdown: accepted conclusions of all threads (AI input)
tdm stage propose "<text>" [--stage st_N]   propose a stage summary

tdm wait [--timeout 9m]                     → markdown of new user events | exit 3 on timeout
tdm log [--stage st_N] [--since <seq>]      → raw events (always JSONL)
tdm export [--stage st_N] [--out <path>]    → markdown decision document

tdm guide                                   → agent protocol (markdown)
tdm skill install                           → writes ~/.claude/skills/tandem/SKILL.md
tdm daemon status | stop
```

## 6. `tdm wait` contract

- **Server-side cursor.** The daemon remembers what it delivered to the agent (persisted as a
  `agent.delivered {upTo}` system event). The agent never tracks sequence numbers. `tdm log --since` exists for
  re-reading.
- Returns as soon as at least one undelivered **user** event exists; returns all of them.
- **Timeout** default 9 min (agent shell tools usually cap at ~10 min). On timeout: prints
  `No events (timeout). Run tdm wait again.` and exits with 3.
- **One waiter per session.** A new `wait` makes the previous one return error `wait_superseded`.
- While a `wait` is active, the page shows "AI is waiting for you"; otherwise "AI is working…".

### User event types (delivered to the agent)

| type | data (thread context added on output) |
|---|---|
| `review.submitted` | per thread: line comments (`blockId`, `lines`, `text`), optional general message |
| `chat.message` | `text` (+ flushed draft, rendered like `review.submitted`) |
| `variant.chosen` | `blockId`, `optionId`, `comment?` |
| `variants.rejected` | `blockId`, `comment` |
| `conclusion.accepted` | `text` |
| `conclusion.edited` | `original`, `text` (edited and accepted: Resolve with a note; the UI's Accept edited before Save existed) |
| `conclusion.revised` | `text` (the user saved their own text over the proposed conclusion; the thread stays proposed: "conclusion edited") |
| `conclusion.discussion_requested` | `comment` |
| `stage.summary.accepted` | `text`, `original?` (set when the user edited the summary before accepting: "edited and accepted") |
| `summary.revised` | `stageId`, `text` (the same for a proposed stage summary: "stage summary — edited") |
| `stage.summary.changes_requested` | `comment` |
| `message.posted` (user, on a stage) | `stageId`, `text` (a message on the stage page; the AI's `tdm say --stage` posts the same event as actor `ai`) |
| `session.end_requested` | `comment?` |

### Markdown output format

Grouped by stage, then thread; stable heading template; user text always quoted with `>`; quoted code always
fenced with its language (fence lengthened if the content contains backticks).

````markdown
# Stage st_1 "Data model" — 3/5 threads resolved

## t_3 "Repository layer" — review submitted

Comment on b_7, `src/Repo.kt:14-15`:
```kotlin
    val cache: Map<String, User>? = null
    private var dirty = false
```
> Why nullable instead of an empty map?

Message:
> Overall fine, but the cache worries me.

## t_4 "Storage format" — variant chosen

Chose o_2 "JSONL event log" (block b_9):
> Keep blobs outside the log.
````

Line comments on `markdown` blocks quote the source lines the same way (fenced as `markdown`).

## 7. Architecture

```
agent ──exec──► tdm (CLI, thin HTTP client) ──HTTP+token──► tdm daemon (one per machine)
                                                              │  owns all state, single writer
browser ◄──────────── SSE (state snapshots) ──────────────────┤
browser ───────────── POST user actions (cookie token) ──────►│
                                                              ▼
                                                   ~/.tandem/projects/<pid>/sessions/<sid>/events.jsonl
```

### Daemon lifecycle

- Any CLI command that needs the daemon reads `~/.tandem/daemon.json` (`port`, `pid`, `version`, `token`; mode
  `0600`) and calls `/health`. If there is no response, or the version differs from the CLI's, it (re)starts the
  daemon in the background and retries.
- **Idle shutdown** after 30 min with no API requests, no active `wait`, and no SSE clients.
- On start, the daemon lazily loads sessions (replaying the log into memory) the first time they are accessed.

### Security (MVP, mandatory)

User events drive an agent that runs commands on the machine, so forged events amount to prompt injection.

- Listen on `127.0.0.1` only.
- A random token is required on every request: the CLI uses it from `daemon.json`; the browser gets it via the
  `tdm open` URL (`?token=`), then it is exchanged for an `HttpOnly`, `SameSite=Strict` cookie.
- Reject requests whose `Host` is not `127.0.0.1:<port>`/`localhost:<port>` (DNS rebinding) or whose `Origin`
  on mutating requests does not match (CSRF).

### HTTP API (internal, used by the CLI and the web UI)

```
GET  /health                                  → {version}
POST /api/projects/{pid}/sessions             create
GET  /api/sessions/{sid}/state                full derived state (JSON)
POST /api/sessions/{sid}/commands             agent commands {type, data} → validated → events
POST /api/sessions/{sid}/actions              user actions from the browser → events
GET  /api/sessions/{sid}/wait?timeout=        long-poll; ?format=md|json
GET  /api/sessions/{sid}/render/{what}        md renders: show | summarize | export
GET  /api/sessions/{sid}/stream               SSE: full state snapshot after each change
GET  /api/blobs/{sha}                         snapshot content
GET  /                                        embedded SPA (session list at /, session at /s/{sid})
```

Commands vs. events: the daemon validates a **command** against the current state, and only then appends one
or more **events**. State is a pure fold over events. The SSE stream pushes whole state snapshots: sessions are
small, and this avoids a second reducer in TypeScript.

### Go package layout

```
cmd/tdm/                 main
internal/domain/        ids, events, commands, state, reducer (fold), validation — pure, no I/O
internal/store/         JSONL append (fsync) / load (tolerate a truncated last line), blobs, project registry
internal/render/        markdown renderers: wait, show, summarize, export
internal/daemon/        HTTP server, auth, SSE hub, wait broker, idle shutdown, embedded web assets
internal/client/        daemon discovery/auto-start, HTTP client
internal/cli/           cobra commands, output formatting (text/json), error+hint mapping
internal/guide/         embedded guide.md and SKILL.md
web/                    React + Vite + TS app, built into internal/daemon/webdist
schema/                 JSON Schema generated from Go types → TS types for web/
```

## 8. Storage

```
~/.tandem/
  daemon.json
  projects/<projectId>/
    project.json                     {rootPath, name, activeSessionId}
    sessions/<sessionId>/
      events.jsonl                   single source of truth, append-only
      blobs/<sha256>                 file snapshots and large content
```

Event envelope:

```json
{"seq":42,"ts":"2026-09-25T10:12:03Z","actor":"ai","type":"thread.created","v":1,"data":{"id":"t_3","stageId":"st_1","title":"Repository layer"}}
```

- `actor`: `ai | user | system`. `v`: per-type schema version. Older versions are upcast on load.
- Each append is followed by `fsync`. On load, a malformed last line is skipped with a warning; malformed lines
  elsewhere are a hard error.
- Event types: `session.created`, `session.closed`, `session.end_requested`, `stage.created`,
  `stage.summary.proposed|accepted|changes_requested`, `thread.created`, `block.added`, `annotation.added`,
  `message.posted`, `conclusion.proposed|accepted|edited|discussion_requested`, `review.submitted`,
  `variant.chosen`, `variants.rejected`, `agent.delivered`.
- No undo, time travel or branching in MVP (the log keeps these possible later).
- The user's unsent draft lives in the browser (`localStorage`, per session) until it is sent. So do unsent
  composer text and an unsent Resolve note, per session and thread (`tdm:composer:<sid>:<threadId>`,
  `tdm:note:<sid>:<threadId>`), until sent, resolved or cancelled.

## 9. Web UI

**Layout B:**
- left nav: stages → threads with status icons and draft-count badges;
- main area: the selected thread as a chronological timeline (blocks, chat, conclusion card) with a sticky
  composer;
- top bar: session title, AI status, **Send to AI · N**, Export (copies markdown), End session.

The session list is at `/`.

**Style, "editorial + IDE code" hybrid:**
- **Prose** (notes, AI messages, conclusions, markdown, titles): serif reading face (Charter / Iowan Old Style),
  max ~600px wide, warm background.
- **Code:** dark IDE-like panel in both themes (JetBrains-like palette via Shiki), JetBrains Mono. It may be
  wider than the prose.
- **UI chrome and user messages:** system sans.
- **AI annotations:** italic serif with an amber left bar, under the line. **User draft comments:** green bar,
  labelled "You · draft".
- **Colour:** one accent (amber) = "needs your attention" (AI waiting, draft counts, selected variant); green is
  for conclusions and acceptance.
- **Superseded blocks** collapse to one line.
- Light/dark follows the system setting.

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| `j` / `k` | next / previous thread |
| click or shift-click a line | select a line range |
| `c` | comment on the selection; with no selection on an open thread, add a note and resolve |
| `⌘↵` | send (message + draft) |
| `a` | accept the proposed conclusion |

Reference mockups: `.superpowers/brainstorm/*/content/hybrid.html`.

## 10. Agent onboarding

- `tdm guide` prints the protocol:
  - the loop (`wait` → react → `wait`; on exit code 3, wait again);
  - when to create a stage or a thread;
  - how to write notes: explain *why*, annotate non-obvious lines;
  - always `conclude` when a thread is settled, and after `variant.chosen` propose the conclusion in the same turn;
  - **a stage summary must cover the conclusion of every thread**;
  - resuming with `tdm session show`;
  - a reading guide for the `wait` output format.
- `tdm skill install` writes a Claude Code skill: when to use Tandem (reviewing large AI output, brainstorming,
  document refinement), plus "run `tdm guide` first".

## 11. Export

`tdm export` prints (or `--out` writes):

```markdown
# <session title>

## 1. <stage title>
<accepted stage summary>

## 2. <stage title>
<accepted stage summary>

_Stage 3 "<title>" — not yet accepted._
```

No dates, code, or conversations. The stage summary is the verified synthesis of its threads.

## 12. Full session flow (reference)

1. `tdm session new` → daemon auto-starts, session becomes active, URL returned.
2. The agent adds a stage, threads, and blocks (notes, file snapshots, annotations, variants).
3. `tdm open` → the browser opens (token → cookie).
4. `tdm wait` blocks; the page shows "AI is waiting". The user comments (draft), picks a variant (sent at once,
   flushing the draft) → the agent receives markdown with quotes.
5. The agent replies (`say`), posts corrected blocks (`--supersedes`), and proposes conclusions (`conclude`), then
   waits again. The user accepts, edits, or requests discussion.
6. Repeat until all threads are resolved (timeouts → wait again).
7. `tdm stage summarize` → `tdm stage propose` → the user accepts or requests changes.
8. Next stage, repeat 2–7.
9. The user clicks End session → the agent receives `session.end_requested` → `tdm export --out …` →
   `tdm session close`.

Resume after an agent restart: `tdm session show` (lists awaiting-AI threads with their pending user input) →
`tdm wait`.

## 13. Development process & testing

**TDD throughout:** every behaviour starts as a failing test. The plan is organised as test → implementation
pairs per layer.

1. **Domain (Go unit, table-driven):** the reducer and command validation. Covers every rule in §3, all state
   transitions, the awaiting-AI derivation, and id generation. This is the core and gets the densest tests.
2. **Store (Go unit):** append/load round-trip, truncated-last-line tolerance, blob dedup, upcasting.
3. **Render (Go golden files):** `wait`, `show`, `summarize`, `export`. Covers fence lengthening, quoting of
   user markdown, and grouping.
4. **Daemon + CLI integration (Go):** a real daemon in a temp `TANDEM_HOME`, driven through the CLI with `--json`.
   Scenarios:
   - the full loop;
   - `wait` timeout (exit 3) and supersede;
   - daemon restart and resume;
   - version-mismatch restart;
   - token, Host, and Origin rejection;
   - error codes and hints.
5. **Web (Vitest + Testing Library):** draft handling, line selection, variant choice, and conclusion-card
   actions, against mocked state.
6. **E2E (Playwright):** CLI adds a thread → page shows it → line comment → Send → `tdm wait` output matches the
   golden file.
7. **Agent legibility eval (manual script, not CI):** headless Claude Code with `tdm guide` plus a scripted
   "fake user" that posts prepared events. Checks that the agent replies in the right thread and references the
   right blocks and lines. It is used to tune the `wait` markdown format.

## 14. MVP scope

**In:** everything in §§3–13.

**Out (later):**
- `diff` and `question` blocks;
- file-change detection for snapshots;
- time travel and session branching;
- a stage overview (whole-stage document) view;
- multi-user;
- packaging (brew/npm) and cross-agent polishing for the open-source release.
