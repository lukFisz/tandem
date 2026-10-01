import { describe, expect, it } from 'vitest'
import fixture from '../test/fixtures/snapshot.json'
import { awaitingAI, normalizeSnapshot, openQuestion } from './types'

describe('normalizeSnapshot', () => {
  it('reads the contract fixture', () => {
    const s = normalizeSnapshot(fixture)
    expect(s.waiting).toBe(false)
    expect(s.state.session).toEqual({ id: 's_fixture', title: 'Implement idea ABC', projectId: 'p_fixture', status: 'active' })
    expect(s.state.stages.map((st) => st.id)).toEqual(['st_1', 'st_2'])
    expect(s.state.blocks.b_2).toMatchObject({ type: 'file', path: 'src/Repo.kt', lang: 'kotlin', firstLine: 12, lineCount: 4 })
    expect(s.state.blocks.b_5.supersededBy).toBe('b_6')
    expect(s.state.threads.t_2.status).toBe('conclusion_proposed')
  })

  it('passes processOutput through and defaults it to {}', () => {
    expect(normalizeSnapshot(fixture).processOutput).toEqual({})
    const s = normalizeSnapshot({ ...structuredClone(fixture), processOutput: { p_1: 'a\nb' } })
    expect(s.processOutput).toEqual({ p_1: 'a\nb' })
  })

  it('turns Go nulls into empty arrays', () => {
    const s = normalizeSnapshot({
      waiting: true,
      state: {
        session: { id: 's_x', title: 'x', projectId: 'p', status: 'active' },
        stages: [{ id: 'st_1', title: 'A', status: 'open', threadIds: null }],
        threads: { t_1: { id: 't_1', stageId: 'st_1', title: 'T', status: 'open', blockIds: null, messages: null, comments: null, lastUserSeq: 0, lastAiSeq: 3 } },
        blocks: { b_1: { id: 'b_1', threadId: 't_1', seq: 4, type: 'note', text: 'n' } },
        lastSeq: 4, lastAiSeq: 4, delivered: 0, endRequested: false,
      },
    })
    expect(s.state.stages[0].threadIds).toEqual([])
    expect(s.state.threads.t_1).toMatchObject({ blockIds: [], messages: [], comments: [] })
    expect(s.state.blocks.b_1.annotations).toEqual([])
  })

  it('handles a session without stages', () => {
    const s = normalizeSnapshot({ waiting: false, state: { session: { id: 's', title: 't', projectId: 'p', status: 'active' }, stages: null, threads: {}, blocks: {}, lastSeq: 1, lastAiSeq: 1, delivered: 0, endRequested: false } })
    expect(s.state.stages).toEqual([])
  })

  it('keeps the variant choice a user message was sent with', () => {
    const s = normalizeSnapshot(fixture)
    expect(s.state.threads.t_2.messages[0]).toEqual({ actor: 'user', text: 'Simpler.', seq: 16, choice: { blockId: 'b_3', optionId: 'o_2' } })
  })

  it('reads agentSeenAt only when the daemon has seen the agent', () => {
    expect(normalizeSnapshot(fixture).agentSeenAt).toBeUndefined()
    expect(normalizeSnapshot({ ...structuredClone(fixture), agentSeenAt: 1790000000000 }).agentSeenAt).toBe(1790000000000)
    expect(normalizeSnapshot({ ...structuredClone(fixture), agentSeenAt: 'soon' }).agentSeenAt).toBeUndefined()
  })

  // Stage summary flow spec, part D: the proposal history in the contract fixture.
  it('reads proposal versions', () => {
    const t2 = normalizeSnapshot(fixture).state.threads.t_2
    expect(t2.proposalVersion).toBe(1)
    expect(t2.proposals).toEqual([{ text: 'Use a lazy delegate for the cache.', seq: 17 }])
  })

  // Stage summary flow spec, part E: the stage conversation in the contract fixture.
  it('reads a stage conversation', () => {
    const st2 = normalizeSnapshot(fixture).state.stages[1]
    expect(st2.messages).toEqual([
      { actor: 'ai', text: 'Next we pick the API style.', seq: 23 },
      { actor: 'user', text: 'REST, please.', seq: 24 },
    ])
    expect(st2).toMatchObject({ lastUserSeq: 24, lastAiSeq: 23 })
  })
})

describe('awaitingAI', () => {
  it('follows the backend rule', () => {
    const s = normalizeSnapshot(fixture)
    expect(awaitingAI(s.state.threads.t_1)).toBe(true) // user reviewed after the AI's last message
    expect(awaitingAI(s.state.threads.t_3)).toBe(false)
  })
})

describe('question messages (question message spec)', () => {
  it('reads the question from the contract fixture', () => {
    const t3 = normalizeSnapshot(fixture).state.threads.t_3
    expect(t3.messages[0]).toEqual({
      actor: 'ai',
      text: 'Should the docs cover the blob layout?',
      seq: 18,
      question: { id: 'q_1', options: [{ id: 'o_3', title: 'Yes' }, { id: 'o_4', title: 'No' }], withdrawn: true },
    })
  })

  it('finds the latest question that is neither answered nor withdrawn', () => {
    const t3 = normalizeSnapshot(fixture).state.threads.t_3
    expect(openQuestion(t3)).toBeUndefined() // the fixture's q_1 is withdrawn
    const asked = t3.messages[0]
    const open = { id: 'q_1', options: asked.question!.options }
    const second = { actor: 'ai' as const, text: 'Second?', seq: 20, question: { id: 'q_2', options: open.options } }
    expect(openQuestion({ ...t3, messages: [{ ...asked, question: open }] })?.id).toBe('q_1')
    expect(openQuestion({ ...t3, messages: [{ ...asked, question: open }, second] })?.id).toBe('q_2')
    expect(openQuestion({ ...t3, messages: [{ ...asked, question: { ...open, answer: { optionId: 'o_3' } } }] })).toBeUndefined()
  })

  it('links the answer message to its question (demo 6 follow-ups 1)', () => {
    const t2 = normalizeSnapshot(fixture).state.threads.t_2
    expect(t2.messages[1].question?.id).toBe('q_2')
    expect(t2.messages[2]).toEqual({ actor: 'user', text: 'Answered: Yes', seq: 21, answerTo: 'q_2' })
  })
})
