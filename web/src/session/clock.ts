import { useEffect, useState } from 'react'

// Often enough that "AI quiet for Nm" flips within half a minute of crossing the threshold.
export const CLOCK_TICK_MS = 30_000

// useNow returns Date.now(), refreshed every tickMs, so time-based UI changes without a snapshot.
export function useNow(tickMs: number = CLOCK_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])
  return now
}
