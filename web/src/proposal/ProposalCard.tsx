import type { ReactNode } from 'react'
import { Prose } from '../markdown/Prose'
import { hasMore, previewOf } from './proposals'

// ProposalCard is the live card of an AI proposal the user acts on: a thread's proposed conclusion
// or a stage's proposed summary (stage summary flow spec, part D). The header row holds the
// following, so Accept and Edit stay in reach while the card is collapsed:
// - the kicker and the version (· vN, from v2 on);
// - the "edited by you" marker (part C) and the Updated pill;
// - the actions and the collapse toggle.
// Collapsed, the body is a one-line preview. `body` (the Edit editor) replaces the text, even on a
// collapsed card, and hides the toggle meanwhile.
// With `resolved`, it is an accepted conclusion or summary instead (demo 7 follow-ups 5): the same
// toggle and preview, but no version, markers or actions, and the resolved card's look. `footer`
// stays below the text, collapsed or not (the accepted stage box's next step).
export function ProposalCard({
  label,
  kicker,
  text,
  version = 1,
  editedByUser = false,
  actions,
  collapsed,
  onToggle,
  updated = false,
  body,
  land,
  resolved = false,
  footer,
}: {
  /** The region's accessible name, e.g. "Proposed conclusion". */
  label: string
  kicker: string
  text: string
  /** 1 for the first proposal. */
  version?: number
  editedByUser?: boolean
  actions?: ReactNode
  collapsed: boolean
  onToggle(): void
  /** A newer version arrived while the card was collapsed. */
  updated?: boolean
  body?: ReactNode
  /** useFollowBottom's landing target (demo2 follow-up 6). */
  land?: string
  /** An accepted or resolved card: no version, markers or actions. */
  resolved?: boolean
  /** Shown below the text, collapsed or not. */
  footer?: ReactNode
}) {
  const folded = collapsed && !body
  const className = ['conclusion', 'proposal', resolved && 'is-resolved', folded && 'is-collapsed'].filter(Boolean).join(' ')
  return (
    <section className={className} aria-label={label} data-land={land}>
      <div className="proposal-head">
        <span className="kicker">{kicker}</span>
        {!resolved && version > 1 && <span className="proposal-version">{`· v${version}`}</span>}
        {!resolved && editedByUser && <span className="edited-by-you">edited by you</span>}
        {!resolved && updated && <span className="proposal-updated">Updated</span>}
        <span className="proposal-actions">
          {!resolved && actions}
          {!body && (
            <button type="button" className="btn link proposal-toggle" aria-expanded={!collapsed} onClick={onToggle}>
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </span>
      </div>
      {body ?? (folded ? <Preview text={text} /> : <Prose text={text} />)}
      {footer}
    </section>
  )
}

// Preview is a collapsed card's one-line preview (demo 7 follow-ups 1). Only the sentence is
// ellipsis-clipped; when the text holds more, a muted "(...)" of its own follows it and never
// clips. The marker is aria-hidden, so what assistive tech reads is unchanged.
function Preview({ text }: { text: string }) {
  return (
    <p className="proposal-preview">
      <span className="proposal-preview-text">{previewOf(text)}</span>
      {hasMore(text) && (
        <span className="proposal-preview-more" aria-hidden="true">
          (...)
        </span>
      )}
    </p>
  )
}

// EarlierProposal is an earlier version of a proposal in the timeline: closed by default, like a
// superseded block (Superseded.tsx), and opened to read it (part D).
export function EarlierProposal({ kicker, version, text }: { kicker: string; version: number; text: string }) {
  return (
    <details className="superseded proposal-earlier">
      <summary>{`${kicker} · v${version}`}</summary>
      <Prose text={text} />
    </details>
  )
}
