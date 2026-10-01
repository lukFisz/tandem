import { Fragment, useMemo, type ReactNode } from 'react'
import type { LineRange } from '../api/types'
import type { DelSite, LineMark } from '../diff/diff'
import { useTokenize } from './context'
import type { Token } from './tokenize'
import { useLineDrag } from './useLineDrag'

interface Props {
  code: string
  lang: string
  firstLine: number
  selected?: LineRange | null
  onLineClick?: (line: number, extend: boolean) => void
  /** Called while dragging across line numbers (or after a long-press on the text) with the covered range. */
  onLineDrag?: (range: LineRange) => void
  after?: (line: number) => ReactNode
  /** True when the line carries an AI annotation or a sent/draft comment: gets a subtle highlight. */
  noted?: (line: number) => boolean
  /** Rendered in the line's gutter, e.g. the badge of notes on selected text ending there. */
  badge?: (line: number) => ReactNode
  /** Changes vs git HEAD by line (diff/excerptChanges). When set, a change bar column sits between
   *  the line number and the code. */
  changes?: Map<number, LineMark>
  /** The Changes switch: deleted lines show ghosted in place, changed rows tinted with a sign. */
  showDeleted?: boolean
  /** A change bar or deletion wedge was clicked: show that change group's diff. */
  onChangeClick?: (group: number) => void
}

function Tokens({ tokens }: { tokens: Token[] }) {
  if (tokens.every((t) => t.content === '')) return <>{'​'}</>
  return (
    <>
      {tokens.map((t, k) => (
        <span key={k} style={t.color ? { color: t.color, fontStyle: t.italic ? 'italic' : undefined } : undefined}>
          {t.content}
        </span>
      ))}
    </>
  )
}

const plural = (n: number) => (n === 1 ? '1 line' : `${n} lines`)

// ChangeBar is the gutter column of a row: an add (green) or modified (blue) bar, or an empty
// slot that keeps the code aligned.
function ChangeBar({ mark, onClick }: { mark?: LineMark; onClick?: (group: number) => void }) {
  if (!mark?.kind || mark.group === undefined) return <span className="gbar" aria-hidden="true" />
  const what = mark.kind === 'add' ? 'Added' : 'Modified'
  const group = mark.group
  return (
    <button
      type="button"
      className={`gbar is-${mark.kind}`}
      tabIndex={-1}
      aria-label={`${what} line, show the diff`}
      onClick={() => onClick?.(group)}
    >
      <span className="gtip" aria-hidden="true">
        {what} · click to see diff
      </span>
    </button>
  )
}

// DelMark is the red wedge on the row edge where lines were deleted outright.
function DelMark({ site, after, onClick }: { site: DelSite; after?: boolean; onClick?: (group: number) => void }) {
  const text = `${plural(site.lines.length)} deleted ${after ? 'below' : 'above'}`
  return (
    <button
      type="button"
      className={after ? 'delmark is-after' : 'delmark'}
      tabIndex={-1}
      aria-label={`${text}, show the diff`}
      onClick={() => onClick?.(site.group)}
    >
      <span className="gtip" aria-hidden="true">
        {text} · click to see diff
      </span>
    </button>
  )
}

// GhostRows are deleted lines shown in place (the Changes switch). They carry no data-line /
// data-ls, so line selection, drags and notes on selected text skip them, and the CSS makes them
// unselectable, so a native selection's text never includes them.
function GhostRows({ site, lang }: { site: DelSite; lang: string }) {
  const tokenize = useTokenize()
  const lines = useMemo(() => tokenize(site.lines.join('\n') + '\n', lang), [tokenize, site.lines, lang])
  return (
    <>
      {lines.map((tokens, k) => (
        <div key={k} className="code-row is-ghost" data-group={site.group}>
          <span className="ln" aria-hidden="true" />
          <span className="gbar" aria-hidden="true" />
          <span className="diff-sign" aria-hidden="true">
            −
          </span>
          <del className="src">
            <Tokens tokens={tokens} />
          </del>
        </div>
      ))}
    </>
  )
}

export function CodeLines({ code, lang, firstLine, selected, onLineClick, after, noted, onLineDrag, badge, changes, showDeleted, onChangeClick }: Props) {
  const onPointerDown = useLineDrag(onLineClick ? onLineDrag : undefined)
  const tokenize = useTokenize()
  const lines = useMemo(() => tokenize(code, lang), [tokenize, code, lang])
  const rootClass = ['code-lines', changes && 'has-changes', changes && showDeleted && 'show-changes'].filter(Boolean).join(' ')
  return (
    <div className={rootClass} onPointerDown={onPointerDown}>
      {lines.map((tokens, i) => {
        const n = firstLine + i
        const isSelected = !!selected && n >= selected.start && n <= selected.end
        const hasNote = !!noted?.(n)
        const mark = changes?.get(n)
        const rowClass = ['code-row', isSelected && 'is-selected', hasNote && 'has-note', mark?.kind && `is-${mark.kind}`].filter(Boolean).join(' ')
        return (
          <Fragment key={n}>
            {showDeleted && mark?.delBefore && <GhostRows site={mark.delBefore} lang={lang} />}
            <div className={rowClass} data-line={n} data-ls={n} data-le={n}>
              {badge?.(n)}
              {changes && !showDeleted && mark?.delBefore?.pure && <DelMark site={mark.delBefore} onClick={onChangeClick} />}
              {changes && !showDeleted && mark?.delAfter?.pure && <DelMark site={mark.delAfter} after onClick={onChangeClick} />}
              {onLineClick ? (
                <button type="button" className="ln" aria-label={`Line ${n}`} onClick={(e) => onLineClick(n, e.shiftKey)}>
                  {n}
                </button>
              ) : (
                <span className="ln">{n}</span>
              )}
              {changes && <ChangeBar mark={mark} onClick={onChangeClick} />}
              {changes && showDeleted && (
                <span className="diff-sign" aria-hidden="true">
                  {mark?.kind ? '+' : ''}
                </span>
              )}
              <code className="src">
                <Tokens tokens={tokens} />
              </code>
            </div>
            {after?.(n)}
            {showDeleted && mark?.delAfter && <GhostRows site={mark.delAfter} lang={lang} />}
          </Fragment>
        )
      })}
    </div>
  )
}
