import { useCallback, useEffect, useState } from 'react'
import type { Message, State, Thread } from '../api/types'

export function navOrder(state: State): string[] {
  return state.stages.flatMap((s) => [s.id, ...s.threadIds])
}

export function isValidItem(state: State, id: string): boolean {
  return !!id && (id in state.threads || state.stages.some((s) => s.id === id))
}

// ItemAnchor is where an id that lives inside a thread or a stage page points: the item to open and
// the element to scroll to (question message spec, part A).
export interface ItemAnchor {
  itemId: string
  selector: string
}

// anchorOf maps an id that lives inside a thread or a stage page to that item and its element: a
// variant option (o_N) to its card, and a question (q_N) or one of its options to the question
// bubble (question message spec), in a thread or on a stage page (demo 7 follow-ups 6), and a
// process (p_N) to its card in the process's thread. Other ids, and ids the session does not
// know, have no anchor.
export function anchorOf(state: State, id: string): ItemAnchor | undefined {
  if (!/^[oqp]_\d+$/.test(id)) return undefined
  if (id.startsWith('p_')) {
    const proc = state.processes?.[id]
    return proc && proc.threadId in state.threads ? { itemId: proc.threadId, selector: `[id="${id}"]` } : undefined
  }
  for (const b of Object.values(state.blocks))
    if (b.variants?.options.some((o) => o.id === id)) return { itemId: b.threadId, selector: `[data-option="${id}"]` }
  const items: { id: string; messages?: Message[] }[] = [...Object.values(state.threads), ...state.stages]
  for (const item of items)
    for (const m of item.messages ?? []) {
      const q = m.question
      if (q && (q.id === id || q.options.some((o) => o.id === id))) return { itemId: item.id, selector: `[data-question="${q.id}"]` }
    }
  return undefined
}

// ScrollRequest asks the page to bring an element into view. Every visit to an anchor makes a
// new object, so a second click on the same chip scrolls again.
export interface ScrollRequest {
  selector: string
}

// defaultItem opens the first unresolved thread in stage/thread order (feature review t_5): a
// proposed conclusion or summary no longer jumps ahead. With every thread resolved it opens the
// first stage whose summary awaits the user, else the last stage.
export function defaultItem(state: State): string {
  const threads = state.stages.flatMap((s) => s.threadIds.map((id) => state.threads[id]).filter(Boolean))
  const open = threads.find((t) => t.status !== 'resolved')
  if (open) return open.id
  const summary = state.stages.find((s) => s.status === 'summary_proposed')
  if (summary) return summary.id
  return state.stages.at(-1)?.id ?? ''
}

// nextAfterResolve picks what to show after the user resolves threadId (via Accept, Accept
// edited, Resolve, or Choose & resolve): the next unresolved thread after it in navOrder,
// wrapping to the first unresolved thread before it if none follow, or the thread's own stage
// if no unresolved thread remains.
export function nextAfterResolve(state: State, threadId: string): string {
  const order = navOrder(state)
  const idx = order.indexOf(threadId)
  const isOpen = (id: string) => id !== threadId && id in state.threads && state.threads[id].status !== 'resolved'
  for (let i = idx + 1; i < order.length; i++) if (isOpen(order[i])) return order[i]
  for (let i = 0; i < idx; i++) if (isOpen(order[i])) return order[i]
  return state.threads[threadId]?.stageId ?? order[idx] ?? ''
}

// nextAfterStageAccept picks what to show after the user accepts stageId's summary (stage summary
// flow, part B): the first unresolved thread of the stage right after it, else that stage's page.
// null while no stage follows it: the page then waits for the AI to add one.
export function nextAfterStageAccept(state: State, stageId: string): string | null {
  const i = state.stages.findIndex((s) => s.id === stageId)
  const next = i < 0 ? undefined : state.stages[i + 1]
  if (!next) return null
  return next.threadIds.find((id) => id in state.threads && state.threads[id].status !== 'resolved') ?? next.id
}

export function statusIcon(t: Thread): string {
  if (t.status === 'resolved') return '✓'
  if (t.status === 'conclusion_proposed') return '◆'
  return '○'
}

// useCurrentItem keeps the selected stage/thread in location.hash (#t_3, #st_1).
// Once an item is shown (because the hash was empty or invalid), it is pinned: the chosen
// default is written to the hash with history.replaceState (no history entry added), so a
// later snapshot change that would move defaultItem elsewhere does not move the view. The
// user's explicit selection and hashchange still take effect. If the pinned item becomes
// invalid (e.g. removed from state), the default is recomputed.
// A hash that names an anchor (#o_2, from an option chip) opens the anchor's thread or stage: the
// hash is rewritten to the item id the same way, and the third value asks the page to scroll to
// the anchor (question message spec, part A).
export function useCurrentItem(state: State): [string, (id: string) => void, ScrollRequest | null] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1))
  const [scrollTo, setScrollTo] = useState<ScrollRequest | null>(null)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const select = useCallback((id: string) => {
    if (window.location.hash.slice(1) !== id) window.location.hash = id
    setHash(id)
  }, [])
  const valid = isValidItem(state, hash)
  const anchor = valid ? undefined : anchorOf(state, hash)
  const current = valid ? hash : (anchor?.itemId ?? defaultItem(state))
  const anchorSelector = anchor?.selector
  useEffect(() => {
    if (isValidItem(state, hash) || !current) return
    // Pin the shown item (the anchor's thread or the default) to the hash, with no history
    // entry, so a later snapshot change that would move defaultItem elsewhere does not move the
    // view out from under the user, and a second click on the same chip changes the hash again.
    window.history.replaceState(null, '', '#' + current)
    setHash(current)
    if (anchorSelector) setScrollTo({ selector: anchorSelector })
  }, [state, hash, current, anchorSelector])
  return [current, select, scrollTo]
}
