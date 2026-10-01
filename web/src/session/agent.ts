// Feature review t_6: after this long without a CLI call from the agent, and with no tdm wait
// running, the page says the AI may have stopped.
export const AGENT_QUIET_MS = 10 * 60 * 1000

// agentQuietMinutes returns how many whole minutes the agent has been silent, or null when it is
// not considered silent: tdm wait is running, the daemon has not seen it (agentSeenAt absent), or
// the silence is shorter than AGENT_QUIET_MS.
export function agentQuietMinutes(s: { waiting: boolean; agentSeenAt?: number }, now: number): number | null {
  if (s.waiting || s.agentSeenAt === undefined) return null
  const silent = now - s.agentSeenAt
  return silent >= AGENT_QUIET_MS ? Math.floor(silent / 60_000) : null
}
