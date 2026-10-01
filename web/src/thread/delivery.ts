import type { Stage, State, Thread } from '../api/types'

const SENT = 'Sent · waiting for the AI to pick it up'

// deliveryStatus is the small status line shown under the user's latest message while the AI
// has not yet picked it up: null once the AI has replied (msg.seq <= thread.lastAiSeq) or once
// the message has been delivered to the agent (the typing bubble — see isReplying — takes over
// from there, round 3 #6), and "Sent · waiting for the AI to pick it up" in between. Also null
// once the thread is resolved: Choose & resolve adds a user message as part of resolving the
// thread, and no further AI action is coming for it in this thread, so the line would otherwise
// read "waiting for the AI to pick it up" forever (mirrors threadIsReplying's resolved-thread
// exclusion below, final review Minor #1).
export function deliveryStatus(msgSeq: number, thread: Thread, delivered: number): string | null {
  if (thread.status === 'resolved') return null
  return isUndelivered(msgSeq, thread, delivered) ? SENT : null
}

// isUndelivered is true while the AI has not received a user message yet: past what was
// delivered to the agent and past the AI's last action in the thread. It is deliveryStatus's
// rule. It skips deliveryStatus's resolved-thread exclusion, because `tdm wait` still delivers a
// message that resolved its thread (Choose & resolve), so the muted style clears on its own
// (demo 6 follow-ups 2).
export function isUndelivered(msgSeq: number, item: { lastAiSeq: number }, delivered: number): boolean {
  return msgSeq > delivered && msgSeq > item.lastAiSeq
}

// isReplying is true once the given message has been handed to the agent (msg.seq <= delivered)
// but the AI has not yet acted in this thread since (msg.seq > thread.lastAiSeq). ThreadView uses
// it to show the typing bubble at the end of the timeline (round 3 #6).
export function isReplying(msgSeq: number, item: { lastAiSeq: number }, delivered: number): boolean {
  return msgSeq > item.lastAiSeq && msgSeq <= delivered
}

// threadIsReplying is isReplying applied to the thread's lastUserSeq — not the last user
// *message*'s seq, since a textless action (accepting or editing a conclusion) bumps lastUserSeq
// without adding a message (M2) — gated on the AI not being blocked
// in `tdm wait` (M1): the typing bubble must never show at the same time as the top bar's "AI is
// waiting for you", since that would contradict it — and gated on the thread not being resolved:
// accepting or editing a proposed conclusion resolves the thread and bumps lastUserSeq with no
// AI action following, so without this a resolved thread would show "AI is replying" forever
// (residual round, Important). This mirrors Go's Thread.AwaitingAI (internal/domain/state.go),
// which excludes resolved threads for the same reason. Used both to show the typing bubble
// (ThreadView) and to fold its appearance into follow-bottom's contentKey (SessionPage) — kept in
// one place so the two can't drift out of sync (review round 3, Minor).
export function threadIsReplying(thread: Thread, delivered: number, waiting: boolean): boolean {
  if (waiting || thread.status === 'resolved') return false
  return isReplying(thread.lastUserSeq, thread, delivered)
}

// stageAwaitsSummary is true while an open stage has every thread resolved: the next move is the
// AI's stage summary, after the last thread was resolved or after "Request changes" in older logs (demo2
// follow-up 5). StageView shows the typing bubble for it under threadIsReplying's rules: never
// while the agent is blocked in `tdm wait` (it is idle, not writing), and the quiet state after
// AGENT_QUIET_MS (SessionCtx.quietMinutes).
export function stageAwaitsSummary(stage: Stage, threads: Thread[]): boolean {
  return stage.status === 'open' && threads.length > 0 && threads.every((t) => t.status === 'resolved')
}

// stageAwaitsNextStep is true while the page waits on the AI after the user accepted the last
// stage's summary (stage summary flow, part B): the stage is accepted, no stage follows it, and
// the session is open. StageView then shows "Summary accepted — waiting for the AI's next step…"
// under stageAwaitsSummary's bubble rules (still while the agent sits in tdm wait, the quiet state
// after AGENT_QUIET_MS), and End session.
export function stageAwaitsNextStep(state: State, stage: Stage): boolean {
  return stage.status === 'accepted' && state.stages.at(-1)?.id === stage.id && state.session.status !== 'closed'
}

// stageIsReplying is threadIsReplying for a stage page (stage summary flow spec, part E): the
// user's latest stage message was delivered and the AI has not acted in the stage since (a stage
// message, a summary proposal, a new thread, or the next stage after an accepted one; see
// domain.Stage.AwaitingAI). Never while the agent
// sits in tdm wait.
export function stageIsReplying(stage: Stage, delivered: number, waiting: boolean): boolean {
  if (waiting) return false
  return isReplying(stage.lastUserSeq ?? 0, { lastAiSeq: stage.lastAiSeq ?? 0 }, delivered)
}

// stageDeliveryStatus is deliveryStatus for a message on a stage page. Any stage takes messages,
// so there is no resolved-state exclusion.
export function stageDeliveryStatus(msgSeq: number, stage: Stage, delivered: number): string | null {
  return isUndelivered(msgSeq, { lastAiSeq: stage.lastAiSeq ?? 0 }, delivered) ? SENT : null
}
