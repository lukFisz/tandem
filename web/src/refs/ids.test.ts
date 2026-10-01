import { describe, expect, it } from 'vitest'
import { fixtureSnapshot, withQuestion, withStageQuestion } from '../test/session'
import type { Block } from '../api/types'
import { blockTitle, splitIds, titlesOf } from './ids'

const titles: Record<string, string> = {
  t_1: 'Repository layer',
  t_2: 'Cache strategy',
  st_1: 'Data model',
  o_2: 'Lazy delegate',
  q_1: 'Keep old logs?',
  p_1: 'go test ./internal/domain',
}
const titleOf = (id: string) => titles[id]

describe('splitIds (demo2 follow-up 4)', () => {
  it('turns known thread and stage ids into refs', () => {
    expect(splitIds('See t_2 and st_1.', titleOf)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'ref', id: 't_2', title: 'Cache strategy' },
      { kind: 'text', text: ' and ' },
      { kind: 'ref', id: 'st_1', title: 'Data model' },
      { kind: 'text', text: '.' },
    ])
  })

  // Question message spec, part A: option ids are chips too, with the same word rules.
  it('turns known option ids into refs, and leaves unknown or partial ones as text', () => {
    expect(splitIds('Went with o_2.', titleOf)).toEqual([
      { kind: 'text', text: 'Went with ' },
      { kind: 'ref', id: 'o_2', title: 'Lazy delegate' },
      { kind: 'text', text: '.' },
    ])
    for (const text of ['o_2x', 'xo_2', 'o_9', 'see `o_2`', 'foo_2']) {
      expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
    }
  })

  it('turns known process ids into refs', () => {
    expect(splitIds('see p_1.', titleOf)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'ref', id: 'p_1', title: 'go test ./internal/domain' },
      { kind: 'text', text: '.' },
    ])
  })

  it('finds ids at the edges and next to punctuation', () => {
    expect(splitIds('t_1', titleOf)).toEqual([{ kind: 'ref', id: 't_1', title: 'Repository layer' }])
    expect(splitIds('(t_1, t_2)', titleOf).flatMap((s) => (s.kind === 'ref' ? [s.id] : []))).toEqual(['t_1', 't_2'])
  })

  // Review Focus 2: only whole-word, known ids outside code spans.
  it('leaves ids inside words, unknown ids and ids in code spans as text', () => {
    for (const text of ['st_1x', 'xt_1', 'at_1', 't_1_2', 't_12', 'b_9', 'b_1x', 'xb_1', 'st_9', 'use `t_1` here', '``st_1``']) {
      expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
    }
  })

  // Fix round 1: an id in a URL, a file name or a hyphenated word stays text, in both render paths.
  it('leaves ids in URLs, file names and hyphenated words as text', () => {
    for (const text of [
      'https://example.com/t_1',
      'see https://example.com/?id=t_1 now',
      'example.com/t_1',
      'see t_1.md',
      'a t_1-b',
      'a b-t_1',
      'x.t_1',
      't_1/notes',
    ]) {
      expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
    }
  })

  it('still finds ids next to sentence punctuation', () => {
    const ids = (text: string) => splitIds(text, titleOf).flatMap((s) => (s.kind === 'ref' ? [s.id] : []))
    expect(ids('see t_1.')).toEqual(['t_1'])
    expect(ids('(t_1)')).toEqual(['t_1'])
    expect(ids('t_1, then st_1; t_2!')).toEqual(['t_1', 'st_1', 't_2'])
    expect(ids('t_1. Next')).toEqual(['t_1'])
    expect(ids('"t_1" - t_2')).toEqual(['t_1', 't_2'])
  })

  it('keeps matching after an unclosed backtick', () => {
    expect(splitIds('a ` then t_1', titleOf)).toEqual([
      { kind: 'text', text: 'a ` then ' },
      { kind: 'ref', id: 't_1', title: 'Repository layer' },
    ])
  })

  it('returns nothing for empty text', () => {
    expect(splitIds('', titleOf)).toEqual([])
  })

  it('turns known question ids into refs (question message spec)', () => {
    expect(splitIds('See q_1.', titleOf)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'ref', id: 'q_1', title: 'Keep old logs?' },
      { kind: 'text', text: '.' },
    ])
    for (const text of ['q_1x', 'faq_1', 'q_9']) expect(splitIds(text, titleOf)).toEqual([{ kind: 'text', text }])
  })
})

