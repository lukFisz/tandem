// Mirrors the JSON of internal/domain (State) and the daemon snapshot {state, waiting, agentSeenAt, processOutput}.
export type Actor = 'ai' | 'user' | 'system'
export type SessionStatus = 'active' | 'closed'
export type StageStatus = 'open' | 'summary_proposed' | 'accepted'
export type ThreadStatus = 'open' | 'conclusion_proposed' | 'resolved'
export type BlockKind = 'note' | 'code' | 'file' | 'markdown' | 'variants'
export type ProcessStatus = 'running' | 'exited'

export interface LineRange {
  start: number
  end: number
}

export interface BlockContent {
  type: BlockKind
  lang?: string
  text?: string
  path?: string
  blobSha?: string
  /** File blocks: blob of the whole file's unified diff against git HEAD, when it has changes. */
  diffSha?: string
  firstLine?: number
  lineCount?: number
}

export interface VariantOption {
  id: string
  title: string
  description?: string
  pros?: string[]
  cons?: string[]
  blocks?: BlockContent[]
}

export interface Variants {
  title?: string
  options: VariantOption[]
}

export interface Annotation {
  lines: LineRange
  text: string
}

export interface Block extends BlockContent {
  id: string
  threadId: string
  seq: number
  variants?: Variants
  annotations: Annotation[]
  supersededBy?: string
  chosenOption?: string
  rejected?: boolean
}

export interface MessageChoice {
  blockId: string
  optionId: string
}

export interface QuestionOption {
  id: string
  title: string
}

/** Exactly one of the two is set. */
export interface QuestionAnswer {
  optionId?: string
  other?: string
}

/** Mirrors domain.MessageQuestion: an AI message with answer buttons (question message spec). */
export interface MessageQuestion {
  id: string
  options: QuestionOption[]
  answer?: QuestionAnswer
  withdrawn?: boolean
}

export interface Message {
  actor: Actor
  text: string
  seq: number
  /** Set on a user message sent with a variant choice (its text may be empty). */
  choice?: MessageChoice
  /** Set on an AI message that asks a question; its text is the question. */
  question?: MessageQuestion
  /** Set on the user message an answer adds: the question (q_N) it answers (demo 6 follow-ups 1). */
  answerTo?: string
}

export interface LineComment {
  blockId: string
  lines: LineRange
  /** The text the user selected within `lines`; absent on a plain line comment. */
  quote?: string
  text: string
}

/** A comment on text selected in a thread's chat message, named by the message's seq. */
export interface MessageComment {
  messageSeq: number
  quote: string
  text: string
}

/** A line comment the user sent. `seq` is the review's seq; the user message of that review has the same seq. */
export interface ThreadComment extends LineComment {
  seq: number
}

/** A message comment the user sent; `seq` is the review's seq, as on ThreadComment. */
export interface ThreadMessageComment extends MessageComment {
  seq: number
}

/** One AI proposal of a conclusion or stage summary; proposals[i] is version i + 1 (stage summary flow spec, part D). */
export interface Proposal {
  text: string
  seq: number
}

export interface Thread {
  id: string
  stageId: string
  title: string
  status: ThreadStatus
  blockIds: string[]
  messages: Message[]
  comments: ThreadComment[]
  messageComments: ThreadMessageComment[]
  proposedConclusion?: string
  /** Set while the proposed conclusion is the user's saved edit (conclusion.revised). */
  editedByUser?: boolean
  conclusion?: string
  lastUserSeq: number
  lastAiSeq: number
  /** How many times the AI proposed; absent before the first proposal. */
  proposalVersion?: number
  proposals?: Proposal[]
}

export interface Stage {
  id: string
  title: string
  goal?: string
  status: StageStatus
  proposedSummary?: string
  /** Set while the proposed summary is the user's saved edit (summary.revised). */
  editedByUser?: boolean
  summary?: string
  /** Seq of the stage.summary.accepted event; absent before the accept (and in older snapshots). */
  acceptedSeq?: number
  threadIds: string[]
  /** How many times the AI proposed; absent before the first proposal. */
  proposalVersion?: number
  proposals?: Proposal[]
  /** The stage page's conversation (stage summary flow spec, part E); absent until the first message. */
  messages?: Message[]
  lastUserSeq?: number
  lastAiSeq?: number
}

export interface Session {
  id: string
  title: string
  projectId: string
  status: SessionStatus
}

