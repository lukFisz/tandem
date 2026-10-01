# Feature review & brainstorm

## 1. Feature tour
Feature tour: what works and what changes.

**Works, keep as is**
- t_1: Line comments and annotations; draft comments go out with the next message.
- t_2: Code blocks, markdown rendering and superseding.
- t_4: The proposed-conclusion flow (Accept / Edit / reply to discuss).

**Changes to make**
1. **Landing on open (t_5):** open the first unresolved thread in stage/thread order; pending conclusions no longer jump ahead.
2. **Draft count (t_1):** the composer's Send button shows how many draft comments go along.
3. **Choice header (t_3):** a message sent with a variant choice shows "Chose: <option>", also when there's no text.
4. **Silent agent (t_6):** the daemon tracks the agent's last CLI call. After 10 min of silence with no `tdm wait` running, the bubble reads "AI quiet for 10m, it may have stopped" and the top bar shows "AI not connected".
5. **User-side resolving (t_7):** a **Resolve** button on open threads (optional note → conclusion, sent as "edited and accepted"), plus **Choose & resolve** on variants.
6. **Polish (t_8):** drop the yellow border on the variant choice comment box.

**Next parked feature (t_3):** the `question` block.
