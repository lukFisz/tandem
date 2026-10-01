import type { Block } from '../api/types'
import { ExpandButton } from './ExpandButton'
import { FilePath } from './FilePath'
import { MarkdownSections } from './MarkdownSections'
import { useBlockText } from './useBlockText'

// With `expanded`, the block renders inside BlockModal: no id (the thread copy keeps it), and a
// Collapse button in its header row.
export function MarkdownBlock({ block, expanded = false }: { block: Block; expanded?: boolean }) {
  const { text, error } = useBlockText(block)
  const id = expanded ? undefined : block.id
  const className = expanded ? 'md-block is-expanded' : 'md-block'
  // The header row: the path (if any) and the expand control at the far right.
  const head = (
    <div className="md-head">
      {block.path ? <FilePath path={block.path} line={block.firstLine} className="md-path" /> : <span />}
      <ExpandButton blockId={block.id} expanded={expanded} />
    </div>
  )
  if (error)
    return (
      <section className={className} id={id} aria-label={block.path ?? 'Document'}>
        <p className="code-error">
          Could not load {block.path}: {error}
        </p>
      </section>
    )
  if (text === undefined)
    return (
      <section className={className} id={id} aria-label={block.path ?? 'Document'}>
        <p className="code-loading">Loading…</p>
      </section>
    )
  return (
    <section className={className} id={id} aria-label={block.path ?? 'Document'} data-tn-block={block.id}>
      {head}
      <MarkdownSections block={block} text={text} />
    </section>
  )
}
