import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDraft } from './useDraft'
import { addComment, emptyDraft, loadDraft, saveDraft } from './draft'

describe('useDraft', () => {
  it('keeps the draft across remounts (page reload)', () => {
    const first = renderHook(() => useDraft('s_x'))
    act(() => first.result.current.add({ threadId: 't_1', blockId: 'b_1', lines: { start: 1, end: 1 }, text: 'keep me' }))
    first.unmount()
    const second = renderHook(() => useDraft('s_x'))
    expect(second.result.current.draft.comments.map((c) => c.text)).toEqual(['keep me'])
    const id = second.result.current.draft.comments[0].id
    act(() => second.result.current.update(id, 'edited'))
    expect(second.result.current.draft.comments[0].text).toBe('edited')
    act(() => second.result.current.removeMany([id]))
    expect(second.result.current.draft.comments).toEqual([])
  })

  it('reloads and re-scopes when sid changes on a live instance', () => {
    const bDraft = addComment(emptyDraft, { threadId: 't_9', blockId: 'b_9', lines: { start: 5, end: 5 }, text: 'b comment' })
    saveDraft('s_b', bDraft)

    const { result, rerender } = renderHook(({ sid }) => useDraft(sid), { initialProps: { sid: 's_a' } })
    act(() => result.current.add({ threadId: 't_1', blockId: 'b_1', lines: { start: 1, end: 1 }, text: 'a comment' }))
    expect(result.current.draft.comments.map((c) => c.text)).toEqual(['a comment'])

    rerender({ sid: 's_b' })

    expect(result.current.draft.comments.map((c) => c.text)).toEqual(['b comment'])
    expect(loadDraft('s_b').comments.map((c) => c.text)).toEqual(['b comment'])
    expect(loadDraft('s_a').comments.map((c) => c.text)).toEqual(['a comment'])
  })
})
