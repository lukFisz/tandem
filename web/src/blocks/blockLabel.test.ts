import { describe, expect, it } from 'vitest'
import type { Block, BlockKind } from '../api/types'
import { blockLabel } from './blockLabel'

const mk = (type: BlockKind, over: Partial<Block> = {}): Block => ({ id: 'b_15', threadId: 't_1', seq: 1, type, annotations: [], ...over })

describe('blockLabel', () => {
  it.each([
    ['note', 'Note 15'],
    ['code', 'Code 15'],
    ['file', 'File 15'],
    ['markdown', 'Document 15'],
    ['variants', 'Variants 15'],
  ] as const)('labels %s without a path', (kind, want) => {
    expect(blockLabel(mk(kind))).toBe(want)
  })

  it('appends the path for file and markdown blocks', () => {
    expect(blockLabel(mk('file', { path: 'src/Repo.kt' }))).toBe('File 15 · src/Repo.kt')
    expect(blockLabel(mk('markdown', { path: 'docs/a.md' }))).toBe('Document 15 · docs/a.md')
  })

  it('ignores the path for other kinds', () => {
    expect(blockLabel(mk('code', { path: 'x.kt' }))).toBe('Code 15')
  })
})
