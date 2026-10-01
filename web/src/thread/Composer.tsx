import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Stage, Thread } from '../api/types'
import { countDraft } from '../draft/draft'
import { loadThreadText, saveThreadText, useThreadText } from '../draft/threadText'
import { useSessionCtx } from '../session/context'
import { modKeyLabel } from './platform'

export function Composer({ thread, onSent }: { thread: Thread; onSent?: () => void }) {
  const { sendReview, readOnly, draft } = useSessionCtx()
  return (
    <ComposerBox
      itemId={thread.id}
      hidden={readOnly || thread.status === 'resolved'}
      // Every draft comment goes out with the message (sendReview sends the whole draft).
      pending={countDraft(draft)}
      send={(message) => sendReview(message ? { threadId: thread.id, message } : undefined)}
      onSent={onSent}
    />
  )
}

// StageComposer is the composer at the bottom of a stage page (stage summary flow spec, part E). It
// is always there, from before the first summary through after its accept. It sends stage.message
// through run, so pending draft comments go with it as with every other action. Unsent text is kept
// per stage under the same tdm:composer:<sid>:<id> key as a thread's (stage and thread ids never
// collide).
export function StageComposer({ stage, onSent }: { stage: Stage; onSent?: () => void }) {
  const { run, readOnly } = useSessionCtx()
  return (
    <ComposerBox
      itemId={stage.id}
      hidden={readOnly}
      pending={0}
      send={async (message) => (message ? run({ type: 'stage.message', data: { stageId: stage.id, text: message } }) : false)}
      onSent={onSent}
    />
  )
}

// ComposerBox is the composer UI and its send rules, shared by threads and stages. `send` gets the
// trimmed text, or undefined for a draft-only send (threads only: `pending` counts the draft
// comments that go with it).
function ComposerBox({
  itemId,
  hidden,
  pending,
  send: deliver,
  onSent,
}: {
  itemId: string
  hidden: boolean
  pending: number
  send(message: string | undefined): Promise<boolean>
  onSent?: () => void
}) {
  const { sid } = useSessionCtx()
  // Demo2 follow-up 2: unsent text is kept per thread (and per stage), across switches and reloads.
  const [text, setText] = useThreadText('composer', sid, itemId)
  const [sending, setSending] = useState(false)
  // Read inside the pending send's `.then` (not `text` from the closure) so a same-message
  // success clears the box, but an edit made while the send was in flight survives (M7).
  const textRef = useRef(text)
  textRef.current = text
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const boxRef = useRef<HTMLDivElement>(null)
  useComposerHeightVar(boxRef, hidden)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(inputRef, text, hidden)
  if (hidden) return null
  const sendLabel = pending ? `Send (${pending} comment${pending > 1 ? 's' : ''})` : 'Send'
  const send = async (message: string | undefined) => {
    if (sending) return
    const sentText = textRef.current
    setSending(true)
    try {
      if (await deliver(message)) {
        if (mounted.current) {
          if (textRef.current === sentText) setText('')
        } else if (loadThreadText('composer', sid, itemId) === sentText) {
          // This composer unmounted while the send was in flight (a thread switch), and a newer
          // mount of the same item may have stored new text since: forget only what was sent.
          saveThreadText('composer', sid, itemId, '')
        }
        onSent?.()
      }
    } finally {
      setSending(false)
    }
  }
  // Send and ⌘↵/Ctrl↵ do the same thing. The typed message goes with the whole draft; with no text
  // (or only whitespace) but draft comments pending, the draft goes alone (M7, and demo2 follow-up 3
  // for the button).
  const canSend = !sending && (text.trim() !== '' || pending > 0)
  const submit = () => {
    if (!canSend) return
    void send(text.trim() || undefined)
  }
  return (
    <div className="composer" ref={boxRef}>
      <div className="composer-card input-card">
        <textarea
          ref={inputRef}
          aria-label="Reply"
          placeholder="Reply…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-foot">
          <span className="composer-hint">
            {pending ? `${modKeyLabel()} sends with ${pending} draft comment${pending > 1 ? 's' : ''}` : `${modKeyLabel()} to send`}
          </span>
          <button
            type="button"
            className="composer-send"
            aria-label={sendLabel}
            title={`${sendLabel} (${modKeyLabel()})`}
            disabled={!canSend}
            onClick={submit}
          >
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
              <path d="M7 12V2M2.5 6.5 7 2l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// useAutoGrow sizes the textarea to its content (restored text included); CSS caps it at 40vh,
// past which it scrolls.
function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, text: string, hidden: boolean) {
  useLayoutEffect(() => {
    const el = ref.current
    if (hidden || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, text, hidden])
}

// useComposerHeightVar publishes the sticky composer's live height as --composer-height on the
// root element. The scroll container (.main) uses it as scroll-padding-bottom, so scrollIntoView
// (e.g. the Resolve note editor opening, demo2 follow-up 1) never leaves content under the
// composer, even when its textarea is resized. Removed while no composer is shown.
function useComposerHeightVar(ref: RefObject<HTMLElement | null>, hidden: boolean) {
  useEffect(() => {
    const el = ref.current
    if (hidden || !el) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--composer-height', `${el.getBoundingClientRect().height}px`)
    update()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--composer-height')
    }
  }, [ref, hidden])
}
