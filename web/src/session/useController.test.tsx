import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiError } from '../api/client'
import type { Snapshot } from '../api/types'
import { fixtureSnapshot } from '../test/session'
import { useController } from './useController'

const { postAction, fetchBlob } = vi.hoisted(() => ({ postAction: vi.fn(), fetchBlob: vi.fn() }))
vi.mock('../api/client', async (orig) => ({
  ...(await orig<typeof import('../api/client')>()),
  postAction: (...a: unknown[]) => postAction(...a),
  fetchBlob: (...a: unknown[]) => fetchBlob(...a),
}))

const comment = (threadId: string, blockId: string, text: string) => ({ threadId, blockId, lines: { start: 14, end: 14 }, text })

function setup(snapshot: Snapshot = fixtureSnapshot()) {
  const notify = vi.fn()
  const hook = renderHook(({ snap }) => useController('s_fixture', snap, notify), { initialProps: { snap: snapshot } })
  return { notify, hook }
}

beforeEach(() => {
  postAction.mockReset()
  fetchBlob.mockReset()
})

describe('useController', () => {
  it('attaches the draft to actions and removes only what was sent (Review Focus 1)', async () => {
    let release!: () => void
    postAction.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const { hook } = setup()
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'sent one')))

    let done!: Promise<boolean>
    act(() => {
      done = hook.result.current.run({ type: 'conclusion.accept', data: { threadId: 't_2' } })
    })
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'added while sending')))
    await act(async () => {
      release()
      expect(await done).toBe(true)
    })

    expect(postAction).toHaveBeenCalledWith('s_fixture', { type: 'conclusion.accept', data: { threadId: 't_2' } }, {
      threads: [{ threadId: 't_1', comments: [{ blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'sent one' }] }],
    })
    expect(hook.result.current.draft.comments.map((c) => c.text)).toEqual(['added while sending'])
  })

  it('keeps the draft and reports the error with its hint when sending fails (Review Focus 1)', async () => {
    postAction.mockRejectedValue(new ApiError(400, 'thread_resolved', 'thread t_1 is resolved', 'add a new thread'))
    const { hook, notify } = setup()
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'keep me')))
    let ok = true
    await act(async () => {
      ok = await hook.result.current.sendReview({ threadId: 't_1', message: 'hi' })
    })
    expect(ok).toBe(false)
    expect(hook.result.current.draft.comments.map((c) => c.text)).toEqual(['keep me'])
    expect(notify).toHaveBeenCalledWith({ kind: 'error', text: 'thread_resolved: thread t_1 is resolved', hint: 'add a new thread' })
  })

  it('sends the draft and a message as one review.submit', async () => {
    postAction.mockResolvedValue(undefined)
    const { hook } = setup()
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'why?')))
    await act(async () => {
      await hook.result.current.sendReview({ threadId: 't_3', message: 'and here' })
    })
    expect(postAction).toHaveBeenCalledWith('s_fixture', {
      type: 'review.submit',
      data: { threads: [
        { threadId: 't_1', comments: [{ blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'why?' }] },
        { threadId: 't_3', message: 'and here' },
      ] },
    })
    expect(hook.result.current.draft.comments).toEqual([])
  })

  it('does nothing when there is nothing to send', async () => {
    const { hook } = setup()
    let ok = true
    await act(async () => {
      ok = await hook.result.current.sendReview()
    })
    expect(ok).toBe(false)
    expect(postAction).not.toHaveBeenCalled()
  })

  it('prunes draft comments whose thread got resolved (Review Focus 2)', () => {
    const { hook } = setup()
    act(() => {
      hook.result.current.addDraft(comment('t_2', 'b_3', 'about to be stale'))
      hook.result.current.addDraft(comment('t_1', 'b_2', 'still fine'))
    })
    const next = fixtureSnapshot()
    next.state.threads.t_2 = { ...next.state.threads.t_2, status: 'resolved' }
    hook.rerender({ snap: next })
    expect(hook.result.current.draft.comments.map((c) => c.text)).toEqual(['still fine'])
  })

  it('is read-only for closed sessions and caches blobs', async () => {
    const closed = fixtureSnapshot()
    closed.state.session.status = 'closed'
    fetchBlob.mockResolvedValue('text')
    const { hook } = setup(closed)
    expect(hook.result.current.readOnly).toBe(true)
    await hook.result.current.loadBlob('abc')
    await hook.result.current.loadBlob('abc')
    expect(fetchBlob).toHaveBeenCalledTimes(1)
    expect(fetchBlob).toHaveBeenCalledWith('s_fixture', 'abc')
  })

  it('excludes already in-flight comments from a second overlapping send', async () => {
    const releases: Array<() => void> = []
    postAction.mockImplementation(() => new Promise<void>((r) => releases.push(r)))
    const { hook } = setup()
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'only one')))

    let first!: Promise<boolean>
    act(() => {
      first = hook.result.current.run({ type: 'conclusion.accept', data: { threadId: 't_2' } })
    })
    let second!: Promise<boolean>
    act(() => {
      second = hook.result.current.run({ type: 'conclusion.accept', data: { threadId: 't_3' } })
    })

    expect(postAction).toHaveBeenNthCalledWith(1, 's_fixture', { type: 'conclusion.accept', data: { threadId: 't_2' } }, {
      threads: [{ threadId: 't_1', comments: [{ blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'only one' }] }],
    })
    // No draft argument: the only comment was already in flight for the first send.
    expect(postAction).toHaveBeenNthCalledWith(2, 's_fixture', { type: 'conclusion.accept', data: { threadId: 't_3' } })

    await act(async () => {
      releases.forEach((r) => r())
      expect(await first).toBe(true)
      expect(await second).toBe(true)
    })
    expect(hook.result.current.draft.comments).toEqual([])
  })

  it('keeps an edit made while its send is still in flight (Review Focus 1)', async () => {
    let release!: () => void
    postAction.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const { hook } = setup()
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'original')))
    const id = hook.result.current.draft.comments[0].id

    let done!: Promise<boolean>
    act(() => {
      done = hook.result.current.run({ type: 'conclusion.accept', data: { threadId: 't_2' } })
    })
    act(() => hook.result.current.updateDraft(id, 'edited while sending'))
    await act(async () => {
      release()
      expect(await done).toBe(true)
    })

    expect(hook.result.current.draft.comments.map((c) => c.text)).toEqual(['edited while sending'])
  })

  it('does not send for a read-only (closed) session', async () => {
    const closed = fixtureSnapshot()
    closed.state.session.status = 'closed'
    const { hook } = setup(closed)
    act(() => hook.result.current.addDraft(comment('t_1', 'b_2', 'never sent')))

    let ok = true
    await act(async () => {
      ok = await hook.result.current.run({ type: 'conclusion.accept', data: { threadId: 't_2' } })
    })
    expect(ok).toBe(false)

    let ok2 = true
    await act(async () => {
      ok2 = await hook.result.current.sendReview({ threadId: 't_1', message: 'hi' })
    })
    expect(ok2).toBe(false)
    expect(postAction).not.toHaveBeenCalled()
  })
})
