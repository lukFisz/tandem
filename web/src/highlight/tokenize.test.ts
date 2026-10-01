import { describe, expect, it } from 'vitest'
import { loadTokenizer, plainTokenize, splitLines } from './tokenize'

describe('tokenize', () => {
  it('splits lines without inventing a trailing empty line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b'])
    expect(splitLines('')).toEqual([''])
  })

  it('plain tokenizer keeps one token per line', () => {
    expect(plainTokenize('x\n\ny\n', 'text')).toEqual([[{ content: 'x' }], [{ content: '' }], [{ content: 'y' }]])
  })

  it('highlights kotlin keywords with the tdm-ide palette', async () => {
    const tokenize = await loadTokenizer()
    const lines = tokenize('val cache: Map<String, User>? = null\n', 'kotlin')
    expect(lines).toHaveLength(1)
    const val = lines[0].find((t) => t.content.trim() === 'val')
    expect(val?.color?.toLowerCase()).toBe('#cf8e6d')
    expect(lines[0].map((t) => t.content).join('')).toBe('val cache: Map<String, User>? = null')
  })

  it('falls back to plain text for languages it did not load (Review Focus 5)', async () => {
    const tokenize = await loadTokenizer()
    expect(tokenize('fn main() {}\n\n', 'rust')).toEqual([[{ content: 'fn main() {}' }], [{ content: '' }]])
  })
})
