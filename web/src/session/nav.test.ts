import { describe, expect, it } from 'vitest'
import { fixtureSnapshot, withStageQuestion } from '../test/session'
import { anchorOf, defaultItem, isValidItem, navOrder, nextAfterResolve, nextAfterStageAccept, statusIcon, useCurrentItem } from './nav'
import type { Stage } from '../api/types'
import { act, renderHook } from '@testing-library/react'

describe('nav', () => {
  it('orders stages and threads', () => {
    expect(navOrder(fixtureSnapshot().state)).toEqual(['st_1', 't_1', 't_2', 't_3', 'st_2'])
  })

  it('validates ids', () => {
    const { state } = fixtureSnapshot()
    expect(isValidItem(state, 't_2')).toBe(true)
    expect(isValidItem(state, 'st_2')).toBe(true)
    expect(isValidItem(state, 't_9')).toBe(false)
    expect(isValidItem(state, '')).toBe(false)
  })

  it('opens the first unresolved thread in stage/thread order (feature review t_5)', () => {
    const { state } = fixtureSnapshot()
    const resolve = (id: string) => (state.threads[id] = { ...state.threads[id], status: 'resolved' })
    expect(defaultItem(state)).toBe('t_1') // open, and ahead of t_2's proposed conclusion
    resolve('t_1')
    expect(defaultItem(state)).toBe('t_2') // a proposed conclusion is still unresolved
    resolve('t_2')
    expect(defaultItem(state)).toBe('t_3')
    resolve('t_3')
    expect(defaultItem(state)).toBe('st_2') // everything resolved, no summary to review: last stage
    state.stages[0] = { ...state.stages[0], status: 'summary_proposed' }
    expect(defaultItem(state)).toBe('st_1') // everything resolved: the summary awaiting the user
    expect(defaultItem({ ...state, stages: [] })).toBe('')
  })

  it("does not let a later thread's proposed conclusion jump ahead", () => {
    const { state } = fixtureSnapshot()
    state.stages[1] = { ...state.stages[1], threadIds: ['t_9'] }
    state.threads.t_9 = { ...state.threads.t_2, id: 't_9', stageId: 'st_2' }
    expect(defaultItem(state)).toBe('t_1')
  })

  it('advances to the next unresolved thread after resolving one, wrapping and falling back to the stage (F12b-4)', () => {
    const { state } = fixtureSnapshot()
    expect(nextAfterResolve(state, 't_2')).toBe('t_3')
    expect(nextAfterResolve(state, 't_3')).toBe('t_1')

    const allResolved = {
      ...state,
      threads: {
        ...state.threads,
        t_1: { ...state.threads.t_1, status: 'resolved' as const },
        t_2: { ...state.threads.t_2, status: 'resolved' as const },
      },
    }
    expect(nextAfterResolve(allResolved, 't_3')).toBe('st_1')
  })

  it('after a stage is accepted, opens the next stage: its first unresolved thread, else its page (stage summary flow B)', () => {
    const { state } = fixtureSnapshot()
    expect(nextAfterStageAccept(state, 'st_1')).toBe('st_2') // st_2 has no threads yet
    expect(nextAfterStageAccept(state, 'st_2')).toBeNull() // the last stage
    expect(nextAfterStageAccept(state, 'st_9')).toBeNull()

    const setup: Stage = { id: 'st_0', title: 'Setup', status: 'accepted', threadIds: [] }
    const withSetup = { ...state, stages: [setup, ...state.stages] }
    expect(nextAfterStageAccept(withSetup, 'st_0')).toBe('t_1')
    const t1Resolved = { ...withSetup, threads: { ...state.threads, t_1: { ...state.threads.t_1, status: 'resolved' as const } } }
    expect(nextAfterStageAccept(t1Resolved, 'st_0')).toBe('t_2')
    const allResolved = {
      ...t1Resolved,
      threads: {
        ...t1Resolved.threads,
        t_2: { ...state.threads.t_2, status: 'resolved' as const },
        t_3: { ...state.threads.t_3, status: 'resolved' as const },
      },
    }
    expect(nextAfterStageAccept(allResolved, 'st_0')).toBe('st_1')
  })

  it('maps status to icons', () => {
    const { state } = fixtureSnapshot()
    expect(statusIcon(state.threads.t_1)).toBe('○')
    expect(statusIcon(state.threads.t_2)).toBe('◆')
    expect(statusIcon({ ...state.threads.t_1, status: 'resolved' })).toBe('✓')
  })

  it('pins the shown item so a later default change does not move the view', () => {
    const { state } = fixtureSnapshot()
    const { result, rerender } = renderHook(({ state }) => useCurrentItem(state), { initialProps: { state } })
    expect(result.current[0]).toBe('t_1') // default: the first unresolved thread
    expect(window.location.hash).toBe('#t_1')

    const next = { ...state, threads: { ...state.threads, t_1: { ...state.threads.t_1, status: 'resolved' as const } } }
    rerender({ state: next })
    expect(result.current[0]).toBe('t_1')
    expect(window.location.hash).toBe('#t_1')
  })

  // Question message spec, part A: an option id opens its thread and scrolls to the option.
  it('maps an option id to its thread and card', () => {
    const { state } = fixtureSnapshot()
    expect(anchorOf(state, 'o_2')).toEqual({ itemId: 't_2', selector: '[data-option="o_2"]' })
    expect(anchorOf(state, 'o_9')).toBeUndefined()
    expect(anchorOf(state, 't_1')).toBeUndefined()
    expect(anchorOf(state, '')).toBeUndefined()
  })

  it('maps a block id to its thread and element, a superseded one to its collapsed row', () => {
    const { state } = fixtureSnapshot()
    expect(anchorOf(state, 'b_2')).toEqual({ itemId: 't_1', selector: '[id="b_2"]' })
    expect(anchorOf(state, 'b_6')).toEqual({ itemId: 't_3', selector: '[id="b_6"]' })
    expect(anchorOf(state, 'b_5')).toEqual({ itemId: 't_3', selector: '[data-superseded="b_5"]' })
    expect(anchorOf(state, 'b_99')).toBeUndefined()
  })

  it('maps a process id to its thread and card', () => {
    const { state } = fixtureSnapshot()
    const withProc = {
      ...state,
      processes: { p_1: { id: 'p_1', threadId: 't_2', pid: 9, cmd: 'go test ./...', status: 'running' as const, seq: 50, startedAt: 0 } },
    }
    expect(anchorOf(withProc, 'p_1')).toEqual({ itemId: 't_2', selector: '[id="p_1"]' })
    expect(anchorOf(withProc, 'p_9')).toBeUndefined()
  })

  it('opens the thread of an option hash, pins the thread id and asks to scroll, on every visit', () => {
    const { state } = fixtureSnapshot()
    window.location.hash = '#o_1'
    const { result } = renderHook(() => useCurrentItem(state))
    expect(result.current[0]).toBe('t_2')
    expect(window.location.hash).toBe('#t_2')
    const first = result.current[2]
    expect(first).toEqual({ selector: '[data-option="o_1"]' })

    // A second click on the same chip scrolls again: a new request object.
    act(() => {
      window.location.hash = '#o_1'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current[0]).toBe('t_2')
    expect(window.location.hash).toBe('#t_2')
    expect(result.current[2]).toEqual({ selector: '[data-option="o_1"]' })
    expect(result.current[2]).not.toBe(first)
  })

  it('treats an unknown option id like any unknown hash', () => {
    const { state } = fixtureSnapshot()
    window.location.hash = '#o_9'
    const { result } = renderHook(() => useCurrentItem(state))
    expect(result.current[0]).toBe('t_1')
    expect(window.location.hash).toBe('#t_1')
    expect(result.current[2]).toBeNull()
  })

  it('maps a question and its options to the question bubble (question message spec)', () => {
    const { state } = fixtureSnapshot()
    const bubble = { itemId: 't_3', selector: '[data-question="q_1"]' }
    expect(anchorOf(state, 'q_1')).toEqual(bubble)
    expect(anchorOf(state, 'o_3')).toEqual(bubble)
    expect(anchorOf(state, 'o_4')).toEqual(bubble)
    expect(anchorOf(state, 'q_9')).toBeUndefined()
  })

  // Demo 7 follow-ups 6: a stage question (and its options) opens its stage page.
  it('maps a stage question and its options to the stage and the question bubble', () => {
    const state = withStageQuestion(fixtureSnapshot().state)
    const bubble = { itemId: 'st_1', selector: '[data-question="q_3"]' }
    expect(anchorOf(state, 'q_3')).toEqual(bubble)
    expect(anchorOf(state, 'o_7')).toEqual(bubble)
    window.location.hash = '#q_3'
    const { result } = renderHook(() => useCurrentItem(state))
    expect(result.current[0]).toBe('st_1')
    expect(window.location.hash).toBe('#st_1')
    expect(result.current[2]).toEqual({ selector: '[data-question="q_3"]' })
  })
})
