# Dogfood: polishing Tandem's existing features

## 1. First impressions
**Focus:** the polish pass targets the interaction flow (t_1). You then steered it towards the **stage summary flow**, which st_2 covers.

**Parked backlog from this stage:**
- **Conclusions (t_2):** Accept needs an in-flight guard; disagreeing should be discoverable (t_3, no option picked yet); "Accept edited" both saves and resolves.
- **Variants (t_4):** Cancel stays enabled while a send is pending; "None of these…" and "Reject all" name the same action; the primary button may be the wrong one.

## 2. Stage summary flow
**Stage summary flow: decisions**

1. **After Accept summary (t_6):**
   - Auto-advance to the next stage's first unresolved thread when one exists.
   - Otherwise show a "waiting for the AI's next step" bubble and an **End session** button in the accepted box. It goes still with a clear message if the AI adds nothing.
   - A new stage auto-advances only if you're still on the page, and the box shows a **Next: st_N →** link.
   - Accept gets an in-flight guard.
   - Agent side: `tdm wait` prints a **Next:** line, and the guide requires an immediate next step, never a silent `tdm wait`.
2. **The stage page becomes a conversation (t_7):**
   - An always-present composer and a stage timeline. Request changes is removed.
   - A collapsible thread list, plus `tdm say --stage`.
3. **Collapsible proposal cards everywhere (t_7):**
   - Summary and conclusion cards auto-collapse when you send a message and never auto-expand.
   - A re-proposal shows **· vN** and an **Updated** pill, plus a preview line.
4. **Edit → Save → Accept everywhere (t_7):**
   - Saving keeps the proposal open, marked *edited by you*. Accept is a separate click.
   - The AI is told and doesn't overwrite it.

**Carried over from st_1:** in-flight guard on conclusion Accept, and variant action-bar naming and Cancel-while-pending. With the composer-based discussion in (2) and (3), t_3's "disagree" question is mostly settled: a message is the way to disagree.

## 3. What next
Wrap up: export the decision document and write an implementation spec (stage summary flow, collapsible proposal cards, Edit → Save → Accept, plus the st_1 backlog) in `docs/superpowers/specs/`.
