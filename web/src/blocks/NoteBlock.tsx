import { useMemo } from 'react'
import type { Block } from '../api/types'
import type { MdEnv } from '../markdown/markdown'
import { useTitleOf } from '../refs/IdChip'
import { MarkdownSections } from './MarkdownSections'

// A note renders in sections like a markdown block, so it takes line comments and notes on
// selected text; its gutter shows on hover only (app.css).
export function NoteBlock({ block }: { block: Block }) {
  const titleOf = useTitleOf()
  const env = useMemo<MdEnv>(() => ({ titleOf }), [titleOf])
  return (
    <section className="note" id={block.id} data-tn-block={block.id}>
      <div className="kicker">Note</div>
      <MarkdownSections block={block} text={block.text ?? ''} env={env} />
    </section>
  )
}
