import { useState } from 'react'
import type { Block } from '../api/types'
import { Prose } from '../markdown/Prose'
import { AgentText } from '../refs/IdChip'
import { useSessionCtx } from '../session/context'
import { CommentEditor } from './CommentEditor'
import { blockInteractive } from './LineNotes'
import { NestedBlock } from './NestedBlock'

export function VariantsBlock({ block, onResolved }: { block: Block; onResolved?: () => void }) {
  const ctx = useSessionCtx()
  const [selected, setSelected] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [pending, setPending] = useState(false)
  const interactive = blockInteractive(ctx, block)
  const v = block.variants ?? { options: [] }

  const select = (optionId: string) => {
    setSelected(optionId)
    setRejecting(false)
  }

  const cancel = () => {
    setSelected(null)
    setComment('')
  }

  const openReject = () => {
    setRejecting(true)
    cancel()
  }

  // resolve: "Choose & resolve" also resolves the thread with the option title (plus the comment)
  // as its conclusion (feature review t_7), then lets the page advance like Accept does.
  const send = async (resolve = false) => {
    if (!selected || pending) return
    setPending(true)
    const c = comment.trim()
    const ok = await ctx.run({
      type: 'variant.choose',
      data: { blockId: block.id, optionId: selected, ...(c ? { comment: c } : {}), ...(resolve ? { resolve: true } : {}) },
    })
    setPending(false)
    if (!ok) return
    cancel()
    if (resolve) onResolved?.()
  }

  return (
    <section className="variants" id={block.id} aria-label={v.title ?? 'Variants'}>
      {v.title && <div className="kicker">{v.title}</div>}
      <div className="variant-cards">
        {v.options.map((o) => {
          const chosen = block.chosenOption === o.id
          const isSelected = selected === o.id
          const cls = chosen ? 'variant is-chosen' : isSelected ? 'variant is-selected' : 'variant'
          return (
            <div key={o.id} className={cls} data-option={o.id}>
              <h4>{o.title}</h4>
              {o.description && <Prose text={o.description} />}
              {(o.pros?.length ?? 0) + (o.cons?.length ?? 0) > 0 && (
                <ul className="pros-cons">
                  {o.pros?.map((p, i) => (
                    <li key={`p${i}`} className="pro">
                      <AgentText text={p} />
                    </li>
                  ))}
                  {o.cons?.map((c, i) => (
                    <li key={`c${i}`} className="con">
                      <AgentText text={c} />
                    </li>
                  ))}
                </ul>
              )}
              {o.blocks?.map((b, i) => <NestedBlock key={i} content={b} />)}
              <div className="variant-foot">
                {chosen ? (
                  <span className="variant-chosen" aria-label="Chosen">
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Chosen
                  </span>
                ) : (
                  interactive && (
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={isSelected}
                      onClick={() => (isSelected ? cancel() : select(o.id))}
                    >
                      {isSelected ? 'Selected' : 'Choose'}
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
      {block.rejected && <p className="muted variants-rejected">You rejected all options.</p>}
      {interactive && selected && (
        <div className="variant-confirm">
          <div className="input-card">
            <textarea
              aria-label="Comment for your choice (optional)"
              placeholder="Comment for your choice (optional)"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void send()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  // Like the Cancel button: the selection stays while the choice is being sent.
                  if (!pending) cancel()
                }
              }}
            />
          </div>
          <div className="actions">
            <button type="button" className="btn primary small" disabled={pending} onClick={() => void send()}>
              Send choice
            </button>
            <button type="button" className="btn small" disabled={pending} onClick={() => void send(true)}>
              Choose &amp; resolve
            </button>
            <button type="button" className="btn small" disabled={pending} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {interactive && !rejecting && (
        <div className="variant-extra">
          <button type="button" className="btn link" onClick={openReject}>
            None of these
          </button>
        </div>
      )}
      {rejecting && (
        <CommentEditor
          label="Why none of these?"
          submitLabel="None of these"
          onSave={async (reason) => {
            if (await ctx.run({ type: 'variants.reject', data: { blockId: block.id, comment: reason } })) setRejecting(false)
          }}
          onCancel={() => setRejecting(false)}
        />
      )}
    </section>
  )
}
