import { describe, expect, it } from 'vitest'
import type { Thread, ThreadStatus } from '../api/types'
import { makeCtx } from '../test/session'
import { newlyResolved } from './useJustResolved'

const threads = (over: Record<string, ThreadStatus>): Record<string, Thread> => {
  const base = makeCtx().state.threads
  return Object.fromEntries(Object.entries(base).map(([id, t]) => [id, { ...t, status: over[id] ?? t.status }]))
}
const statuses = (ts: Record<string, Thread>) => new Map(Object.values(ts).map((t) => [t.id, t.status]))

describe('newlyResolved (resolve feedback 2)', () => {
  it('reports threads that changed to resolved from open or proposed', () => {
    const before = threads({})
    expect(newlyResolved(statuses(before), threads({ t_1: 'resolved', t_2: 'resolved' })).sort()).toEqual(['t_1', 't_2'])
  })

  it('reports nothing on the first render, for unchanged threads, or for a new thread that is already resolved', () => {
    const after = threads({ t_1: 'resolved' })
    expect(newlyResolved(null, after)).toEqual([])
    expect(newlyResolved(statuses(after), after)).toEqual([])
    const prev = statuses(threads({}))
    prev.delete('t_1')
    expect(newlyResolved(prev, after)).toEqual([])
  })
})
