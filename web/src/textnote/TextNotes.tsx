import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { blockInteractive } from '../blocks/LineNotes'
import { useSessionCtx, type SessionCtx } from '../session/context'
import { TEXT_NOTE_EVENT, anchorRoots, capture, findQuote, hits, lastRect, type Captured } from './dom'
import { paint } from './highlight'
import { useQuotedNotes } from './NoteBadge'
import { MAX_QUOTE, noteWhere, toDraft, type Anchor, type TextNote } from './notes'

const HIDE_MS = 220
const ROOT = '[data-tn-block], [data-tn-msg]'

type GetRect = () => DOMRect | null

interface Editor {
  anchor: Anchor
  quote: string
  range: Range | null
  getRect: GetRect
  host: Element
  draftId?: string
  initial: string
}

interface Card {
  keys: string[]
  getRect: GetRect
  host: Element
  pinned: boolean
}

interface Located {
  key: string
  root: Element
  range: Range
}

// allowed completes a captured anchor when the user may comment there: the same conditions as
// line comments (blockInteractive) for blocks, an open thread's message for messages.
function allowed(ctx: SessionCtx, c: Captured): Anchor | null {
  if (ctx.readOnly || c.quote.length > MAX_QUOTE) return null
  const a = c.anchor
  if (a.kind === 'block') {
    const block = ctx.state.blocks[a.blockId]
    return block && blockInteractive(ctx, block) ? { ...a, threadId: block.threadId } : null
  }
  const t = ctx.state.threads[a.threadId]
  return t && t.status !== 'resolved' && t.messages.some((m) => m.seq === a.messageSeq) ? a : null
}

const hostOf = (el: Element | null): Element => el?.closest('dialog[open]') ?? document.body

const live = (r: Range | null) => (r && r.startContainer.isConnected ? r : null)

// useFloating places a fixed element next to a rect: 'above' its end (the pill), or 'below' its
// start, flipping above when there is no room. It follows scrolling and resizing.
function useFloating(ref: RefObject<HTMLElement | null>, getRect: GetRect, side: 'above' | 'below') {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let last: DOMRect | null = null
    const place = () => {
      const r = getRect() ?? last
      if (!r) return
      last = r
      const w = el.offsetWidth
      const h = el.offsetHeight || 24
      const vw = document.documentElement.clientWidth || window.innerWidth
      let left = side === 'above' ? r.right - 24 : r.left
      let top = side === 'above' ? r.top - h - 6 : r.bottom + 8
      if (side === 'above' && top < 4) top = r.bottom + 6
      if (side === 'below' && top + h > window.innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8
      left = Math.max(8, Math.min(left, vw - w - 8))
      el.style.left = `${left}px`
      el.style.top = `${top}px`
    }
    place()
    let raf = 0
    const later = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
    }
  })
}

function Pill({ at, onOpen }: { at: Captured; onOpen(): void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useFloating(ref, () => lastRect(at.range), 'above')
  return (
    <button
      ref={ref}
      type="button"
      className="tn-pill"
      aria-label="Add a note on the selection"
      // Keep the selection: the click opens the editor on it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
    >
      💬 Note <kbd>c</kbd>
    </button>
  )
}

function NoteEditor({ editor, onSave, onCancel }: { editor: Editor; onSave(text: string): void; onCancel(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(editor.initial)
  useFloating(ref, editor.getRect, 'below')
  const save = () => {
    if (text.trim()) onSave(text.trim())
  }
  const title = editor.draftId ? 'Edit note' : 'Note on selection'
  return (
    <div ref={ref} className="tn-pop tn-editor" role="dialog" aria-label={title}>
      <span className="who">{title}</span>
      <blockquote className="tn-quote">{editor.quote}</blockquote>
      <div className="input-card">
        <textarea
          aria-label="Note"
          placeholder="Note"
          rows={3}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onCancel()
            }
          }}
        />
      </div>
      <div className="tn-actions">
        <button type="button" className="btn link" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary small" disabled={!text.trim()} onClick={save}>
          Save to draft <kbd>⌘↵</kbd>
        </button>
      </div>
    </div>
  )
}

