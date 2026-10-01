import { useMemo, useState } from 'react'
import type { Block } from '../api/types'
import { excerptChanges, hasChanges } from '../diff/diff'
import { DiffModal } from '../diff/DiffModal'
import { useBlockDiff } from '../diff/useBlockDiff'
import { CodeLines } from '../highlight/CodeLines'
import { useSessionCtx } from '../session/context'
import { ExpandButton } from './ExpandButton'
import { FilePath } from './FilePath'
import { blockDrafts } from '../draft/draft'
import { NoteBadge, useQuotedNotes } from '../textnote/NoteBadge'
import { blockNotes, endLine } from '../textnote/notes'
import { LineNotes, blockInteractive } from './LineNotes'
import { useBlockText } from './useBlockText'

export function selectLines(current: { start: number; end: number } | null, line: number, extend: boolean) {
  return extend && current
    ? { start: Math.min(current.start, line), end: Math.max(current.end, line) }
    : { start: line, end: line }
}

// With `expanded`, the block renders inside BlockModal: no id (the thread copy keeps it), a
// Collapse button, and larger code.
export function CodeBlock({ block, expanded = false }: { block: Block; expanded?: boolean }) {
  const ctx = useSessionCtx()
  const { text, error } = useBlockText(block)
  const first = block.firstLine ?? 1
  const last = first + (block.lineCount ?? 1) - 1
  const selected = ctx.selection?.blockId === block.id ? ctx.selection.lines : null
  const interactive = blockInteractive(ctx, block)
  const thread = ctx.state.threads[block.threadId]
  const noted = (line: number) =>
    block.annotations.some((a) => a.lines.end === line) ||
    (thread?.comments ?? []).some((c) => c.blockId === block.id && c.lines.end === line) ||
    blockDrafts(ctx.draft, block.id).some((c) => c.lines.end === line)
  const textNotes = blockNotes(useQuotedNotes(), block.id)
  const diff = useBlockDiff(block.diffSha)
  const changes = useMemo(() => (diff ? excerptChanges(diff, first, last) : undefined), [diff, first, last])
  const changed = !!changes && hasChanges(changes)
  // Per panel (the thread copy and the expanded copy each have their own), not persisted.
  const [showDeleted, setShowDeleted] = useState(false)
  const [diffOpen, setDiffOpen] = useState<{ group?: number } | null>(null)
  return (
    <figure className={expanded ? 'code-panel is-expanded' : 'code-panel'} id={expanded ? undefined : block.id} data-tn-block={block.id}>
      <figcaption className="code-head">
        {block.path ? <FilePath path={block.path} line={first} /> : <span>{block.lang}</span>}
        <span className="code-head-end">
          {changes && changed && <ChangeStat added={changes.added} modified={changes.modified} deleted={changes.deleted} />}
          {changed && <ChangesSwitch on={showDeleted} onToggle={() => setShowDeleted((v) => !v)} />}
          {diff && diff.groups.length > 0 && (
            <button type="button" className="diff-pill" aria-label="Show the diff vs HEAD" title="Show the diff vs HEAD" onClick={() => setDiffOpen({})}>
              Diff
            </button>
          )}
          <span>
            {first === last ? first : `${first}–${last}`} · {block.lang}
          </span>
          <ExpandButton blockId={block.id} expanded={expanded} />
        </span>
      </figcaption>
      {error ? (
        <p className="code-error">
          Could not load {block.path}: {error}
        </p>
      ) : text === undefined ? (
        <p className="code-loading">Loading…</p>
      ) : (
        <CodeLines
          code={text}
          lang={block.lang ?? 'text'}
          firstLine={first}
          selected={selected}
          noted={noted}
          onLineClick={
            interactive
              ? (line, extend) => ctx.setSelection({ blockId: block.id, lines: selectLines(selected, line, extend), editing: false })
              : undefined
          }
          onLineDrag={(lines) => ctx.setSelection({ blockId: block.id, lines, editing: false })}
          after={(line) => <LineNotes block={block} isHere={(end) => end === line} />}
          badge={(line) => <NoteBadge notes={textNotes.filter((n) => endLine(n) === line)} />}
          changes={changes?.marks}
          showDeleted={changed && showDeleted}
          onChangeClick={(group) => setDiffOpen({ group })}
        />
      )}
      {diff && diffOpen && (
        <DiffModal path={block.path} lang={block.lang ?? 'text'} diff={diff} first={first} last={last} focusGroup={diffOpen.group} onClose={() => setDiffOpen(null)} />
      )}
    </figure>
  )
}

function ChangeStat({ added, modified, deleted }: { added: number; modified: number; deleted: number }) {
  const parts = [
    added > 0 && `${added} added`,
    modified > 0 && `${modified} modified`,
    deleted > 0 && `${deleted} deleted`,
  ].filter(Boolean)
  return (
    <span className="diff-stat" title={`Since HEAD: ${parts.join(', ')}`} aria-label={`Changed since HEAD: ${parts.join(', ')}`}>
      {added > 0 && <span className="a">+{added}</span>}
      {modified > 0 && <span className="m">~{modified}</span>}
      {deleted > 0 && <span className="d">−{deleted}</span>}
    </span>
  )
}

// ChangesSwitch shows the deleted lines in place, ghosted (role=switch: Space and Enter toggle it).
function ChangesSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={on ? 'diff-switch is-on' : 'diff-switch'} onClick={onToggle}>
      <span className="trk" aria-hidden="true" />
      Changes
    </button>
  )
}
