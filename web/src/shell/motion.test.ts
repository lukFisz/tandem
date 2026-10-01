import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearJumpHighlight, highlightJumpTarget, JUMP_HIGHLIGHT_MS } from './motion'

describe('highlightJumpTarget (demo 6 follow-ups 3)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tints the target for about a second', () => {
    expect(JUMP_HIGHLIGHT_MS).toBe(1000)
    const el = document.createElement('section')
    highlightJumpTarget(el)
    expect(el).toHaveClass('is-jump-target')
    vi.advanceTimersByTime(JUMP_HIGHLIGHT_MS - 1)
    expect(el).toHaveClass('is-jump-target')
    vi.advanceTimersByTime(1)
    expect(el).not.toHaveClass('is-jump-target')
  })

  // Review Focus 1.
  it('plays again on a repeated jump, and the earlier timer does not cut it short', () => {
    const el = document.createElement('section')
    highlightJumpTarget(el)
    vi.advanceTimersByTime(600)
    highlightJumpTarget(el)
    vi.advanceTimersByTime(600) // the first jump's timer would have fired by now
    expect(el).toHaveClass('is-jump-target')
    vi.advanceTimersByTime(JUMP_HIGHLIGHT_MS - 600)
    expect(el).not.toHaveClass('is-jump-target')
  })
})

describe('clearJumpHighlight (demo 6 follow-ups 3 fix round 1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('removes the class immediately and cancels the pending timer', () => {
    const el = document.createElement('section')
    highlightJumpTarget(el)
    expect(el).toHaveClass('is-jump-target')
    clearJumpHighlight(el)
    expect(el).not.toHaveClass('is-jump-target')
    // The cancelled timer must not throw or do anything when it would have fired.
    expect(() => vi.advanceTimersByTime(JUMP_HIGHLIGHT_MS)).not.toThrow()
    expect(el).not.toHaveClass('is-jump-target')
  })

  it('is a no-op on an element with no pending highlight', () => {
    const el = document.createElement('section')
    expect(() => clearJumpHighlight(el)).not.toThrow()
    expect(el).not.toHaveClass('is-jump-target')
  })
})
