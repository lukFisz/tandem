import { describe, expect, it } from 'vitest'
import fixture from '../test/fixtures/snapshot.json'
import { normalizeSnapshot } from '../api/types'
import { addComment, countDraft, emptyDraft, loadDraft, removeComments, saveDraft, staleComments, toReview, updateComment } from './draft'

const c1 = { threadId: 't_1', blockId: 'b_2', lines: { start: 13, end: 14 }, text: 'why?' }
const c2 = { threadId: 't_3', blockId: 'b_4', lines: { start: 3, end: 3 }, text: 'clarify' }
const c3 = { threadId: 't_1', blockId: 'b_2', lines: { start: 12, end: 12 }, text: 'naming' }

describe('draft', () => {
  it('adds, updates, removes and counts', () => {
    let d = addComment(addComment(emptyDraft, c1), c2)
    expect(d.comments).toHaveLength(2)
    expect(new Set(d.comments.map((c) => c.id)).size).toBe(2)
    d = updateComment(d, d.comments[0].id, 'why nullable?')
    expect(d.comments[0].text).toBe('why nullable?')
    expect(countDraft(d)).toBe(2)
    expect(countDraft(d, 't_1')).toBe(1)
    d = removeComments(d, [d.comments[0].id])
    expect(d.comments.map((c) => c.text)).toEqual(['clarify'])
  })

  it('builds a review grouped by thread, with an optional message', () => {
    const d = addComment(addComment(addComment(emptyDraft, c1), c2), c3)
    expect(toReview(emptyDraft)).toBeUndefined()
    expect(toReview(d, { threadId: 't_2', message: 'go on' })).toEqual({
      threads: [
        { threadId: 't_1', comments: [{ blockId: 'b_2', lines: { start: 13, end: 14 }, text: 'why?' }, { blockId: 'b_2', lines: { start: 12, end: 12 }, text: 'naming' }] },
        { threadId: 't_3', comments: [{ blockId: 'b_4', lines: { start: 3, end: 3 }, text: 'clarify' }] },
        { threadId: 't_2', message: 'go on' },
      ],
    })
    expect(toReview(emptyDraft, { threadId: 't_1', message: 'hi' })).toEqual({ threads: [{ threadId: 't_1', message: 'hi' }] })
  })

  it('finds comments that can no longer be sent (Review Focus 2)', () => {
    const state = normalizeSnapshot(fixture).state
    state.threads.t_3 = { ...state.threads.t_3, status: 'resolved' }
    const d = addComment(addComment(addComment(emptyDraft, c1), c2), { ...c1, blockId: 'b_99' })
    expect(staleComments(d, state)).toEqual([d.comments[1].id, d.comments[2].id])
  })

  it('persists per session and survives corrupt storage (Review Focus 1)', () => {
    const d = addComment(emptyDraft, c1)
    saveDraft('s_a', d)
    expect(loadDraft('s_a')).toEqual(d)
    expect(loadDraft('s_b')).toEqual(emptyDraft)
    localStorage.setItem('tdm:draft:s_c', '{not json')
    expect(loadDraft('s_c')).toEqual(emptyDraft)
  })

  it('sends quotes and message comments, and keeps a quote-less comment as before', () => {
    const quoted = { ...c3, quote: 'class Repo(' }
    const onMessage = { threadId: 't_1', messageSeq: 7, quote: 'repository layer', text: 'which?' }
    const d = addComment(addComment(addComment(emptyDraft, c1), quoted), onMessage)
    expect(toReview(d)).toEqual({
      threads: [
        {
          threadId: 't_1',
          comments: [
            { blockId: 'b_2', lines: { start: 13, end: 14 }, text: 'why?' },
            { blockId: 'b_2', lines: { start: 12, end: 12 }, quote: 'class Repo(', text: 'naming' },
          ],
          messageComments: [{ messageSeq: 7, quote: 'repository layer', text: 'which?' }],
        },
      ],
    })
    expect(toReview(addComment(emptyDraft, onMessage), { threadId: 't_1', message: 'hi' })).toEqual({
      threads: [{ threadId: 't_1', messageComments: [{ messageSeq: 7, quote: 'repository layer', text: 'which?' }], message: 'hi' }],
    })
  })

  it('drops a message comment whose message or thread is gone', () => {
    const state = normalizeSnapshot(fixture).state
    const ok = { threadId: 't_1', messageSeq: 7, quote: 'repository layer', text: 'which?' }
    const d = addComment(addComment(emptyDraft, ok), { ...ok, messageSeq: 999 })
    expect(staleComments(d, state)).toEqual([d.comments[1].id])
  })

  it('round-trips quoted and message comments through storage', () => {
    const d = addComment(addComment(emptyDraft, { ...c1, quote: 'x' }), { threadId: 't_1', messageSeq: 7, quote: 'y', text: 'z' })
    saveDraft('s_q', d)
    expect(loadDraft('s_q')).toEqual(d)
  })
})
