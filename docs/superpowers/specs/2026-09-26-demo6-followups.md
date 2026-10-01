# Demo 6 follow-ups

Decided in the tdm session "Demo 6: question message" (s_a3d50b), plus the guide gap found in chat right after it.

1. **Answer links to its question.** The `Answered: …` user message gets a header button that jumps to its question, the same way the "N line comments" header jumps to the comments. The header reads the question's first line, truncated like a chip, and clicking it opens the question's thread and scrolls to `[data-question="q_N"]`. The `Chose: …` message for a variant choice gets the same header, linking to its option, so choices, comments and answers all work alike.
2. **Undelivered messages look different.** A user message that the AI has not received yet (`msg.seq > delivered` and `msg.seq > thread.lastAiSeq`, the same rule `deliveryStatus` in `web/src/thread/delivery.ts` uses for "Sent · waiting for the AI to pick it up") renders muted, with a dashed border. It switches to the normal style once the AI receives it. Line comments keep their current look.
3. **Highlight the target of a jump.** After a chip or a header link (item 1) scrolls to an option or a question, the target gets a subtle highlight: a soft background tint that fades out over about 1 s. With `prefers-reduced-motion`, the tint is static and clears after about 1 s. The highlight plays on every jump, including a repeated click on the same chip.
4. **The guide opens the page.** In `internal/guide/guide.md`:
   - Loop step 1: don't pass `--no-open` unless the user asks; the user needs the page open in their browser.
   - Resuming: run `tdm session show`, then `tdm open` so the user has the page in front of them.

   Add a guide test for both sentences.

No new dependencies. Web changes rebuild `internal/daemon/webdist` in their own `build(web): …` commit.
