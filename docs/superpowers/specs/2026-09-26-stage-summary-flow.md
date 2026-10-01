# Stage summary flow, proposal cards and Edit → Save → Accept

Decided in the Tandem dogfood session "Dogfood: polishing Tandem's existing features" (s_37f37c), stages st_1 "First impressions" and st_2 "Stage summary flow". The raw decision export is `2026-09-26-dogfood-decisions.md`. Scope is polishing existing flows. The only new surface is stage-level chat, which reuses the thread chat pattern.

Parts ship in order. Each part is independent of the ones after it, except where noted.

## Part A — Quick fixes (st_1 backlog)

- **In-flight guards** on conclusion **Accept** (`thread/ConclusionCard.tsx:46-53`) and **Accept summary** (`stage/StageView.tsx:96-98`). They work like `ResolveThread.tsx:46-59`: a ref and a `busy` state disable the button while the event is sending. This closes the ROADMAP item.
- **Variants action bar** (`blocks/VariantsBlock.tsx:116-145`):
  - **Cancel** is disabled while a send is pending.
  - A single name for rejecting all options: the link and the editor's submit button both read **None of these**.

## Part B — After Accept summary (st_2 / t_6)

### UI

| Situation at accept | Immediately | Later |
|---|---|---|
| A later stage exists | Auto-advance to its first unresolved thread, or to its stage page if it has no threads | — |
| This was the last stage | The accepted box shows a typing bubble *"Summary accepted — waiting for the AI's next step…"* and an **End session** button | A new stage appears and the user is still on this page: auto-advance. In every case, add a **Next: st_N →** link to the box. |
| | | The agent is back in `tdm wait` and no stage was added: the bubble goes still with *"The AI has nothing more planned. Message it, or end the session."* |

- Auto-advance applies only if the user hasn't navigated away since accepting. It uses the same `currentRef` check as `onResolved` in `shell/SessionPage.tsx`.
- The bubble follows the existing typing-bubble rules: it is still while the agent waits, and goes quiet after 10 minutes. It uses `stageAwaitsSummary`-style logic in `thread/delivery.ts`, plus an "awaits next step" predicate: the stage is accepted, it is the last stage, and the session is open.
- **End session** in the box goes through the same `onEnd` path as the top-bar button.

### Agent side

- After `## Stage summary — accepted` or `## Stage summary — edited and accepted`, `render/wait.go` appends one line:
  - If no later stage exists: ``Next: add the next stage (`tdm stage add`), or tell the user you have nothing more (`tdm say --stage st_N "…"`), then `tdm wait`.``
  - If one exists: `Next: continue in st_M (already created).`
- Guide step 7 (`internal/guide/guide.md:51`): act right away after an accepted summary.
  - If more work is planned, run `tdm stage add` and add its first thread in the same turn.
  - Otherwise, send a one-line wrap-up with `tdm say --stage st_N` and offer to export.
  - Never return to `tdm wait` silently.
- `tdm say --stage` depends on Part E. Until E lands, the "nothing more" branch uses the End session hint only.

## Part C — Edit → Save → Accept, everywhere (st_2 / t_7)

Today **Accept edited** saves and resolves in one step. The new flow separates the two for thread conclusions **and** stage summaries.

- **Edit** opens the editor, and its submit button reads **Save**. Saving replaces the proposed text. The card stays in its proposed state and is marked *edited by you*. **Accept** is a separate click and accepts the current (edited) text.
- New events, both with actor user:
  - `conclusion.revised` with `threadId` and `text`: `proposedConclusion` becomes `text`, the status stays `conclusion_proposed`, and `editedByUser` is set to true.
  - `summary.revised` with `stageId` and `text`: the same, for a stage.
- Keep `conclusion.edited` and the edited form of `stage.accept` so existing logs still replay. The UI stops emitting them.
- An AI re-proposal clears `editedByUser`.
- `tdm wait` sections:
  - `## t_N "…" — conclusion edited` is followed by `Your proposal was replaced with:` and the quoted text.
  - `## Stage summary — edited` has the same shape.
- Guide: the user's saved text is now the proposal. Don't re-propose over it unless the user asks for changes. Wait for the accept.
- `conclusion accepted` quotes the final text, whether it was edited or not. The `edited and accepted` wording stays only for user-resolved threads (`ResolveThread` with a note).

## Part D — Collapsible proposal cards (st_2 / t_7)

This applies to the **proposed conclusion** card and the **proposed stage summary** card.

- The header row shows the kicker, the version (**· vN**, when N > 1) and a collapse/expand toggle. **Accept** and **Edit** stay in the header when the card is collapsed.
- The card **auto-collapses when the user sends a message** in that thread or stage, so the reply stays visible. It **never auto-expands**.
- If the AI re-proposes while the card is collapsed, the header shows an **Updated** pill and a one-line preview (the first sentence). The pill pulses once, and is a static accent colour under `prefers-reduced-motion`. Expanding clears the pill.
- Earlier versions appear in the timeline as collapsed "vN" entries, the same way `Superseded.tsx` shows replaced blocks.
- The collapse state is per card, in memory, and resets on a new proposal only if the user expands it. It is not persisted across reloads.

## Part E — Stage conversation (st_2 / t_7)

The stage page works like a thread.

- **The composer is always at the bottom of the stage page**, including before any summary exists. It keeps a draft per stage the way `Composer.tsx` keeps one per thread.
- **Stage timeline**: user and AI messages and summary proposals, in order.
  - The newest proposal is the live card from Part D.
  - Older proposals are collapsed.
- The thread list (with conclusions) collapses to one line, *"Threads (N/N resolved) ▸"*, once a summary is proposed. It can be expanded.
- **Request changes is removed.** A message on the stage is the way to ask for changes. `stage.request_changes` stays replayable but the UI stops emitting it.
- Domain:
  - `Say` gains `StageID`, and exactly one of `threadId` / `stageId` is required.
  - `message.posted` carries either `threadId` or `stageId`.
  - A user message on a stage creates an "awaiting AI" item, like a thread message does.
- CLI: `tdm say --stage st_N "<text>"`.
- `tdm wait`:
  - Before a proposal: `## Stage st_N — message`.
  - Once a summary is proposed: `## Stage summary — message`.
  - Both quote the user's text.
- Guide: reply to stage messages with `tdm say --stage`, and re-propose with `tdm stage propose` when the user asks for changes.

## Not decided / parked

- t_3 ("disagree" affordance on a thread conclusion): Parts D and E make the composer the obvious path, so no extra button for now. Revisit after using D.
- Other interaction areas not yet reviewed: question "Other…", line comments and review submit, keyboard flow.
