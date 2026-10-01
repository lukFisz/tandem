# Demo 7 follow-ups

These come from the tdm session "Demo: the new stage summary flow" (s_13ac25), after the stage summary flow landed (`2026-09-26-stage-summary-flow.md`). The first five polish existing behaviour. The sixth adds one missing surface.

Rules that apply to all of them:
- Old `events.jsonl` logs must replay unchanged, and new JSON fields are `omitempty`.
- No new dependencies.
- Every new animation is still under `prefers-reduced-motion`.
- Commits use conventional style with no co-author trailer.
- `internal/daemon/webdist` is rebuilt and committed only at the end.

## 1. Collapsed preview ends with "(...)"

A collapsed proposal card shows `previewOf(text)`, the first sentence, clipped by CSS. When the full text holds more than the preview, the preview ends with ` (...)` right after the last shown word.
- `(...)` is its own element and is never clipped. When the sentence itself is too long for the line, the sentence text is ellipsis-clipped and `(...)` stays visible after it. Use a flex row: the text span has `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, and the marker is `flex: none`.
- When the preview is the whole text, there is no marker.
- The marker is muted and `aria-hidden`. The card's accessible name and the text are unchanged.
- Add a helper `hasMore(text)` next to `previewOf` in `web/src/proposal/proposals.ts`, with unit tests.

## 2. Bottom padding under the page content

A resolved thread or accepted stage has no composer, so its last card sits on the page's bottom edge. Give the thread and stage articles bottom padding (about 48px) so the last element has breathing room. Make sure it doesn't add a gap above the sticky composer on open items (check `.composer` / sticky styles), and adjust if it does. A CSS pattern test, like the existing `styles/*.test.ts`, pins the rule.

## 3. Keep collapse state and scroll position across navigation

Both live in memory for the page session and are lost on reload, as today.
- **Collapse:** move the collapse state out of the per-thread/per-stage component into a session-level store keyed by card: `conclusion:<threadId>` / `summary:<stageId>`. A small context or module-level `Map` owned by `SessionPage`/`LoadedSession` works. Leaving an item and coming back restores the card collapsed or expanded, and keeps the `collapsedAt` version, so "Updated" still works. `useProposalCollapse` keeps its interface (`collapsed`, `updated`, `toggle`, `collapse`) and gains a `key` argument.
- **Scroll:** `useFollowBottom` resets `scrollTop = 0` on an item switch (`web/src/shell/useFollowBottom.ts:~107`). Instead, remember each item's `scrollTop` when leaving it, and restore it when returning.
  - An item never visited before still starts at the top.
  - A jump target (an id chip, a comment jump) or a landing target (`data-land`) still wins over the restored position.
  - An item the user was following at the bottom (within the follow threshold) is restored to the bottom, so new content keeps following.
- Tests: switching away and back restores both. A never-visited item starts at the top. A jump still wins.

## 4. Scroll after Accept summary; more visible typing dots (option 2)

- **Scroll:** after a successful **Accept summary** that does not auto-advance (no later stage exists), scroll the main pane to the bottom, so the accepted box and its waiting or end state are in view. Smooth scroll, or `behavior: 'auto'` under reduced motion, using `prefersReducedMotion()` from `shell/motion.ts` like the other automatic scrolls.
- **Dots (option 2):** every typing bubble.
  - Dots are 8px and use the accent color (`var(--accent)`, or the closest existing token).
  - Keyframes go from 30% to 100% opacity with a 4px lift.
  - The bubble's background pulses softly while animating: a keyframe between `var(--user-bg)` and `color-mix(in srgb, var(--accent) 14%, var(--user-bg))`, about a 1.6s infinite ease-in-out.
  - The quiet state (`.is-quiet`) does not pulse.
  - Under `prefers-reduced-motion`: no dot animation and no background pulse. Dots are static at 70% opacity, as today.
  - Check contrast in dark mode, where the theme tokens exist.

## 5. Accepted and resolved cards keep Collapse/Expand

A resolved thread's conclusion card and an accepted stage's summary text have the same collapse toggle and preview (including #1's "(...)") as a proposed card. They have no Accept/Edit, no version pill and no Updated pill.
- They start expanded, and their state lives in #3's store under the same keys, so a card collapsed while proposed stays collapsed once accepted.
- In the accepted stage box, only the summary text collapses. The waiting bubble, "nothing more planned", End session and the Next link stay visible below it.
- Reuse `ProposalCard`, extended with an option for no version or updated pill and no actions, or add a small `ResolvedCard` that shares the header and preview markup. Keep the region names: `Conclusion` for a resolved thread and `Stage summary` for the accepted box.

## 6. Questions with answer buttons on a stage

`tdm ask` works only on threads today, so the AI can't ask a quick question in the stage chat. Add `--stage`.
- **CLI:** `tdm ask "<question>" --option A --option B [--option C --option D] --stage st_N` prints `q_N o_N …` as today. `--thread` together with `--stage` is a usage error (exit 2) `pass --thread or --stage, not both`, the same as `tdm say`. Neither flag keeps today's default, the latest open thread.
- **Domain:**
  - `Ask` gains `StageID` (omitempty). `question.asked` carries exactly one of `threadId` / `stageId`, and old events have `threadId`.
  - The question's AI message goes to `Stage.Messages`, which bumps the stage's `lastAiSeq`.
  - `question.answered` on a stage question appends the user message (`Answered: …`) to the stage and bumps the stage's `lastUserSeq`.
  - Withdraw works the same way.
  - Any stage status accepts a question, like stage messages. Only a closed session refuses one.
  - Decide finds a question in either threads or stages.
- **`tdm wait`:** `## Stage st_N — question answered` (or `## Stage summary — question answered` while a summary is proposed), with the same body as the thread version: `Answered q_N "<question>": o_N "<answer>".` or the own-answer form.
- **`tdm session show`:** a stage's open question is listed the same way a thread's is.
- **Web:** stage messages that carry a question render with `QuestionMessage`, including the buttons, "Other…" and keys 1–4. Keys 1–4 answer the latest open question on the current item, whether it is a thread or a stage. `q_N` chips resolve to stage questions too.
- **Guide:** the `tdm ask` row and the loop text mention `--stage`, especially for the "nothing more planned" end state and questions about a summary.
- **Tests:**
  - Go: decide, reducer, replay of old question events, wait output, show output and CLI.
  - Web: StageView renders a question and answering sends `question.answer`; keys 1–4 on the stage page.
  - Regenerate the snapshot contract fixture only if the scenario changes.
