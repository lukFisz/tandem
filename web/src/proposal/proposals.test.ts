import { describe, expect, it } from 'vitest'
import { earlierProposals, hasMore, previewOf } from './proposals'

describe('previewOf (stage summary flow spec, part D)', () => {
  it('is the first sentence of the first paragraph, as plain text', () => {
    expect(previewOf('Use a lazy delegate for the cache. It is built on first use.')).toBe('Use a lazy delegate for the cache.')
    expect(previewOf('## Summary\n\nWe keep **JSONL** logs. Blobs by hash.')).toBe('We keep JSONL logs.')
    expect(previewOf('- Keep `v0` logs, see t_2.\n- Export')).toBe('Keep v0 logs, see t_2.')
    expect(previewOf('Version 1.2 is out')).toBe('Version 1.2 is out')
    expect(previewOf('## Only a heading')).toBe('Only a heading')
    expect(previewOf('')).toBe('')
  })
})

describe('hasMore (demo 7 follow-ups 1)', () => {
  it('is true when the full text holds more than the preview', () => {
    expect(hasMore('Use a lazy delegate for the cache. It is built on first use.')).toBe(true)
    expect(hasMore('One sentence.\n\nA second paragraph.')).toBe(true)
    expect(hasMore('## Summary\n\nWe keep logs.')).toBe(true)
    expect(hasMore('- Keep logs.\n- Export')).toBe(true)
  })

  it('is false when the preview is the whole text', () => {
    expect(hasMore('Use a lazy delegate for the cache.')).toBe(false)
    expect(hasMore('  Version 1.2 is out  \n')).toBe(false)
    expect(hasMore('We keep **JSONL** logs.')).toBe(false)
    expect(hasMore('## Only a heading')).toBe(false)
    expect(hasMore('')).toBe(false)
  })
})

describe('earlierProposals', () => {
  const proposals = [
    { text: 'v1', seq: 17 },
    { text: 'v2', seq: 23 },
  ]
  it('numbers the proposals and leaves out the newest while the card (or the accepted text) shows it', () => {
    expect(earlierProposals(proposals, 'v2')).toEqual([{ version: 1, seq: 17, text: 'v1' }])
    expect(earlierProposals(proposals, undefined)).toEqual([
      { version: 1, seq: 17, text: 'v1' },
      { version: 2, seq: 23, text: 'v2' },
    ])
    expect(earlierProposals(undefined, 'v2')).toEqual([])
  })

  // Final review fix: whether the newest is shown is decided by text, not status. A proposal the
  // user edited (or an edited accept) shows another text, so the AI's newest version is listed.
  it('lists the newest when the shown text is not the AI\'s newest proposal', () => {
    expect(earlierProposals(proposals, 'v2, edited by the user')).toEqual([
      { version: 1, seq: 17, text: 'v1' },
      { version: 2, seq: 23, text: 'v2' },
    ])
  })
})
