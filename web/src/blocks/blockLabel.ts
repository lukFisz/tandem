import type { Block, BlockKind } from '../api/types'

const WORDS: Record<BlockKind, string> = {
  note: 'Note',
  code: 'Code',
  file: 'File',
  markdown: 'Document',
  variants: 'Variants',
}

// blockLabel names a block for people: "Note 15", or "File 15 · src/Repo.kt" for a file or document with a path.
export function blockLabel(block: Block): string {
  const n = block.id.replace(/\D/g, '')
  const base = `${WORDS[block.type] ?? 'Block'} ${n}`.trim()
  return (block.type === 'file' || block.type === 'markdown') && block.path ? `${base} · ${block.path}` : base
}
