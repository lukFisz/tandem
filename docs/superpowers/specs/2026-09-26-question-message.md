# Question message and option chips

Decided in the tdm session "Question block" (s_0fe2de), stages st_1 "Purpose & scope" and st_2 "Data model, UI & guide". Replaces the parked roadmap item "`question` block".

## Part A — Option id chips (ships first, independent)

Agent text (notes, messages, conclusions, summaries) that mentions `o_N` renders as a chip with the option's title, the same way `t_N` and `st_N` do today. Hovering shows `id: o_N`. Clicking opens the option's thread and scrolls to the option. Unknown ids stay plain text. Once Part B lands, `q_N` gets the same chip with the question text, truncated.

## Part B — Question message

A question is an **AI message with answer buttons** in the thread's conversation, not a block kind. It exists for quick facts and decisions (yes/no, a value, confirming an assumption). `variants` stays the tool for real design choices.

### CLI

- `tdm ask "<question>" --option A --option B [--option C --option D] [--thread t_N]` posts the question and returns immediately, printing `q_N o_N o_N …`. The default thread is the latest open one, as for `tdm say`.
- `tdm ask --withdraw q_N` withdraws an open question the conversation has made moot.
- It is fire-and-forget. The answer arrives through `tdm wait`. There is no blocking mode in v1.

### Domain

New events:

| Event | Actor | Data |
|---|---|---|
| `question.asked` | ai | `threadId`, `questionId` (`q_N`), `text`, `options` `[{id, title}]` (2–4) |
| `question.answered` | user | `questionId`, exactly one of `optionId` / `other` |
| `question.withdrawn` | ai | `questionId` |

- `q_N` comes from a new question counter. Option ids come from the **global `o_N` counter shared with variants**.
- `message.posted` is unchanged. In state, `Message` gains an optional `question {id, options, answer?, withdrawn?}`. The asked event appends an AI message whose `text` is the question.
- `question.answered` also appends a user message `Answered: <title>` or `Answered: "<other>"`, like the `Chose:` message for variants.
- Decide rejects:
  - `ask`: a resolved thread, fewer than 2 or more than 4 options, an empty question, or an empty option title.
  - `answer`: an unknown `q_N`, a question that is already answered or withdrawn (the answer is final), a resolved thread, an empty `other`, and both or neither of `optionId`/`other`.
  - `withdraw`: an unknown `q_N`, or a question that is already answered or withdrawn.
- Answering never resolves the thread. The agent concludes as usual, and the user can still Resolve.
- The rule of one open question per thread is **not** enforced. It lives in the guide only.

### `tdm wait` output

```markdown
## t_4 "Storage format" — question answered
Answered q_2 "Must old logs stay readable?": o_7 "No".
```

For an Other answer, the item reads `Answered q_2 "Must old logs stay readable?" with their own answer:`, followed by the text quoted with `> `. As with variants, draft line comments sent together with an answer arrive first as their own `review.submitted` item.

### Web

- **Open question**: an AI bubble with the question (markdown), 2–4 buttons, and **Other…**. Other swaps the row for a one-line input with **Send answer**. Enter sends and Esc cancels. Keys `1`–`4` pick a button when focus is not in a text field.
- **Answered**: the buttons disappear, the bubble shows the answer as a muted line, and the `Answered: …` user message follows.
- **Composer while a question is open**: a normal message. The question stays open.
- **Withdrawn**: no buttons; the bubble shows *Withdrawn*.
- **Resolved thread or read-only session**: no buttons; an unanswered question shows *Not answered*.
- **Nav**: a thread with an open question gets the "awaiting you" dot, the same one a proposed conclusion gets.

### Guide (`internal/guide/guide.md`)

- In loop step 2, next to the variants bullet: use `tdm ask` when you need a quick fact or decision to continue (2–4 short answers, no pros and cons). Ask one question at a time per thread, and keep working on other threads while you wait. If the conversation answers an open question some other way, withdraw it.
- Command table rows for `tdm ask` and `tdm ask --withdraw`.
- "Reading `tdm wait` output": the two `Answered …` forms, plus a note that an answer never resolves the thread.

### Out of scope (later)

Multi-select, changing an answer while the thread is open, and a blocking `tdm ask --wait`. Several questions in one message is out entirely.

### Testing

- Domain: decide and reducer tests for ask, answer and withdraw, and for every rejection.
- CLI: the `ask` flag parsing.
- Render: `wait_test` for both answer forms.
- Daemon: contract tests.
- Go e2e: ask, answer, wait.
- Web: unit tests for the question message states and the chip, plus a Playwright case for answering with a button and with Other.
- Guide: the guide tests.
- Update `docs/ROADMAP.md`: remove the parked `question` block item.
