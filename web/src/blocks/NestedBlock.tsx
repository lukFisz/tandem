import type { BlockContent } from '../api/types'
import { CodeLines } from '../highlight/CodeLines'
import { Prose } from '../markdown/Prose'
import { FilePath } from './FilePath'
import { useBlockText } from './useBlockText'

// NestedBlock renders a block inside a variant option: read-only, no annotations.
export function NestedBlock({ content }: { content: BlockContent }) {
  const { text, error } = useBlockText(content)
  if (error) return <p className="code-error">Could not load {content.path}: {error}</p>
  if (text === undefined) return <p className="code-loading">Loading…</p>
  if (content.type === 'note' || content.type === 'markdown') return <Prose text={text} />
  return (
    <figure className="code-panel is-nested">
      {content.path && (
        <figcaption className="code-head">
          <FilePath path={content.path} line={content.firstLine} />
        </figcaption>
      )}
      <CodeLines code={text} lang={content.lang ?? 'text'} firstLine={content.firstLine ?? 1} />
    </figure>
  )
}
