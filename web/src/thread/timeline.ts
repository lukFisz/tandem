import type { Block, Message, Process, State, Thread, ThreadComment, ThreadMessageComment } from '../api/types'
import { earlierProposals } from '../proposal/proposals'
import { questionTitle } from '../refs/ids'

export type TimelineItem =
  | { kind: 'block'; seq: number; block: Block }
  | { kind: 'message'; seq: number; message: Message }
  | { kind: 'proposal'; seq: number; version: number; text: string }
  | { kind: 'process'; seq: number; process: Process }

// timeline orders a thread's blocks, chat messages and earlier conclusion proposals (stage summary
// flow spec, part D) by event seq. The newest proposal is not listed while the live card or the
// accepted conclusion shows its text.
export function timeline(state: State, thread: Thread): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const id of thread.blockIds) {
    const block = state.blocks[id]
    if (block) items.push({ kind: 'block', seq: block.seq, block })
  }
  for (const message of thread.messages) items.push({ kind: 'message', seq: message.seq, message })
  for (const proc of Object.values(state.processes ?? {})) {
    if (proc.threadId === thread.id) items.push({ kind: 'process', seq: proc.seq, process: proc })
  }
  const shown = thread.status === 'resolved' ? thread.conclusion : thread.status === 'conclusion_proposed' ? thread.proposedConclusion : undefined
  for (const p of earlierProposals(thread.proposals, shown)) items.push({ kind: 'proposal', ...p })
  return items.sort((a, b) => a.seq - b.seq)
}

// choiceTitle is the title of the variant option a user message was sent with (its id if the
// option is unknown), or undefined for a message without a choice.
export function choiceTitle(state: State, message: Message): string | undefined {
  const c = message.choice
  if (!c) return undefined
  return state.blocks[c.blockId]?.variants?.options.find((o) => o.id === c.optionId)?.title ?? c.optionId
}

// QuestionRef names the question an answer message answers, by id and by title.
export interface QuestionRef {
  id: string
  title: string
}

// answeredQuestion is the question a user message answers (Message.answerTo), titled by the
// question's first line like its q_N chip, or by its id when the question is not in the thread or
// on the stage page (demo 7 follow-ups 6). Undefined for any other message (demo 6 follow-ups 1).
export function answeredQuestion(item: { messages?: Message[] }, message: Message): QuestionRef | undefined {
  const id = message.answerTo
  if (!id) return undefined
  const asked = item.messages?.find((m) => m.question?.id === id)
  return { id, title: asked ? questionTitle(asked.text) : id }
}

// answerParts splits an answer message's text (domain.AnswerMessage: "Answered: <title>" or
// 'Answered: "<free text>"') into its label and value, so MessageView can render "Answered" as a
// muted header and the value with emphasis, instead of running the two together. `custom` marks a
// free-text answer (its quotes are stripped). Undefined for any text without the prefix.
export function answerParts(text: string): { answer: string; custom: boolean } | undefined {
  const prefix = 'Answered: '
  if (!text.startsWith(prefix)) return undefined
  const rest = text.slice(prefix.length)
  if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) return { answer: rest.slice(1, -1), custom: true }
  return { answer: rest, custom: false }
}

// sentComments lists the comments sent together with a user message (they share its seq): line
// comments, then comments on chat messages.
export function sentComments(thread: Thread, message: Message): (ThreadComment | ThreadMessageComment)[] {
  if (message.actor !== 'user') return []
  return [...thread.comments, ...thread.messageComments].filter((c) => c.seq === message.seq)
}

// lineCommentsLabel heads a message sent with n comments; `quoted` when some are on selected text.
export function lineCommentsLabel(n: number, quoted = false): string {
  return `${n} ${quoted ? '' : 'line '}comment${n === 1 ? '' : 's'}`
}
