import { useEffect } from 'react'
import type { SessionCtx } from './context'
import { navOrder } from './nav'
import { TEXT_NOTE_EVENT, hasTextNotePill } from '../textnote/dom'

export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>

// RESOLVE_NOTE_EVENT asks the open thread's ResolveThread to open its note editor (the `c` key
// with no line selected). A document event keeps every key binding in handleShortcut, without
// lifting the editor's state into the session context.
export const RESOLVE_NOTE_EVENT = 'tdm:resolve-note'

// ACCEPT_CONCLUSION_EVENT asks the open thread's ConclusionCard to accept its proposal (the `a`
// key), so the key goes through the card's in-flight guard and its onResolved auto-advance.
export const ACCEPT_CONCLUSION_EVENT = 'tdm:accept-conclusion'

export interface ShortcutEnv {
  ctx: SessionCtx
  current: string
  select(id: string): void
}

// jsdom does not implement `isContentEditable` (it stays `undefined` even when the attribute
// or property is set), so this branch is untested under vitest/jsdom; it is correct in real
// browsers, which compute it for the element and its editable descendants.
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select')) return true
  return target instanceof HTMLElement && target.isContentEditable
}

// isEditingConclusion is true while the conclusion card's own editor is mounted, keyed off its
// accessible name rather than component state: `a` must be skipped even once focus has left that
// textarea (M5), so checking `document.activeElement` would not be enough.
function isEditingConclusion(): boolean {
  return document.querySelectorAll('textarea[aria-label="Edit conclusion"]').length > 0
}

// handleShortcut implements j/k, c, a and Escape; it returns true when the key was handled.
export function handleShortcut(e: KeyLike, { ctx, current, select }: ShortcutEnv): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return false
  // While a block is expanded in the modal, only the keys that act on its line selection (c, Escape)
  // apply: nothing moves or resolves behind it (the dialog's own Escape closes it).
  const modal = ctx.expandedBlock !== null
  switch (e.key) {
    case 'j':
    case 'k': {
      if (modal) return false
      const order = navOrder(ctx.state)
      const next = order[order.indexOf(current) + (e.key === 'j' ? 1 : -1)]
      if (!next) return false
      select(next)
      return true
    }
    case 'c': {
      // Selected text wins (its 💬 Note pill is up), then a line selection, as before.
      if (hasTextNotePill()) {
        document.dispatchEvent(new CustomEvent(TEXT_NOTE_EVENT, { detail: 'open' }))
        return true
      }
      if (ctx.selection) {
        if (ctx.selection.editing) return false
        ctx.setSelection({ ...ctx.selection, editing: true })
        return true
      }
      // No selection: add a note and resolve an open thread (follow-ups B).
      const t = ctx.state.threads[current]
      if (modal || ctx.readOnly || !t || t.status !== 'open') return false
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: t.id } }))
      return true
    }
    case 'a': {
      const t = ctx.state.threads[current]
      if (modal || ctx.readOnly || !t || t.status !== 'conclusion_proposed' || isEditingConclusion()) return false
      document.dispatchEvent(new CustomEvent(ACCEPT_CONCLUSION_EVENT, { detail: { threadId: t.id } }))
      return true
    }
    case 'Escape':
      if (hasTextNotePill()) {
        document.dispatchEvent(new CustomEvent(TEXT_NOTE_EVENT, { detail: 'dismiss' }))
        return true
      }
      if (!ctx.selection) return false
      ctx.setSelection(null)
      return true
  }
  return false
}

export function useShortcuts(ctx: SessionCtx, current: string, select: (id: string) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleShortcut(e, { ctx, current, select })) e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ctx, current, select])
}
