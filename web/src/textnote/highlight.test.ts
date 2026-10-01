import { afterEach, describe, expect, it, vi } from 'vitest'
import { paint } from './highlight'

const g = globalThis as Record<string, unknown>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('paint', () => {
  it('is a no-op without the Custom Highlight API', () => {
    expect(() => paint('tdm-note', [document.createRange()])).not.toThrow()
  })

  it('sets and clears a named highlight', () => {
    const highlights = new Map<string, unknown>()
    class Highlight {
      ranges: Range[]
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    vi.stubGlobal('CSS', { ...(g.CSS as object), highlights })
    vi.stubGlobal('Highlight', Highlight)
    const r = document.createRange()
    paint('tdm-note', [r])
    expect((highlights.get('tdm-note') as Highlight).ranges).toEqual([r])
    paint('tdm-note', [])
    expect(highlights.has('tdm-note')).toBe(false)
  })
})