export interface Process {
  id: string
  threadId: string
  pid: number
  cmd: string
  status: ProcessStatus
  seq: number
  startedAt: number
  exitCode?: number
  exitedAt?: number
  /** Path of the file the command's output goes to. */
  out?: string
}

export interface State {
  session: Session
  stages: Stage[]
  threads: Record<string, Thread>
  blocks: Record<string, Block>
  processes?: Record<string, Process>
  lastSeq: number
  lastAiSeq: number
  delivered: number
  endRequested: boolean
}

export interface Snapshot {
  state: State
  waiting: boolean
  /** Unix ms of the agent's last CLI call (or tdm wait start/end); absent until the daemon has seen it. */
  agentSeenAt?: number
  /** Process id -> last up-to-3 output lines joined with "\n"; always present after normalization. */
  processOutput: Record<string, string>
}

export interface SessionSummary {
  id: string
  title: string
  status: SessionStatus
  projectName: string
  active: boolean
}

export interface ReviewThread {
  threadId: string
  comments?: LineComment[]
  messageComments?: MessageComment[]
  message?: string
}

export interface SubmitReview {
  threads: ReviewThread[]
}

export type Action =
  | { type: 'review.submit'; data: SubmitReview }
  | { type: 'variant.choose'; data: { blockId: string; optionId: string; comment?: string; resolve?: boolean } }
  | { type: 'thread.resolve'; data: { threadId: string; text?: string } }
  | { type: 'variants.reject'; data: { blockId: string; comment: string } }
  | { type: 'question.answer'; data: { questionId: string; optionId?: string; other?: string } }
  | { type: 'conclusion.accept'; data: { threadId: string } }
  | { type: 'conclusion.revise'; data: { threadId: string; text: string; baseVersion: number } }
  | { type: 'conclusion.discuss'; data: { threadId: string; comment: string } }
  | { type: 'stage.accept'; data: { stageId: string } }
  | { type: 'stage.revise'; data: { stageId: string; text: string; baseVersion: number } }
  | { type: 'stage.message'; data: { stageId: string; text: string } }
  | { type: 'session.end'; data: { comment?: string } }

/* eslint-disable @typescript-eslint/no-explicit-any */
// normalizeSnapshot turns Go's null slices into [] so the rest of the UI never checks for null.
export function normalizeSnapshot(raw: unknown): Snapshot {
  const r = raw as any
  const st = r.state
  const stages: Stage[] = (st.stages ?? []).map((s: any) => ({ ...s, threadIds: s.threadIds ?? [] }))
  const threads: Record<string, Thread> = {}
  for (const [id, t] of Object.entries<any>(st.threads ?? {})) {
    threads[id] = { ...t, blockIds: t.blockIds ?? [], messages: t.messages ?? [], comments: t.comments ?? [], messageComments: t.messageComments ?? [] }
  }
  const blocks: Record<string, Block> = {}
  for (const [id, b] of Object.entries<any>(st.blocks ?? {})) {
    blocks[id] = { ...b, annotations: b.annotations ?? [] }
  }
  const processes: Record<string, Process> = { ...(st.processes ?? {}) }
  const agentSeenAt = typeof r.agentSeenAt === 'number' ? { agentSeenAt: r.agentSeenAt as number } : {}
  const processOutput: Record<string, string> = { ...(r.processOutput ?? {}) }
  return { waiting: Boolean(r.waiting), ...agentSeenAt, processOutput, state: { ...st, stages, threads, blocks, processes } }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// awaitingAI mirrors domain.Thread.AwaitingAI.
export function awaitingAI(t: Thread): boolean {
  return t.status !== 'resolved' && t.lastUserSeq > t.lastAiSeq
}

// isOpenQuestion is true for a question that is neither answered nor withdrawn. Shared by
// openQuestion below and Task 8's nav dot, so the predicate lives in exactly one place.
export function isOpenQuestion(q: MessageQuestion): boolean {
  return !q.answer && !q.withdrawn
}

// openQuestion is the latest question of a thread or a stage page (demo 7 follow-ups 6) that is
// neither answered nor withdrawn.
export function openQuestion(item: { messages?: Message[] }): MessageQuestion | undefined {
  const messages = item.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const q = messages[i].question
    if (q && isOpenQuestion(q)) return q
  }
  return undefined
}
