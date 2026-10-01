import { describe, expect, it } from 'vitest'
import { addComment, emptyDraft } from '../draft/draft'
import { fixtureSnapshot } from '../test/session'
import { blockNotes, endLine, messageNotes, noteWhere, quotedNotes, toDraft } from './notes'

describe('quotedNotes', () => {
  it('lists sent and draft notes on selected text, not plain line comments', () => {
    const { state } = fixtureSnapshot()
    let draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 12, end: 12 }, text: 'plain' })
    draft = addComment(draft, { threadId: 't_1', blockId: 'b_2', lines: { start: 12, end: 13 }, quote: 'Repo(', text: 'quoted' })
    draft = addComment(draft, { threadId: 't_1', messageSeq: 7, quote: 'Here', text: 'on message' })
    const notes = quotedNotes(state, draft)
    expect(notes.map((n) => [n.text, n.quote, n.seq, !!n.draftId])).toEqual([
      ['Which Db?', 'db: Db', 15, false],
      ['Which one?', 'repository layer', 15, false],
      ['quoted', 'Repo(', undefined, true],
      ['on message', 'Here', undefined, true],
    ])
    expect(blockNotes(notes, 'b_2').map((n) => endLine(n))).toEqual([13, 13])
    expect(messageNotes(notes, 't_1', 7).map((n) => n.text)).toEqual(['Which one?', 'on message'])
    expect(new Set(notes.map((n) => n.key)).size).toBe(4)
  })

  it('names anchors and turns them into draft comments', () => {
    const block = { kind: 'block' as const, threadId: 't_1', blockId: 'b_2', lines: { start: 3, end: 5 } }
    const message = { kind: 'message' as const, threadId: 't_1', messageSeq: 7 }
    expect(noteWhere(block)).toBe('lines 3–5')
    expect(noteWhere({ ...block, lines: { start: 4, end: 4 } })).toBe('line 4')
    expect(noteWhere(message)).toBe('message')
    expect(toDraft(block, 'q', 't')).toEqual({ threadId: 't_1', blockId: 'b_2', lines: { start: 3, end: 5 }, quote: 'q', text: 't' })
    expect(toDraft(message, 'q', 't')).toEqual({ threadId: 't_1', messageSeq: 7, quote: 'q', text: 't' })
  })
})
