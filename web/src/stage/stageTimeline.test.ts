import { describe, expect, it } from 'vitest'
import type { Stage } from '../api/types'
import { stageTimeline } from './stageTimeline'

describe('stageTimeline (stage summary flow spec, part E)', () => {
  const stage: Stage = {
    id: 'st_1',
    title: 'Data model',
    status: 'summary_proposed',
    threadIds: [],
    proposedSummary: 's2',
    proposalVersion: 2,
    proposals: [
      { text: 's1', seq: 20 },
      { text: 's2', seq: 25 },
    ],
    messages: [
      { actor: 'user', text: 'Mention blobs.', seq: 22 },
      { actor: 'ai', text: 'Revised.', seq: 24 },
    ],
  }

  it('interleaves messages and earlier summary proposals by seq, leaving out the live one', () => {
    expect(stageTimeline(stage).map((i) => (i.kind === 'message' ? `${i.message.actor}:${i.message.text}` : `v${i.version}`))).toEqual([
      'v1',
      'user:Mention blobs.',
      'ai:Revised.',
    ])
    expect(stageTimeline({ ...stage, status: 'accepted', summary: 's2' }).filter((i) => i.kind === 'proposal')).toHaveLength(1)
    expect(stageTimeline({ id: 'st_2', title: 'API', status: 'open', threadIds: [] })).toEqual([])
  })

  it('lists the AI\'s newest summary as an earlier version once the user edited it, and never twice otherwise', () => {
    const versions = (s: Stage) => stageTimeline(s).flatMap((i) => (i.kind === 'proposal' ? [`v${i.version}:${i.text}`] : []))
    expect(versions({ ...stage, proposedSummary: 's2 edited', editedByUser: true })).toEqual(['v1:s1', 'v2:s2'])
    expect(versions({ ...stage, status: 'accepted', proposedSummary: undefined, summary: 's2 edited' })).toEqual(['v1:s1', 'v2:s2'])
    expect(versions(stage)).toEqual(['v1:s1'])
    expect(versions({ ...stage, status: 'accepted', proposedSummary: undefined, summary: 's2' })).toEqual(['v1:s1'])
  })
})
