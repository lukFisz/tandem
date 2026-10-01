import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { prefersReducedMotion } from './motion'

const NEAR_BOTTOM_PX = 120

export interface FollowBottom {
  /** True when new content arrived while the user was scrolled up: shows the "New below ↓" pill. */
  showPill: boolean
  /** Scrolls the container to the bottom and clears the pill. Respects prefers-reduced-motion. */
  scrollToBottom(): void
  /**
   * Arms a forced follow: the next time the current item's content grows, it scrolls to the
   * bottom even if the user isn't near it (any successful user action — choosing a variant,
   * rejecting all, requesting changes, sending — is "I acted, now show me the reply"). Consumed
   * after firing once, on a manual scroll, or on switching to a different item.
   */
  arm(): void
  /**
   * Drops a pending scroll restore (see the item-switch branch): a jump to a specific element
   * (SessionPage's id chips and comment jumps) wins over the restored position, so it calls this
   * when it scrolls.
   */
  cancelRestore(): void
}

// How long a restored position waits for late content (file/markdown blocks load their text
// after mount) before giving up.
const RESTORE_TIMEOUT_MS = 3000
// Input that means the user is scrolling on their own. A scroll event alone does not: the browser
// fires one for its own clamping and for our writes too.
const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const

// isBlockingFocus is true when focus sits in an input/textarea that is not the composer's own
// (the composer's own send is exempt: it is fine to scroll while the user is still typing there).
function isBlockingFocus(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return false
  return !el.closest('.composer')
}

function itemOf(contentKey: string): string {
  return contentKey.split(':', 1)[0]
}

