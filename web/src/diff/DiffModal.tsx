import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTokenize } from '../highlight/context'
import type { Token } from '../highlight/tokenize'
import { rowInExcerpt, rowStats, segments, splitRows, type DiffRow, type ParsedDiff } from './diff'
import { diffTokens } from './tokens'

export type DiffView = 'unified' | 'split'
export type DiffScope = 'excerpt' | 'file'

interface Props {
  path?: string
  lang: string
  diff: ParsedDiff
  /** The excerpt's line range (new-side line numbers). */
  first: number
  last: number
  /** A change group to scroll to and flash on open (a clicked change bar). */
  focusGroup?: number
  onClose: () => void
}

const FLASH_MS = 1600

function Code({ tokens }: { tokens?: Token[] }) {
  if (!tokens || tokens.every((t) => t.content === '')) return <code className="src">{'​'}</code>
  return (
    <code className="src">
      {tokens.map((t, k) => (
        <span key={k} style={t.color ? { color: t.color, fontStyle: t.italic ? 'italic' : undefined } : undefined}>
          {t.content}
        </span>
      ))}
    </code>
  )
}

const SIGN = { ctx: '', add: '+', del: '−' } as const

// DiffModal shows a file block's changes vs git HEAD in the block modal's native dialog: unified
// or split, the excerpt's hunks (with a little context) or the whole file with the excerpt's lines
// marked. It renders into document.body, so it can open over the expanded-block modal too; its
// own Escape, ✕ and backdrop click close only it.
export function DiffModal({ path, lang, diff, first, last, focusGroup, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<DiffView>('unified')
  const [scope, setScope] = useState<DiffScope>('excerpt')
  const [flash, setFlash] = useState<number | undefined>(focusGroup)
  const tokenize = useTokenize()
  const tokens = useMemo(() => {
    const byRow = new Map<DiffRow, Token[]>()
    const all = diffTokens(diff, tokenize, lang)
    diff.hunks.forEach((h, hi) => h.rows.forEach((r, k) => byRow.set(r, all[hi][k])))
    return byRow
  }, [diff, tokenize, lang])
  const segs = useMemo(() => segments(diff, scope, first, last), [diff, scope, first, last])
  const stats = rowStats(segs.flatMap((s) => s.rows))

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // showModal gives the backdrop, focus trapping and Escape; jsdom lacks it, so fall back to `open`.
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    } else dialog.setAttribute('open', '')
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
    }
  }, [])

  useEffect(() => {
    if (focusGroup === undefined) return
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-group="${focusGroup}"]`)
    el?.scrollIntoView?.({ block: 'center' })
    const t = setTimeout(() => setFlash(undefined), FLASH_MS)
    return () => clearTimeout(t)
  }, [focusGroup])

  const close = (e: { stopPropagation(): void }) => {
    // React bubbles dialog events through the component tree: keep them from the block modal.
    e.stopPropagation()
    onClose()
  }
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    e.stopPropagation()
    if (e.target === e.currentTarget) onClose()
  }

  const rowClass = (r: DiffRow) =>
    ['drow', r.type !== 'ctx' && `is-${r.type}`, scope === 'file' && rowInExcerpt(diff, r, first, last) && 'is-excerpt', flash !== undefined && r.group === flash && 'is-flash']
      .filter(Boolean)
      .join(' ')

  const line = (r: DiffRow, key: string | number, cols: 'both' | 'old' | 'new') => (
    <div key={key} className={rowClass(r)} data-group={r.group}>
      {cols !== 'new' && <span className="ln">{r.oldNo ?? ''}</span>}
      {cols !== 'old' && <span className="ln">{r.newNo ?? ''}</span>}
      <span className="sg" aria-hidden="true">
        {SIGN[r.type]}
      </span>
      <Code tokens={tokens.get(r)} />
    </div>
  )
  const blank = (key: number) => (
    <div key={key} className="drow is-blank">
      <span className="ln" />
      <span className="sg" />
      <code className="src">{'​'}</code>
    </div>
  )

  const seg = <T extends string>(label: string, value: T, options: [T, string][], set: (v: T) => void) => (
    <span className="diff-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}>
          {text}
        </button>
      ))}
    </span>
  )

  return createPortal(
    <dialog
      ref={ref}
      className="block-modal diff-modal"
      aria-label={path ? `Changes in ${path}` : 'Changes'}
      onClick={onClick}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault()
        close(e)
      }}
      onClose={close}
    >
      <header className="block-modal-head">
        <span className="block-modal-label">Changes</span>
        {path && <span className="block-modal-path">{path}</span>}
        {seg<DiffView>('Diff layout', view, [['unified', 'Unified'], ['split', 'Split']], setView)}
        {seg<DiffScope>('Diff scope', scope, [['excerpt', 'Excerpt'], ['file', 'Whole file']], setScope)}
        {/* Focus lands on ✕ as in the block modal, not on the first toggle. */}
        <button type="button" className="block-modal-close" aria-label="Close" title="Close" onClick={onClose} autoFocus>
          ✕
        </button>
      </header>
      <div className="block-modal-body" ref={bodyRef}>
        <p className="diff-meta">
          <span>{diff.isNew ? 'new file, not in HEAD' : 'working tree vs HEAD'}</span>
          <span className="diff-stat">
            <span className="a">+{stats.added}</span>
            {!diff.isNew && <span className="d">−{stats.deleted}</span>}
          </span>
        </p>
        {segs.length === 0 ? (
          <p className="diff-empty">No changes in the excerpt.</p>
        ) : (
          <div className={`diff-view is-${view}`}>
            {segs.map((s, si) => (
              <Fragment key={si}>
                <div className="diff-hunk">{s.header}</div>
                {view === 'unified' ? (
                  <div className="diff-scroll">{s.rows.map((r, k) => line(r, k, 'both'))}</div>
                ) : (
                  <div className="diff-split">
                    <div className="diff-scroll" aria-label="HEAD">
                      {splitRows(s.rows).map(([l], k) => (l ? line(l, k, 'old') : blank(k)))}
                    </div>
                    <div className="diff-scroll" aria-label="Working tree">
                      {splitRows(s.rows).map(([, r], k) => (r ? line(r, k, 'new') : blank(k)))}
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  )
}