describe('titlesOf', () => {
  it('looks up stages and threads in the session state', () => {
    const f = titlesOf(fixtureSnapshot().state)
    expect(f('st_2')).toBe('API')
    expect(f('t_3')).toBe('Docs')
    expect(f('t_9')).toBeUndefined()
    expect(f('st_9')).toBeUndefined()
    expect(f('o_1')).toBe('Empty map')
    expect(f('o_2')).toBe('Lazy delegate')
    expect(f('o_9')).toBeUndefined()
  })

  it('titles questions by their first line and their options by title', () => {
    const state = fixtureSnapshot().state
    const f = titlesOf(state)
    expect(f('q_1')).toBe('Should the docs cover the blob layout?')
    expect(f('o_3')).toBe('Yes')
    expect(f('o_4')).toBe('No')
    const t3 = state.threads.t_3
    const multi = withQuestion(state, {}, { messages: [{ ...t3.messages[0], text: '**Keep** old logs?\n\nThey are 2 GB.' }] })
    expect(titlesOf(multi)('q_1')).toBe('**Keep** old logs?')
  })

  // Demo 7 follow-ups 6: q_N chips resolve to stage questions too.
  it('titles stage questions and their options', () => {
    const f = titlesOf(withStageQuestion(fixtureSnapshot().state))
    expect(f('q_3')).toBe('Anything else before the next stage?')
    expect(f('o_7')).toBe('Yes')
    expect(f('o_8')).toBe('No')
  })

  it('turns known block ids into refs, and leaves unknown or partial ones as text', () => {
    const f = titlesOf(fixtureSnapshot().state)
    expect(splitIds('See b_2, not b_9 or `b_2`.', f)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'ref', id: 'b_2', title: 'src/Repo.kt:12-15' },
      { kind: 'text', text: ', not b_9 or `b_2`.' },
    ])
  })

  it('titles blocks by what they show', () => {
    const f = titlesOf(fixtureSnapshot().state)
    expect(f('b_1')).toBe('The repository isolates storage from the domain, so the **event log** format can change freely.')
    expect(f('b_2')).toBe('src/Repo.kt:12-15')
    expect(f('b_3')).toBe('Pick an approach for the cache')
    expect(f('b_4')).toBe('# Storage')
    expect(f('b_5')).toBe('code (go)')
  })

  it('titles blocks per kind and source', () => {
    const base = { id: 'b_1', threadId: 't_1', seq: 1, annotations: [] }
    const block = (b: Partial<Block>): Block => ({ ...base, type: 'note', ...b })
    expect(blockTitle(block({ type: 'file', path: 'internal/cli/wait.go', firstLine: 18, lineCount: 63 }))).toBe('internal/cli/wait.go:18-80')
    // A long path shows the file name only.
    expect(blockTitle(block({ type: 'file', path: 'internal/some/very/deep/package/wait.go', firstLine: 18, lineCount: 63 }))).toBe('wait.go:18-80')
    expect(blockTitle(block({ type: 'file', path: 'wait.go' }))).toBe('wait.go')
    expect(blockTitle(block({ type: 'markdown', path: 'docs/plan.md', firstLine: 1, lineCount: 6 }))).toBe('docs/plan.md:1-6')
    expect(blockTitle(block({ type: 'markdown', text: '\n# Plan\n\nbody' }))).toBe('# Plan')
    expect(blockTitle(block({ type: 'note', text: 'First line\nsecond' }))).toBe('First line')
    expect(blockTitle(block({ type: 'code', lang: 'go', text: 'x := 1' }))).toBe('code (go)')
    expect(blockTitle(block({ type: 'code', text: '\nSELECT 1;\nmore' }))).toBe('SELECT 1;')
    expect(blockTitle(block({ type: 'variants', variants: { title: 'Cache', options: [] } }))).toBe('Cache')
    expect(blockTitle(block({ type: 'variants', variants: { options: [] } }))).toBe('Variants')
  })
})
