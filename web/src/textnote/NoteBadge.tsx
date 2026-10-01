import { useMemo } from 'react'
import { useSessionCtx } from '../session/context'
import { quotedNotes, type TextNote } from './notes'

export function useQuotedNotes(): TextNote[] {
  const { state, draft } = useSessionCtx()
  return useMemo(() => quotedNotes(state, draft), [state, draft])
}

// NoteBadge marks where notes on selected text end (a line, a section or a message). TextNotes
// shows their card on hover, focus or click, by the keys in data-tn-notes.
export function NoteBadge({ notes }: { notes: TextNote[] }) {
  if (!notes.length) return null
  const seqs = [...new Set(notes.flatMap((n) => (n.seq === undefined ? [] : [n.seq])))]
  const label = notes.length === 1 ? 'Note on selected text' : `${notes.length} notes on selected text`
  return (
    <button
      type="button"
      className={notes.some((n) => n.draftId) ? 'tn-badge is-draft' : 'tn-badge'}
      data-tn-notes={notes.map((n) => n.key).join(' ')}
      data-comment-seqs={seqs.length ? seqs.join(' ') : undefined}
      aria-label={label}
      title={label}
    >
      💬
    </button>
  )
}
