import { describe, expect, it } from 'vitest'
import type { Stage, Thread } from '../api/types'
import { fixtureSnapshot } from '../test/session'
import {
  deliveryStatus,
  isReplying,
  isUndelivered,
  stageAwaitsNextStep,
  stageAwaitsSummary,
  stageDeliveryStatus,
  stageIsReplying,
  threadIsReplying,
} from './delivery'

const thread: Thread = {
  id: 't_1',
  stageId: 'st_1',
  title: 'Repository layer',
  status: 'open',
  blockIds: [],
  messages: [],
  comments: [],
  messageComments: [],
  lastUserSeq: 15,
  lastAiSeq: 7,
}

describe('deliveryStatus', () => {
  it('returns null once the AI has acted after the message', () => {
    expect(deliveryStatus(7, thread, 0)).toBeNull()
    expect(deliveryStatus(5, thread, 0)).toBeNull()
  })

  it('says the message is waiting to be picked up when not yet delivered', () => {
    expect(deliveryStatus(15, thread, 0)).toBe('Sent · waiting for the AI to pick it up')
    expect(deliveryStatus(8, thread, 7)).toBe('Sent · waiting for the AI to pick it up')
  })

  it('shows no status line once the message has been delivered — the typing bubble takes over (round 3)', () => {
    expect(deliveryStatus(15, thread, 15)).toBeNull()
    expect(deliveryStatus(8, thread, 10)).toBeNull()
  })

  // Final review Minor #1: Choose & resolve adds a user message as part of resolving the
  // thread, so without this a resolved thread would show "Sent · waiting for the AI to pick it
  // up" forever, since no AI action is coming for it in this thread.
  it('shows no status line for a resolved thread, even when the message was never delivered', () => {
    const resolved: Thread = { ...thread, status: 'resolved' }
    expect(deliveryStatus(15, resolved, 0)).toBeNull()
  })
})

describe('isReplying', () => {
  it('is false once the AI has acted after the message', () => {
    expect(isReplying(7, thread, 0)).toBe(false)
    expect(isReplying(5, thread, 0)).toBe(false)
  })

  it('is false once the AI has acted, even once the message has also been delivered (review round 3, Important)', () => {
    // Every other "AI acted" case above uses delivered: 0, so a mutant that dropped the
    // lastAiSeq check entirely (`return msgSeq <= delivered`) would still pass them. Here
    // delivered (20) also covers msgSeq (7), so only the lastAiSeq check can make this false.
    expect(isReplying(7, thread, 20)).toBe(false)
  })

  it('is false while the message is still waiting to be delivered', () => {
    expect(isReplying(15, thread, 0)).toBe(false)
    expect(isReplying(8, thread, 7)).toBe(false)
  })

  it('is true once the message has been delivered and the AI has not yet acted', () => {
    expect(isReplying(15, thread, 15)).toBe(true)
    expect(isReplying(8, thread, 10)).toBe(true)
  })
})

describe('threadIsReplying', () => {
  // M1: the typing bubble must never contradict the top bar's "AI is waiting for you" — that
  // happens while the AI is blocked in `tdm wait`, which is a distinct state from the AI still
  // being busy on the message the user just sent.
  it('is false while the AI is waiting for the user, even if the thread would otherwise look like it is replying', () => {
    expect(threadIsReplying(thread, thread.lastUserSeq, true)).toBe(false)
  })

  it('is true once delivered and the AI has not yet acted, when the AI is not waiting', () => {
    expect(threadIsReplying(thread, thread.lastUserSeq, false)).toBe(true)
  })

  it('is false once the AI has acted after the last user message', () => {
    expect(threadIsReplying({ ...thread, lastAiSeq: thread.lastUserSeq }, thread.lastUserSeq, false)).toBe(false)
  })

  it('is false while the last user action has not yet been delivered', () => {
    expect(threadIsReplying(thread, thread.lastUserSeq - 1, false)).toBe(false)
  })

  // M2: an action without text (a draft-only send, a variant choice without a comment) bumps
  // thread.lastUserSeq without adding a message, so the bubble must key off lastUserSeq, not off
  // the seq of the last user *message*.
  it('is true after a textless action bumps lastUserSeq past the last message', () => {
    const noMessageThread: Thread = { ...thread, messages: [], lastUserSeq: 20, lastAiSeq: 7 }
    expect(threadIsReplying(noMessageThread, 20, false)).toBe(true)
  })

  // Residual round, Important (regression introduced by M1/M2): accepting or editing a proposed
  // conclusion resolves the thread and bumps lastUserSeq (internal/domain/reducer.go:124,134,
  // 233-235) with no AI action following — Go's AwaitingAI (internal/domain/state.go:65-67)
  // already excludes resolved threads for exactly this reason. Without the same check here,
  // every thread the user just resolved would show "AI is replying" until the AI does something
  // else, unrelated, elsewhere.
  it('is false for a resolved thread, even with lastUserSeq > lastAiSeq and delivered covering it', () => {
    const resolved: Thread = { ...thread, status: 'resolved', lastUserSeq: 15, lastAiSeq: 7 }
    expect(threadIsReplying(resolved, 15, false)).toBe(false)
  })
})

