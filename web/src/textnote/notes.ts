import type { LineRange, State } from '../api/types'
import { rangeText } from '../blocks/useBlockText'
import { isMessageComment, type Draft, type NewDraftComment } from '../draft/draft'

// The daemon's limit on a quote's length (domain.MaxQuote).
export const MAX_QUOTE = 2000

export type Anchor =
  | { kind: 'block'; threadId: string; blockId: string; lines: LineRange }
  | { kind: 'message'; threadId: string; messageSeq: number }

// TextNote is a note on selected text: a draft (draftId) or one the user sent (seq, the review's).
export interface TextNote {
  key: string
  anchor: Anchor
  quote: string
  text: string
  draftId?: string
  seq?: number
}

// quotedNotes lists every note on selected text in the session: the sent ones, then the drafts.
export function quotedNotes(state: State, draft: Draft): TextNote[] {
  const out: TextNote[] = []
  for (const t of Object.values(state.threads)) {
    t.comments.forEach((c, i) => {
      if (!c.quote) return
      const anchor: Anchor = { kind: 'block', threadId: t.id, blockId: c.blockId, lines: c.lines }
      out.push({ key: `c:${t.id}:${i}`, anchor, quote: c.quote, text: c.text, seq: c.seq })
    })
    t.messageComments.forEach((c, i) => {
      const anchor: Anchor = { kind: 'message', threadId: t.id, messageSeq: c.messageSeq }
      out.push({ key: `m:${t.id}:${i}`, anchor, quote: c.quote, text: c.text, seq: c.seq })
    })
  }
  for (const c of draft.comments) {
    if (isMessageComment(c)) {
      const anchor: Anchor = { kind: 'message', threadId: c.threadId, messageSeq: c.messageSeq }
      out.push({ key: c.id, anchor, quote: c.quote, text: c.text, draftId: c.id })
    } else if (c.quote) {
      const anchor: Anchor = { kind: 'block', threadId: c.threadId, blockId: c.blockId, lines: c.lines }
      out.push({ key: c.id, anchor, quote: c.quote, text: c.text, draftId: c.id })
    }
  }
  return out
}

export function blockNotes(notes: TextNote[], blockId: string): TextNote[] {
  return notes.filter((n) => n.anchor.kind === 'block' && n.anchor.blockId === blockId)
}

export function messageNotes(notes: TextNote[], threadId: string, seq: number): TextNote[] {
  return notes.filter((n) => n.anchor.kind === 'message' && n.anchor.threadId === threadId && n.anchor.messageSeq === seq)
}

export function endLine(n: TextNote): number {
  return n.anchor.kind === 'block' ? n.anchor.lines.end : 0
}

export function toDraft(anchor: Anchor, quote: string, text: string): NewDraftComment {
  return anchor.kind === 'block'
    ? { threadId: anchor.threadId, blockId: anchor.blockId, lines: anchor.lines, quote, text }
    : { threadId: anchor.threadId, messageSeq: anchor.messageSeq, quote, text }
}

// noteWhere names a note's anchor for its card: "line 14", "lines 3–5" or "message".
export function noteWhere(anchor: Anchor): string {
  return anchor.kind === 'message' ? 'message' : rangeText(anchor.lines)
}