function NoteCard({
  card,
  notes,
  onEnter,
  onLeave,
  onEdit,
  onRemove,
}: {
  card: Card
  notes: TextNote[]
  onEnter(): void
  onLeave(): void
  onEdit(n: TextNote): void
  onRemove(n: TextNote): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useFloating(ref, card.getRect, 'below')
  return (
    <div
      ref={ref}
      className="tn-pop tn-card"
      role="dialog"
      aria-label={notes.length === 1 ? 'Note' : 'Notes'}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave()
      }}
    >
      {notes.map((n) => (
        <div key={n.key} className={n.draftId ? 'tn-card-note is-draft' : 'tn-card-note'}>
          <span className="who">
            {n.draftId ? 'You · draft' : 'You'} · {noteWhere(n.anchor)}
          </span>
          <blockquote className="tn-quote">{n.quote}</blockquote>
          <div className="note-text">{n.text}</div>
          {n.draftId && (
            <div className="tn-row-actions">
              <button type="button" className="btn link" aria-label="Edit draft note" onClick={() => onEdit(n)}>
                Edit
              </button>
              <button type="button" className="btn link" aria-label="Remove draft note" onClick={() => onRemove(n)}>
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// TextNotes is the session page's layer for notes on selected text. It shows the 💬 Note pill on a
// selection inside a block or chat message, the floating editor, and the card of saved notes
// (from a NoteBadge or the highlighted text), and paints the highlights. Its DOM contract is in
// dom.ts.
export function TextNotes() {
  const ctx = useSessionCtx()
  const notes = useQuotedNotes()
  const [pill, setPill] = useState<Captured | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const latest = useRef({ ctx, notes, pill, editor, card })
  latest.current = { ctx, notes, pill, editor, card }
  const located = useRef<Located[]>([])
  const hot = useRef<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const keepCard = useCallback(() => clearTimeout(hideTimer.current), [])
  const hideCard = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!latest.current.card?.pinned) setCard(null)
    }, HIDE_MS)
  }, [])
  const showCard = useCallback((next: Card) => {
    clearTimeout(hideTimer.current)
    if (latest.current.editor) return
    setCard((c) => (c && c.pinned && !next.pinned ? c : next))
  }, [])

  const paintAll = useCallback(() => {
    const ed = latest.current.editor
    paint('tdm-note', located.current.map((l) => l.range))
    paint('tdm-note-hot', located.current.filter((l) => l.key === hot.current).map((l) => l.range))
    const pending = live(ed?.range ?? null)
    paint('tdm-pending', pending ? [pending] : [])
  }, [])

  // Saved notes are found again after every render and DOM change: React and the syntax
  // highlighter replace text nodes, which would leave stale ranges.
  const locate = useCallback(() => {
    const out: Located[] = []
    for (const n of latest.current.notes) {
      for (const root of anchorRoots(n.anchor)) {
        const range = findQuote(root, n.anchor, n.quote)
        if (range) out.push({ key: n.key, root, range })
      }
    }
    located.current = out
    paintAll()
  }, [paintAll])

  useLayoutEffect(locate)

  useEffect(() => {
    let raf = 0
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(locate)
    })
    obs.observe(document.body, { subtree: true, childList: true, characterData: true })
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
      for (const name of ['tdm-note', 'tdm-note-hot', 'tdm-pending']) paint(name, [])
    }
  }, [locate])

  const openFromPill = useCallback(() => {
    const at = latest.current.pill
    if (!at) return
    const range = at.range
    setPill(null)
    setCard(null)
    window.getSelection()?.removeAllRanges()
    if (latest.current.ctx.selection) latest.current.ctx.setSelection(null)
    setEditor({ anchor: at.anchor, quote: at.quote, range, getRect: () => lastRect(range), host: hostOf(at.root), initial: '' })
  }, [])

  // The selection → pill.
  useEffect(() => {
    let down = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (latest.current.editor) return
      const c = capture(window.getSelection())
      const anchor = c && allowed(latest.current.ctx, c)
      setPill(c && anchor ? { ...c, anchor } : null)
    }
    const later = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(check, ms)
    }
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('.tn-pill')) return
      down = true
    }
    const onUp = () => {
      down = false
      later(0)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key.startsWith('Arrow')) later(0)
    }
    const onSelection = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        clearTimeout(timer)
        if (latest.current.pill) setPill(null)
      } else if (!down) later(250) // touch handles and keyboard selection
    }
    const onKey = (e: Event) => {
      const what = (e as CustomEvent<string>).detail
      if (what === 'open') openFromPill()
      else if (what === 'dismiss') {
        setPill(null)
        window.getSelection()?.removeAllRanges()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onSelection)
    document.addEventListener(TEXT_NOTE_EVENT, onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onSelection)
      document.removeEventListener(TEXT_NOTE_EVENT, onKey)
    }
  }, [openFromPill])

  // Badges and highlighted text → the card.
  useEffect(() => {
    const badgeOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.tn-badge') : null)
    const fromBadge = (b: HTMLElement, pinned: boolean): Card => ({
      keys: (b.dataset.tnNotes ?? '').split(' ').filter(Boolean),
      getRect: () => (b.isConnected ? b.getBoundingClientRect() : null),
      host: hostOf(b),
      pinned,
    })
    const setHot = (key: string | null) => {
      if (hot.current === key) return
      hot.current = key
      paintAll()
    }
    const onOver = (e: MouseEvent) => {
      const b = badgeOf(e.target)
      if (b) showCard(fromBadge(b, false))
    }
    const onOut = (e: MouseEvent) => {
      if (badgeOf(e.target) && !badgeOf(e.relatedTarget)) hideCard()
    }
    const onFocusIn = (e: FocusEvent) => {
      const b = badgeOf(e.target)
      if (b) showCard(fromBadge(b, false))
    }
    const onFocusOut = (e: FocusEvent) => {
      const into = e.relatedTarget instanceof Element ? e.relatedTarget : null
      if (badgeOf(e.target) && !into?.closest('.tn-card')) hideCard()
    }
    const onClick = (e: MouseEvent) => {
      const b = badgeOf(e.target)
      if (!b) {
        const c = latest.current.card
        if (c?.pinned && !(e.target instanceof Element && e.target.closest('.tn-card'))) setCard(null)
        return
      }
      const next = fromBadge(b, true)
      const c = latest.current.card
      setCard(c?.pinned && c.keys.join(' ') === next.keys.join(' ') ? null : next)
    }
    let raf = 0
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf)
      const { clientX: x, clientY: y, target } = e
      raf = requestAnimationFrame(() => {
        const root = target instanceof Element ? target.closest(ROOT) : null
        const hit = root ? located.current.find((l) => l.root === root && hits(l.range, x, y)) : undefined
        if (hit) {
          setHot(hit.key)
          if (latest.current.card?.keys.join(' ') !== hit.key) {
            const range = hit.range
            showCard({ keys: [hit.key], getRect: () => live(range)?.getClientRects()[0] ?? null, host: hostOf(root), pinned: false })
          } else keepCard()
        } else if (hot.current) {
          setHot(null)
          hideCard()
        }
      })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && latest.current.card) setCard(null)
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('click', onClick)
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(hideTimer.current)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('click', onClick)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('keydown', onKey)
    }
  }, [showCard, hideCard, keepCard, paintAll])

  const closeEditor = () => setEditor(null)
  useEffect(paintAll, [editor, paintAll])

  const cardNotes = card ? card.keys.flatMap((k) => notes.filter((n) => n.key === k)) : []
  const edit = (n: TextNote) => {
    // The copy of the text next to the card: a block can show in the thread and in the modal.
    const host = card?.host ?? document.body
    const range = located.current.find((l) => l.key === n.key && hostOf(l.root) === host)?.range ?? null
    const fallback = card?.getRect ?? (() => null)
    setCard(null)
    setEditor({
      anchor: n.anchor,
      quote: n.quote,
      range,
      getRect: () => (live(range) ? lastRect(range!) : fallback()),
      host,
      draftId: n.draftId,
      initial: n.text,
    })
  }

  const portal = (node: ReactNode, host: Element) => createPortal(node, host.isConnected ? host : document.body)
  return (
    <>
      {pill && !editor && portal(<Pill at={pill} onOpen={openFromPill} />, hostOf(pill.root))}
      {editor &&
        portal(
          <NoteEditor
            editor={editor}
            onCancel={closeEditor}
            onSave={(text) => {
              if (editor.draftId) ctx.updateDraft(editor.draftId, text)
              else ctx.addDraft(toDraft(editor.anchor, editor.quote, text))
              closeEditor()
            }}
          />,
          editor.host,
        )}
      {card &&
        !editor &&
        cardNotes.length > 0 &&
        portal(
          <NoteCard
            card={card}
            notes={cardNotes}
            onEnter={keepCard}
            onLeave={hideCard}
            onEdit={edit}
            onRemove={(n) => {
              setCard(null)
              if (n.draftId) ctx.removeDraft(n.draftId)
            }}
          />,
          card.host,
        )}
    </>
  )
}
