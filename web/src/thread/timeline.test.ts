import { describe, expect, it } from 'vitest'
import { fixtureSnapshot } from '../test/session'
import { answerParts, answeredQuestion, choiceTitle, lineCommentsLabel, sentComments, timeline } from './timeline'

describe('timeline', () => {
  it('interleaves blocks and messages by seq', () => {
    const { state } = fixtureSnapshot()
    const items = timeline(state, state.threads.t_1)
    expect(items.map((i) => (i.kind === 'block' ? i.block.id : i.kind === 'message' ? `${i.message.actor}:${i.message.text}` : i.kind === 'process' ? i.process.id : `v${i.version}`))).toEqual([
      'b_1',
      'b_2',
      'ai:Here is the repository layer.',
      'user:Overall fine.',
    ])
  })

  // Demo 6 follow-ups 1: an answer names its question by the question's first line.
  it('finds the question an answer message answers', () => {
    const t2 = fixtureSnapshot().state.threads.t_2
    expect(answeredQuestion(t2, t2.messages[2])).toEqual({ id: 'q_2', title: 'Cache user lookups too?' })
    expect(answeredQuestion(t2, t2.messages[0])).toBeUndefined()
    expect(answeredQuestion({ ...t2, messages: [] }, t2.messages[2])).toEqual({ id: 'q_2', title: 'q_2' })
  })

  // MessageView splits an answer message's text into a muted "Answered" label and an emphasized
  // value, instead of running the two together.
  it('splits an answer message into label and value', () => {
    expect(answerParts('Answered: Yes')).toEqual({ answer: 'Yes', custom: false })
    expect(answerParts('Answered: Yes, add it')).toEqual({ answer: 'Yes, add it', custom: false })
  })

  it('strips the quotes off a custom answer', () => {
    expect(answerParts('Answered: "Only the API part"')).toEqual({ answer: 'Only the API part', custom: true })
  })

  it('is undefined for text without the Answered prefix', () => {
    expect(answerParts('Overall fine.')).toBeUndefined()
    expect(answerParts('')).toBeUndefined()
  })

  // Stage summary flow spec, part D: earlier proposals sit in the timeline at their seq; the newest
  // is the live card and is not listed, unless the thread went back to open.
  it('lists earlier conclusion proposals by seq', () => {
    const { state } = fixtureSnapshot()
    const t2 = {
      ...state.threads.t_2,
      proposalVersion: 2,
      proposals: [
        { text: 'Empty map.', seq: 17 },
        { text: 'Use a lazy delegate for the cache.', seq: 23 },
      ],
    }
    const items = timeline(state, t2)
    expect(items.filter((i) => i.kind === 'proposal')).toEqual([{ kind: 'proposal', seq: 17, version: 1, text: 'Empty map.' }])
    expect(items.map((i) => i.seq)).toEqual([...items.map((i) => i.seq)].sort((a, b) => a - b))
    expect(timeline(state, { ...t2, status: 'open', proposedConclusion: undefined }).filter((i) => i.kind === 'proposal')).toHaveLength(2)
  })

  it('lists the AI\'s newest conclusion as an earlier version once the user edited it, and never twice otherwise', () => {
    const { state } = fixtureSnapshot()
    const t2 = { ...state.threads.t_2, proposalVersion: 1, proposals: [{ text: 'Use a lazy delegate for the cache.', seq: 17 }] }
    const versions = (t: typeof t2) => timeline(state, t).flatMap((i) => (i.kind === 'proposal' ? [`v${i.version}:${i.text}`] : []))
    expect(versions({ ...t2, proposedConclusion: 'Use a lazy delegate.', editedByUser: true })).toEqual(['v1:Use a lazy delegate for the cache.'])
    expect(versions({ ...t2, status: 'resolved', proposedConclusion: undefined, conclusion: 'Use a lazy delegate.' })).toEqual([
      'v1:Use a lazy delegate for the cache.',
    ])
    expect(versions(t2)).toEqual([])
    expect(versions({ ...t2, status: 'resolved', proposedConclusion: undefined, conclusion: 'Use a lazy delegate for the cache.' })).toEqual([])
  })
})

describe('choiceTitle', () => {
  it('names the option a message was sent with', () => {
    const { state } = fixtureSnapshot()
    expect(choiceTitle(state, state.threads.t_2.messages[0])).toBe('Lazy delegate')
    expect(choiceTitle(state, state.threads.t_1.messages[0])).toBeUndefined()
    expect(choiceTitle(state, { actor: 'user', text: '', seq: 99, choice: { blockId: 'b_9', optionId: 'o_9' } })).toBe('o_9')
  })
})

describe('sentComments', () => {
  it('lists the comments sent with a user message (same seq)', () => {
    const { state } = fixtureSnapshot()
    const t1 = state.threads.t_1
    expect(sentComments(t1, t1.messages[1]).map((c) => c.text)).toEqual(['Why not an empty map?', 'Which Db?', 'Which one?'])
    expect(sentComments(t1, t1.messages[0])).toEqual([]) // the AI's message
    expect(sentComments(state.threads.t_2, state.threads.t_2.messages[0])).toEqual([])
  })

  it('labels the count', () => {
    expect(lineCommentsLabel(1)).toBe('1 line comment')
    expect(lineCommentsLabel(2)).toBe('2 line comments')
    expect(lineCommentsLabel(3, true)).toBe('3 comments')
  })
})