describe('stageAwaitsSummary (demo2 follow-up 5)', () => {
  const stage: Stage = { id: 'st_1', title: 'Data model', status: 'open', threadIds: ['t_1', 't_2'] }
  const resolved: Thread = { ...thread, status: 'resolved' }

  it('is true while an open stage has every thread resolved', () => {
    expect(stageAwaitsSummary(stage, [resolved, { ...resolved, id: 't_2' }])).toBe(true)
  })

  it('is false with an unresolved thread, no threads, or a summary proposed or accepted', () => {
    expect(stageAwaitsSummary(stage, [resolved, thread])).toBe(false)
    expect(stageAwaitsSummary({ ...stage, threadIds: [] }, [])).toBe(false)
    expect(stageAwaitsSummary({ ...stage, status: 'summary_proposed' }, [resolved])).toBe(false)
    expect(stageAwaitsSummary({ ...stage, status: 'accepted' }, [resolved])).toBe(false)
  })
})

// Demo 6 follow-ups 2: the same rule as deliveryStatus's "Sent · waiting…", without the
// resolved-thread exclusion: delivery still advances on a resolved thread (Review Focus 4).
describe('isUndelivered', () => {
  it('is true only past both what was delivered and the AI’s last action', () => {
    expect(isUndelivered(15, thread, 0)).toBe(true)
    expect(isUndelivered(8, thread, 7)).toBe(true)
    expect(isUndelivered(15, thread, 15)).toBe(false)
    expect(isUndelivered(7, thread, 0)).toBe(false)
    expect(isUndelivered(5, thread, 0)).toBe(false)
  })

  it('holds on a resolved thread too', () => {
    const resolved: Thread = { ...thread, status: 'resolved' }
    expect(isUndelivered(15, resolved, 0)).toBe(true)
  })
})

describe('stageAwaitsNextStep (stage summary flow, part B)', () => {
  const { state } = fixtureSnapshot() // st_1 (open), st_2 (open, the last stage)
  const acceptedLast: Stage = { ...state.stages[1], status: 'accepted', summary: 'Done.' }

  it('is true for the accepted last stage of an open session', () => {
    expect(stageAwaitsNextStep({ ...state, stages: [state.stages[0], acceptedLast] }, acceptedLast)).toBe(true)
  })

  it('is false for an earlier stage, a last stage not yet accepted, or a closed session', () => {
    const acceptedFirst: Stage = { ...state.stages[0], status: 'accepted', summary: 'Done.' }
    expect(stageAwaitsNextStep({ ...state, stages: [acceptedFirst, state.stages[1]] }, acceptedFirst)).toBe(false)
    expect(stageAwaitsNextStep(state, state.stages[1])).toBe(false)
    const closed = { ...state, session: { ...state.session, status: 'closed' as const }, stages: [state.stages[0], acceptedLast] }
    expect(stageAwaitsNextStep(closed, acceptedLast)).toBe(false)
  })
})

// Stage summary flow spec, part E, Review Focus 2: the stage's own seqs decide.
describe('stage conversation', () => {
  const stage: Stage = { id: 'st_1', title: 'Data model', status: 'summary_proposed', threadIds: [], lastUserSeq: 31, lastAiSeq: 30 }

  it('is replying once the stage message was delivered, never while the agent waits in tdm wait', () => {
    expect(stageIsReplying(stage, 30, false)).toBe(false) // not delivered yet
    expect(stageIsReplying(stage, 31, false)).toBe(true)
    expect(stageIsReplying(stage, 31, true)).toBe(false)
    expect(stageIsReplying({ ...stage, lastAiSeq: 32 }, 32, false)).toBe(false) // the AI answered
    expect(stageIsReplying({ id: 'st_2', title: 'API', status: 'open', threadIds: [] }, 40, false)).toBe(false)
  })

  it('stops replying on an accepted stage once the AI adds the next stage (the reducer bumps its lastAiSeq)', () => {
    const accepted: Stage = { ...stage, status: 'accepted', summary: 'Done.', proposedSummary: undefined }
    expect(stageIsReplying(accepted, 31, false)).toBe(true)
    // stage.created seq 32 answers the message: domain sets the accepted stage's lastAiSeq to 32.
    expect(stageIsReplying({ ...accepted, lastAiSeq: 32 }, 33, false)).toBe(false)
    expect(stageDeliveryStatus(31, { ...accepted, lastAiSeq: 32 }, 0)).toBeNull()
  })

  it('says a stage message is sent until the AI picks it up', () => {
    expect(stageDeliveryStatus(31, stage, 0)).toBe('Sent · waiting for the AI to pick it up')
    expect(stageDeliveryStatus(31, stage, 31)).toBeNull()
    expect(stageDeliveryStatus(31, { ...stage, lastAiSeq: 31 }, 0)).toBeNull()
  })
})
