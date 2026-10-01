import { useEffect, useRef, useState } from 'react'
import type { Thread } from '../api/types'
import { CommentEditor } from '../blocks/CommentEditor'
import { useThreadText } from '../draft/threadText'
import { useSessionCtx } from '../session/context'
import { RESOLVE_NOTE_EVENT } from '../session/shortcuts'
import { scrollFullyIntoView } from '../shell/motion'

// ResolveThread lets the user resolve an open thread the AI has not proposed a conclusion for.
// Resolve resolves at once; the daemon fills in "Resolved by user" (follow-ups B). Add note, or
// `c` with no line selected, opens the same editor as the conclusion's Edit, starting empty. The
// note becomes the conclusion, and the agent receives it as "conclusion edited and accepted".
// It is its own component, so the editor state is dropped when the thread's status changes.
//
// The note editor is 'closed', 'opened' by the user (Add note or `c`), or 'restored' from an
// unsent note kept for this thread (demo2 follow-up 2) after a thread switch or reload. Opening
// focuses it and scrolls the whole editor into view, buttons included (follow-up 1). A restored
// editor does neither, so it never takes focus or scroll away from the user's navigation (j/k).
// A successful Resolve or Cancel forgets the kept note.
type NoteEditor = 'closed' | 'opened' | 'restored'

export function ResolveThread({ thread, onResolved }: { thread: Thread; onResolved?: () => void }) {
  const { run, sid } = useSessionCtx()
  const [note, setNote] = useThreadText('note', sid, thread.id)
  const [editor, setEditor] = useState<NoteEditor>(() => (note ? 'restored' : 'closed'))
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const editorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const open = (e: Event) => {
      if (inFlight.current) return
      if ((e as CustomEvent<{ threadId: string }>).detail?.threadId === thread.id) setEditor('opened')
    }
    document.addEventListener(RESOLVE_NOTE_EVENT, open)
    return () => document.removeEventListener(RESOLVE_NOTE_EVENT, open)
  }, [thread.id])

  useEffect(() => {
    const el = editorRef.current
    if (editor !== 'opened' || !el) return
    el.querySelector('textarea')?.focus() // a restored editor opened with `c` is already mounted
    scrollFullyIntoView(el)
  }, [editor])

  const resolve = async (text: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (await run({ type: 'thread.resolve', data: { threadId: thread.id, ...(text ? { text } : {}) } })) {
        setNote('')
        onResolved?.()
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (editor === 'closed')
    return (
      <div className="resolve-bar">
        <button type="button" className="btn small" disabled={busy} onClick={() => void resolve('')}>
          Resolve
        </button>
        <button type="button" className="btn link" disabled={busy} onClick={() => setEditor('opened')}>
          Add note
        </button>
        <span className="resolve-hint">
          or press <kbd>c</kbd> to add a note
        </span>
      </div>
    )
  return (
    <section className="conclusion" aria-label="Resolve thread" ref={editorRef}>
      <div className="kicker">Resolve thread</div>
      <CommentEditor
        label="Conclusion (optional)"
        submitLabel="Resolve"
        allowEmpty
        initial={note}
        autoFocus={editor === 'opened'}
        onChange={setNote}
        onSave={(text) => void resolve(text)}
        onCancel={() => {
          setNote('')
          setEditor('closed')
        }}
      />
    </section>
  )
}
