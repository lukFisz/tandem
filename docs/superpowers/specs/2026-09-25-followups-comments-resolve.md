# Follow-ups: line-comment header and one-click Resolve

Agreed with the user in a Tandem demo session, after the feature review changes
(`2026-09-25-feature-review-decisions.md`) shipped.

## A. "N line comments" header on user messages

When the user sends line comments (a review submit, with or without a typed message), the user's
message in the thread timeline gets a small header, styled like the existing `Chose: <option>`
header:

- `1 line comment`, `2 line comments`, …
- Clicking the header scrolls to the first of those comments and briefly highlights all of them.
  A comment on a block that was later superseded sits inside the collapsed "superseded" row; the
  click expands that row first.
- A draft-only send (comments, no text) shows the header alone, with no empty text. Today such a
  send adds no message at all; after this change it is its own timeline entry.
- Counting is per thread. A single send can carry comments on several threads (the draft is
  global), and the daemon already groups them per thread and only accepts comments on blocks of
  that thread. Each thread's message counts only its own comments. A thread that only received
  comments gets a header-only entry.

**Link in the snapshot.** The snapshot did not link a message to its comments: `thread.comments`
has no seq, and a comment-only send created no message. Each sent comment now carries the `seq`
of the review event that sent it (`thread.comments[].seq`); a user message and its comments share
that seq. No new event types; old logs replay unchanged and gain the seq from their own events.

A send that goes with another action (`Send choice`, `Resolve` with a draft pending) is two events
(the review, then the action), so it shows as two entries: `1 line comment`, then `Chose: …`.

## B. One-click Resolve

On an open thread (no proposed conclusion):

- **Resolve** resolves at once, with no note. The daemon fills in `Resolved by user`.
- **Add note** next to it opens the existing note editor (`Conclusion (optional)`, submit
  `Resolve`, `Cancel`).
- The hint `or press c to add a note` sits next to them (`c` in the usual `<kbd>` style).
- **c** opens the same editor when no line is selected. With a line selected, `c` still
  comments on the selection as before.
- A Resolve in flight disables both buttons; a second click never sends a second request.
