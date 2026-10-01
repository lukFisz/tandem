import type { LineRange, ReviewThread, State, SubmitReview } from '../api/types'

// A draft comment is on lines of a block (with an optional quote: the text selected within them),
// or on text selected in a thread's chat message.
export interface DraftLineComment {
  id: string
  threadId: string
  blockId: string
  lines: LineRange
  quote?: string
  text: string
}

export interface DraftMessageComment {
  id: string
  threadId: string
  messageSeq: number
  quote: string
  text: string
}

export type DraftComment = DraftLineComment | DraftMessageComment

export type NewDraftComment = Omit<DraftLineComment, 'id'> | Omit<DraftMessageComment, 'id'>

export function isMessageComment(c: DraftComment): c is DraftMessageComment {
  return 'messageSeq' in c
}

/** The draft's line comments on one block. */
export function blockDrafts(d: Draft, blockId: string): DraftLineComment[] {
  return d.comments.filter((c): c is DraftLineComment => !isMessageComment(c) && c.blockId === blockId)
}

export interface Draft {
  comments: DraftComment[]
}

export const emptyDraft: Draft = { comments: [] }

export function addComment(d: Draft, c: NewDraftComment): Draft {
  return { comments: [...d.comments, { ...c, id: crypto.randomUUID() } as DraftComment] }
}

export function updateComment(d: Draft, id: string, text: string): Draft {
  return { comments: d.comments.map((c) => (c.id === id ? { ...c, text } : c)) }
}

export function removeComments(d: Draft, ids: string[]): Draft {
  if (ids.length === 0) return d
  const drop = new Set(ids)
  return { comments: d.comments.filter((c) => !drop.has(c.id)) }
}

export function countDraft(d: Draft, threadId?: string): number {
  return threadId ? d.comments.filter((c) => c.threadId === threadId).length : d.comments.length
}

// toReview groups draft comments by thread (first-appearance order) into a review.submit payload.
export function toReview(d: Draft, extra?: { threadId: string; message: string }): SubmitReview | undefined {
  const byThread = new Map<string, ReviewThread>()
  for (const c of d.comments) {
    const rt = byThread.get(c.threadId) ?? { threadId: c.threadId }
    if (isMessageComment(c)) {
      rt.messageComments = [...(rt.messageComments ?? []), { messageSeq: c.messageSeq, quote: c.quote, text: c.text }]
    } else {
      const quote = c.quote ? { quote: c.quote } : {}
      rt.comments = [...(rt.comments ?? []), { blockId: c.blockId, lines: c.lines, ...quote, text: c.text }]
    }
    byThread.set(c.threadId, rt)
  }
  if (extra) {
    const rt = byThread.get(extra.threadId) ?? { threadId: extra.threadId }
    rt.message = extra.message
    byThread.set(extra.threadId, rt)
  }
  return byThread.size ? { threads: [...byThread.values()] } : undefined
}

// staleComments lists draft comments the daemon would reject: resolved or missing thread, missing
// block or message.
export function staleComments(d: Draft, state: State): string[] {
  return d.comments
    .filter((c) => {
      const t = state.threads[c.threadId]
      if (!t || t.status === 'resolved') return true
      return isMessageComment(c) ? !t.messages.some((m) => m.seq === c.messageSeq) : !state.blocks[c.blockId]
    })
    .map((c) => c.id)
}

const key = (sid: string) => `tdm:draft:${sid}`

export function loadDraft(sid: string): Draft {
  try {
    const raw = localStorage.getItem(key(sid))
    const parsed = raw ? (JSON.parse(raw) as Draft) : emptyDraft
    return Array.isArray(parsed.comments) ? parsed : emptyDraft
  } catch {
    return emptyDraft
  }
}

export function saveDraft(sid: string, d: Draft): void {
  try {
    if (d.comments.length) localStorage.setItem(key(sid), JSON.stringify(d))
    else localStorage.removeItem(key(sid))
  } catch {
    // Storage unavailable (private mode, quota): the draft still lives in memory.
  }
}
