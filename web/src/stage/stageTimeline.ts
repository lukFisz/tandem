import type { Message, Stage } from '../api/types'
import { earlierProposals } from '../proposal/proposals'

export type StageTimelineItem = { kind: 'message'; seq: number; message: Message } | { kind: 'proposal'; seq: number; version: number; text: string }

// stageTimeline orders a stage page's conversation by event seq (stage summary flow spec, part E):
// its messages and its earlier summary proposals. The newest proposal is not listed while the live
// card or the accepted summary shows its text.
export function stageTimeline(stage: Stage): StageTimelineItem[] {
  const items: StageTimelineItem[] = (stage.messages ?? []).map((message) => ({ kind: 'message', seq: message.seq, message }))
  const shown = stage.status === 'accepted' ? stage.summary : stage.status === 'summary_proposed' ? stage.proposedSummary : undefined
  for (const p of earlierProposals(stage.proposals, shown)) items.push({ kind: 'proposal', ...p })
  return items.sort((a, b) => a.seq - b.seq)
}
