# Demo: comments header + one-click Resolve

## 1. Try the follow-ups
Follow-up demo: everything works, seven follow-ups.

**Works**
- t_1: Line comments reach the agent with the message, and the message shows the "N line comments" header. Resolved with one click.
- t_2: One-click Resolve closes the thread as "Resolved by user".
- t_3: Add note / `c` work.
- t_4: A line comment plus Choose & resolve arrive as two events: the comment first, then the choice ("question block").

**Follow-ups to implement**
1. (t_5) Scroll the Resolve note editor fully into view when it opens (c / Add note).
2. (t_5) Keep unsent composer text and an unsent Resolve note per thread, across thread switches and reloads (ROADMAP backlog item).
3. (t_3) Bug: the composer's Send button must be enabled when there are draft comments even with empty text; it then sends only the comments.
4. **Readable ids.** Wherever the agent's text mentions `t_N` or `st_N` (notes, messages, conclusions, summaries), the page shows it as a chip: the thread's or stage's **title** on a distinctive background, truncated with an ellipsis when too long. Hovering shows `id: t_N` (or `id: st_N`), and clicking opens that thread or stage. The agent keeps writing short ids; the page does the translation. Unknown ids stay as plain text.
5. **Animated "waiting for the stage summary" state.** While the stage is waiting for the agent's summary (all threads resolved, or after "changes requested"), the static message gets the same kind of animation as the typing bubble. Same rules: no animation while the agent is idle in `tdm wait`, quiet state after 10 min of silence, reduced motion honored.
6. **Land on the top of a new stage summary.** When a stage summary is proposed (or re-proposed), the page scrolls to the *start* of the proposed summary, not to the bottom.
7. **Edit a proposed stage summary.** Next to Accept / Request changes, add **Edit** like on a proposed thread conclusion: edit the text and accept it. The agent receives "stage summary edited and accepted" with the final text, and that text is what `tdm export` uses.
