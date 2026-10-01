import { describe, expect, it } from 'vitest'
import { AGENT_QUIET_MS, agentQuietMinutes } from './agent'

const MIN = 60_000
const now = 1_790_000_000_000

describe('agentQuietMinutes', () => {
  it('uses a 10 minute threshold', () => {
    expect(AGENT_QUIET_MS).toBe(10 * MIN)
  })

  // Review Focus 4: a running tdm wait means the agent is connected, however long ago it started.
  it('is null while tdm wait runs', () => {
    expect(agentQuietMinutes({ waiting: true, agentSeenAt: now - 60 * MIN }, now)).toBeNull()
  })

  // Review Focus 5: no agentSeenAt (daemon restarted, agent not seen yet) is no evidence of silence.
  it('is null when the daemon has not seen the agent', () => {
    expect(agentQuietMinutes({ waiting: false }, now)).toBeNull()
  })

  it('is null below the threshold', () => {
    expect(agentQuietMinutes({ waiting: false, agentSeenAt: now - AGENT_QUIET_MS + 1 }, now)).toBeNull()
  })

  it('returns whole minutes from the threshold on', () => {
    expect(agentQuietMinutes({ waiting: false, agentSeenAt: now - AGENT_QUIET_MS }, now)).toBe(10)
    expect(agentQuietMinutes({ waiting: false, agentSeenAt: now - 17 * MIN - 59_000 }, now)).toBe(17)
  })
})
