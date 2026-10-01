import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import fixture from '../test/fixtures/snapshot.json'
import { FakeEventSource } from '../test/fakeEventSource'
import { useSession } from './useSession'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => vi.unstubAllGlobals())

describe('useSession', () => {
  it('follows snapshots and connection state (Review Focus 3)', () => {
    const { result, unmount } = renderHook(() => useSession('s_fixture'))
    const es = FakeEventSource.instances.at(-1)!
    expect(es.url).toBe('/api/sessions/s_fixture/stream')
    expect(result.current).toEqual({ snapshot: null, connection: 'connecting' })

    act(() => es.emit('state', JSON.stringify(fixture)))
    expect(result.current.connection).toBe('open')
    expect(result.current.snapshot?.state.session.title).toBe('Implement idea ABC')

    act(() => es.fail(false)) // daemon restarting: EventSource retries by itself
    expect(result.current.connection).toBe('connecting')
    expect(result.current.snapshot).not.toBeNull() // keep showing the last state

    act(() => es.emit('state', JSON.stringify({ ...fixture, waiting: true })))
    expect(result.current).toMatchObject({ connection: 'open', snapshot: { waiting: true } })

    act(() => es.fail(true)) // closed for good (e.g. 401/404)
    expect(result.current.connection).toBe('lost')

    unmount()
    expect(es.readyState).toBe(FakeEventSource.CLOSED)
  })
})
