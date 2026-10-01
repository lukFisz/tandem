import type { Block } from '../api/types'
import { CodeBlock } from './CodeBlock'
import { MarkdownBlock } from './MarkdownBlock'
import { NoteBlock } from './NoteBlock'
import { VariantsBlock } from './VariantsBlock'

// `expanded` renders a code, file or markdown block for the large block modal (BlockModal).
export function BlockView({ block, onResolved, expanded }: { block: Block; onResolved?: () => void; expanded?: boolean }) {
  switch (block.type) {
    case 'note':
      return <NoteBlock block={block} />
    case 'code':
    case 'file':
      return <CodeBlock block={block} expanded={expanded} />
    case 'markdown':
      return <MarkdownBlock block={block} expanded={expanded} />
    case 'variants':
      return <VariantsBlock block={block} onResolved={onResolved} />
  }
}
