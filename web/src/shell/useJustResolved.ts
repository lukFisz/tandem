import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Thread, ThreadStatus } from '../api/types'

// How long a nav row keeps `is-just-resolved`: longer than both CSS animations (1 s flash,
// 0.45 s pop). A timeout, not animationend, so the class also drops under reduced motion,
// where no animation runs.
export const JUST_RESOLVED_MS = 1200

// newlyResolved lists threads that were known and not resolved in prev, and are resolved now.
// prev is null on the first render, so the initial load reports nothing.
export function newlyResolved(prev: ReadonlyMap<string, ThreadStatus> | null, threads: Record<string, Thread>): string[] {
  if (!prev) return []
  return Object.values(threads)
    .filter((t) => t.status === 'resolved' && prev.has(t.id) && prev.get(t.id) !== 'resolved')
    .map((t) => t.id)
}

// useJustResolved (resolve feedback 2) returns the threads whose status changed to resolved while
// the page was live, for JUST_RESOLVED_MS. `live` is connection === 'open'. A reconnect snapshot
// arrives in the same render as `live` turning true, after a render where it was false, so
// threads resolved during the outage don't flash.
export function useJustResolved(threads: Record<string, Thread>, live: boolean): ReadonlySet<string> {
  const seen = useRef<Map<string, ThreadStatus> | null>(null)
  const wasLive = useRef(live)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [just, setJust] = useState<ReadonlySet<string>>(() => new Set())

  // A layout effect so the class lands before paint: the ✓ must not show for a frame and then pop.
  useLayoutEffect(() => {
    const ids = wasLive.current ? newlyResolved(seen.current, threads) : []
    seen.current = new Map(Object.values(threads).map((t) => [t.id, t.status]))
    wasLive.current = live
    if (ids.length === 0) return
    setJust((s) => new Set([...s, ...ids]))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setJust((s) => new Set([...s].filter((id) => !ids.includes(id))))
    }, JUST_RESOLVED_MS)
    timers.current.add(timer)
  }, [threads, live])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return just
}
