import { useState, type ReactNode } from 'react'
import type { Block, LineRange } from '../api/types'
import { blockDrafts, type DraftLineComment } from '../draft/draft'
import { AgentText } from '../refs/IdChip'
import { useSessionCtx, type SessionCtx } from '../session/context'
import { CommentEditor } from './CommentEditor'
import { rangeText } from './useBlockText'

export function blockInteractive(ctx: SessionCtx, block: Block): boolean {
  return !ctx.readOnly && !block.supersededBy && ctx.state.threads[block.threadId]?.status !== 'resolved'
}

function Note({
  kind,
  who,
  lines,
  seq,
  children,
}: {
  kind: 'ai' | 'sent' | 'draft'
  who: string
  lines: LineRange
  seq?: number
  children: ReactNode
}) {
  return (
    <div className={`line-note is-${kind}`} data-comment-seq={seq}>
      <span className="who">
        {who} · {rangeText(lines)}
      </span>
      <div className="note-text">{children}</div>
    </div>
  )
}

function DraftNote({ comment }: { comment: DraftLineComment }) {
  const { updateDraft, removeDraft } = useSessionCtx()
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <CommentEditor
        initial={comment.text}
        onSave={(text) => {
          updateDraft(comment.id, text)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }
  return (
    <Note kind="draft" who="You · draft" lines={comment.lines}>
      {comment.text}
      <span className="note-actions">
        <button type="button" className="btn link" aria-label="Edit draft comment" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn link" aria-label="Remove draft comment" onClick={() => removeDraft(comment.id)}>
          Remove
        </button>
      </span>
    </Note>
  )
}

// LineNotes renders everything anchored at a line (or markdown section) of a block, except notes on
// selected text: those show as a highlight and a badge (textnote/).
export function LineNotes({ block, isHere }: { block: Block; isHere: (endLine: number) => boolean }) {
  const ctx = useSessionCtx()
  const thread = ctx.state.threads[block.threadId]
  const sel = ctx.selection?.blockId === block.id && isHere(ctx.selection.lines.end) ? ctx.selection : null
  return (
    <>
      {block.annotations
        .filter((a) => isHere(a.lines.end))
        .map((a, i) => (
          <Note key={`a${i}`} kind="ai" who="AI" lines={a.lines}>
            <AgentText text={a.text} />
          </Note>
        ))}
      {(thread?.comments ?? [])
        .filter((c) => c.blockId === block.id && !c.quote && isHere(c.lines.end))
        .map((c, i) => (
          <Note key={`s${i}`} kind="sent" who="You" lines={c.lines} seq={c.seq}>
            {c.text}
          </Note>
        ))}
      {blockDrafts(ctx.draft, block.id)
        .filter((c) => !c.quote && isHere(c.lines.end))
        .map((c) => (
          <DraftNote key={c.id} comment={c} />
        ))}
      {sel && !sel.editing && (
        <div className="sel-bar">
          <button type="button" className="btn small" onClick={() => ctx.setSelection({ ...sel, editing: true })}>
            Comment on {rangeText(sel.lines)} <kbd>c</kbd>
          </button>
        </div>
      )}
      {sel?.editing && (
        <CommentEditor
          onSave={(text) => {
            ctx.addDraft({ threadId: block.threadId, blockId: block.id, lines: sel.lines, text })
            ctx.setSelection(null)
          }}
          onCancel={() => ctx.setSelection(null)}
        />
      )}
    </>
  )
}