// useFollowBottom makes a scroll container follow new content like a chat app: it scrolls to
// the bottom when contentKey changes (new timeline items, a newly proposed conclusion/summary)
// and the user is near the bottom already, and otherwise surfaces a "New below" pill instead of
// yanking the scroll position. Switching to a different item (a different leading segment of
// contentKey, conventionally "<itemId>:...") resets state without showing the pill, and restores
// that item's own scroll position (demo 7 follow-ups 3, see the switch branch below).
// landOn, when it returns an element for a same-item change, is scrolled to its start instead (demo2
// follow-up 6). On a return to an item it is asked too, and wins over the restored position.
export function useFollowBottom(
  containerRef: RefObject<HTMLElement | null>,
  contentKey: string,
  landOn?: () => HTMLElement | null,
): FollowBottom {
  const [showPill, setShowPill] = useState(false)
  const prevKey = useRef(contentKey)
  // Whether the user was near the bottom BEFORE the content that is about to be measured
  // arrived. New content already grows scrollHeight by the time an effect can see it (the DOM
  // commit runs first), so "near bottom" has to be tracked continuously via scroll events
  // instead of recomputed after the fact — otherwise added content always reads as "far away".
  const wasNearBottom = useRef(true)
  // Set by arm() after a successful user action; consumed (cleared) the next time it fires, on
  // a manual scroll, or when the item switches — see FollowBottom.arm's doc comment.
  const armed = useRef(false)
  // Read at effect time, so callers may pass a fresh closure on every render.
  const landOnRef = useRef(landOn)
  landOnRef.current = landOn
  // Demo 7 follow-ups 3: where the user left each item, for the page session. `top` is the
  // scrollTop of the item on screen, tracked on every scroll (by the time the switch effect runs,
  // the next item's content is already in the container); `bottom` records that the user was
  // following that item's bottom.
  const positions = useRef(new Map<string, { top: number; bottom: boolean }>())
  const lastTop = useRef(0)
  // A restored position the item's content could not reach yet at the switch (its file/markdown
  // blocks were still loading, so the browser clamped scrollTop): re-applied as the content grows,
  // see startRestore below. While set, it is where the user "is" on this item.
  const pending = useRef<{ item: string; top: number; bottom: boolean } | null>(null)
  const stopPending = useRef<(() => void) | null>(null)

  const cancelRestore = useCallback(() => {
    pending.current = null
    stopPending.current?.()
    stopPending.current = null
  }, [])

  const nearBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
  }, [containerRef])

  const scrollToBottom = useCallback(() => {
    cancelRestore()
    const el = containerRef.current
    setShowPill(false)
    wasNearBottom.current = true
    armed.current = false
    lastTop.current = el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0
    // jsdom (used by the test suite) does not implement Element.scrollTo.
    if (!el || typeof el.scrollTo !== 'function') return
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [containerRef, cancelRestore])

  const arm = useCallback(() => {
    armed.current = true
  }, [])

  // Keeps re-applying `target` to the current item as its content grows, until it is reached, the
  // user scrolls on their own, the timeout passes, or cancelRestore() (another item switch, a
  // landing target, a jump, scrollToBottom). Without ResizeObserver (jsdom) it does nothing extra.
  const startRestore = useCallback(
    (el: HTMLElement, target: { item: string; top: number; bottom: boolean }) => {
      if (typeof ResizeObserver !== 'function') return
      pending.current = target
      wasNearBottom.current = target.bottom
      const apply = () => {
        const p = pending.current
        if (!p) return
        const max = Math.max(0, el.scrollHeight - el.clientHeight)
        const top = p.bottom ? max : Math.min(p.top, max)
        if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top
        lastTop.current = el.scrollTop
        // A bottom restore has no point where it is "reached": more content may still load, so it
        // keeps following until the user scrolls or the timeout.
        if (!p.bottom && max >= p.top - 1) {
          cancelRestore()
          wasNearBottom.current = nearBottom()
        }
      }
      const ro = new ResizeObserver(apply)
      // The container's own box does not change as its content grows; its children's do.
      for (const child of Array.from(el.children)) ro.observe(child)
      const onUser = () => {
        const p = pending.current
        cancelRestore()
        // The user takes over from where the content let them be.
        if (p) {
          lastTop.current = el.scrollTop
          wasNearBottom.current = nearBottom()
        }
      }
      for (const type of USER_SCROLL_EVENTS) el.addEventListener(type, onUser, { passive: true })
      const timer = setTimeout(() => {
        if (pending.current) onUser()
      }, RESTORE_TIMEOUT_MS)
      stopPending.current = () => {
        ro.disconnect()
        clearTimeout(timer)
        for (const type of USER_SCROLL_EVENTS) el.removeEventListener(type, onUser)
      }
      apply()
    },
    [cancelRestore, nearBottom],
  )
  useEffect(() => cancelRestore, [cancelRestore])

  // Tracks the user's scroll position continuously (and takes an initial reading on mount) so
  // the content-key effect below can consult it without disturbing it. Any manual scroll also
  // disarms: the user is looking around on their own, so a forced follow would be unwelcome.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    wasNearBottom.current = nearBottom()
    lastTop.current = el.scrollTop
    const onScroll = () => {
      // While a restore is pending, scroll events come from the browser's clamping or our own
      // writes, not the user (whose input cancels it first): the pending target stays where the
      // user is, so leaving now saves that instead of the clamped position.
      if (pending.current) return
      wasNearBottom.current = nearBottom()
      lastTop.current = el.scrollTop
      armed.current = false
      if (wasNearBottom.current) setShowPill(false)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [containerRef, nearBottom])

  // A layout effect (fix round 1, batch 2 review): navigation arrives through hashchange, a
  // default-priority update, so a passive effect could run after the browser has painted the new
  // item, clamped scrollTop to it and fired a scroll event, which onScroll would record as the
  // item being left (its top clamped, "near the bottom"). Running before paint saves the item
  // being left first, and shows the next item at its restored position without a one-frame flash.
  // It still runs before SessionPage's passive effects (landedKeys, the jump scroll), so a jump
  // still wins.
  useLayoutEffect(() => {
    const prev = prevKey.current
    prevKey.current = contentKey
    if (prev === contentKey) return
    if (itemOf(prev) !== itemOf(contentKey)) {
      // The container is the SAME DOM element across items (only its children swap), so nothing
      // resets scrollTop on its own (M3): set it explicitly before re-measuring, instead of keeping
      // the previous item's "near bottom" reading, which a later scroll event might not correct in
      // time (a height change alone fires no scroll event). An armed follow does not carry over to
      // the new item either — e.g. auto-advance after Accept already navigates, so this item switch
      // must not itself trigger a forced scroll.
      // Demo 7 follow-ups 3: remember where the user left the previous item, and put the next one
      // back where they left it: at its (possibly grown) bottom if they were following it there, at
      // its top if never visited. A landing target (landOn) wins over that, and a jump target
      // (SessionPage's scrollTo, applied after this effect) wins over both.
      // Late content: file/markdown blocks load their text after mount, so the returning item may
      // still be too short for its saved position, and the browser clamps it. The restore then
      // stays pending (startRestore) and is re-applied as the content grows. Leaving before it is
      // reached saves the pending target, not the clamped position.
      const left = pending.current?.item === itemOf(prev) ? pending.current : null
      cancelRestore()
      positions.current.set(
        itemOf(prev),
        left ? { top: left.top, bottom: left.bottom } : { top: lastTop.current, bottom: wasNearBottom.current },
      )
      const saved = positions.current.get(itemOf(contentKey))
      const el = containerRef.current
      if (el) el.scrollTop = !saved ? 0 : saved.bottom ? Math.max(0, el.scrollHeight - el.clientHeight) : saved.top
      lastTop.current = el?.scrollTop ?? 0
      wasNearBottom.current = nearBottom()
      armed.current = false
      setShowPill(false)
      const target = saved ? (landOnRef.current?.() ?? null) : null
      if (target) {
        if (typeof target.scrollIntoView === 'function')
          target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      } else if (el && saved && (saved.bottom || el.scrollTop < saved.top - 1)) {
        startRestore(el, { item: itemOf(contentKey), ...saved })
      }
      return
    }
    // Demo2 follow-up 6: content that must be read from its start (a newly proposed stage
    // summary) lands on that start instead of following the bottom, wherever the user was.
    const target = landOnRef.current?.() ?? null
    if (target) {
      cancelRestore()
      armed.current = false
      setShowPill(false)
      if (typeof target.scrollIntoView === 'function')
        target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      return
    }
    if (armed.current || (wasNearBottom.current && !isBlockingFocus())) scrollToBottom()
    else setShowPill(true)
  }, [contentKey, nearBottom, scrollToBottom, cancelRestore, startRestore])

  // Memoized so consumers that put the whole returned object into a dependency array (e.g.
  // SessionPage's ctx useMemo) don't see a new identity on every render when nothing here
  // actually changed — a fresh object literal would otherwise defeat that memoization (fix:
  // ctx-stability regression from round 2).
  return useMemo(
    () => ({ showPill, scrollToBottom, arm, cancelRestore }),
    [showPill, scrollToBottom, arm, cancelRestore],
  )
}
