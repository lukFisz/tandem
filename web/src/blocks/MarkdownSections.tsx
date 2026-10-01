import { useMemo } from 'react'
import type { Block } from '../api/types'
import { useLineDrag } from '../highlight/useLineDrag'
import { splitSections, useMarkdown, type MdEnv } from '../markdown/markdown'
import { useSessionCtx } from '../session/context'
import { NoteBadge, useQuotedNotes } from '../textnote/NoteBadge'
import { blockNotes, endLine } from '../textnote/notes'
import { LineNotes, blockInteractive } from './LineNotes'

// MarkdownSections renders markdown text one top-level section at a time, each with a gutter of
// its source lines, so line comments and notes can anchor to it (markdown and note blocks).
export function MarkdownSections({ block, text, env }: { block: Block; text: string; env?: MdEnv }) {
  const ctx = useSessionCtx()
  const md = useMarkdown()
  const sections = useMemo(() => splitSections(md, text, block.firstLine ?? 1, env), [md, text, block.firstLine, env])
  const selected = ctx.selection?.blockId === block.id ? ctx.selection.lines : null
  const interactive = blockInteractive(ctx, block)
  const textNotes = blockNotes(useQuotedNotes(), block.id)
  const onPointerDown = useLineDrag(
    interactive ? (lines) => ctx.setSelection({ blockId: block.id, lines, editing: false }) : undefined,
  )
  return (
    <div className="md-sections" onPointerDown={onPointerDown}>
      {sections.map((s, i) => {
        const label = s.lines.start === s.lines.end ? `${s.lines.start}` : `${s.lines.start}–${s.lines.end}`
        const isSelected = !!selected && selected.start <= s.lines.end && selected.end >= s.lines.start
        // A note's end line is anchored to the last section that starts at or before it (covering the
        // gaps splitSections leaves between top-level blocks — blank lines, trailing lines); a note
        // ending before the first section's start still goes to the first section.
        const nextStart = i + 1 < sections.length ? sections[i + 1].lines.start : Infinity
        const isHere = (end: number) => (i === 0 ? end < nextStart : end >= s.lines.start && end < nextStart)
        const sectionClass = [
          'md-section',
          s.listItem && 'md-list-item',
          s.firstInList && 'md-list-first',
          s.lastInList && 'md-list-last',
          isSelected && 'is-selected',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div key={s.lines.start} className={sectionClass} data-ls={s.lines.start} data-le={s.lines.end}>
            {interactive ? (
              <button
                type="button"
                className="md-gutter"
                aria-label={`Lines ${label}`}
                onClick={(e) =>
                  ctx.setSelection({
                    blockId: block.id,
                    lines:
                      e.shiftKey && selected
                        ? { start: Math.min(selected.start, s.lines.start), end: Math.max(selected.end, s.lines.end) }
                        : s.lines,
                    editing: false,
                  })
                }
              >
                {label}
              </button>
            ) : (
              <span className="md-gutter">{label}</span>
            )}
            <NoteBadge notes={textNotes.filter((n) => isHere(endLine(n)))} />
            <div className="prose" dangerouslySetInnerHTML={{ __html: s.html }} />
            <div className="md-notes">
              <LineNotes block={block} isHere={isHere} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
