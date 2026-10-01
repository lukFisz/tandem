import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { CLOCK_TICK_MS, useNow } from './clock'

afterEach(() => vi.useRealTimers())

describe('useNow', () => {
  it('ticks on its own, without a new snapshot', () => {
    vi.useFakeTimers()
    const start = Date.now()
    const { result } = renderHook(() => useNow())
    expect(result.current).toBe(start)
    act(() => vi.advanceTimersByTime(CLOCK_TICK_MS))
    expect(result.current).toBe(start + CLOCK_TICK_MS)
  })
})
