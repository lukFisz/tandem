import { describe, expect, it, vi } from 'vitest'
import { makeCtx } from '../test/session'
import { TEXT_NOTE_EVENT } from '../textnote/dom'
import { ACCEPT_CONCLUSION_EVENT, handleShortcut, RESOLVE_NOTE_EVENT, type KeyLike } from './shortcuts'

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, target: document.body, ...over })

describe('handleShortcut', () => {
  it('moves through the nav with j and k', () => {
    const select = vi.fn()
    const env = { ctx: makeCtx(), current: 't_1', select }
    expect(handleShortcut(key('j'), env)).toBe(true)
    expect(select).toHaveBeenLastCalledWith('t_2')
    expect(handleShortcut(key('k'), env)).toBe(true)
    expect(select).toHaveBeenLastCalledWith('st_1')
    expect(handleShortcut(key('j'), { ...env, current: 'st_2' })).toBe(false)
  })

  it('never fires while typing or with modifiers', () => {
    const select = vi.fn()
    const textarea = document.createElement('textarea')
    expect(handleShortcut(key('j', { target: textarea }), { ctx: makeCtx(), current: 't_1', select })).toBe(false)
    expect(handleShortcut(key('j', { metaKey: true }), { ctx: makeCtx(), current: 't_1', select })).toBe(false)
    expect(select).not.toHaveBeenCalled()
  })

  it('accepts a proposed conclusion with a', () => {
    const ctx = makeCtx()
    expect(handleShortcut(key('a'), { ctx, current: 't_2', select: vi.fn() })).toBe(true)
    expect(handleShortcut(key('a'), { ctx, current: 't_1', select: vi.fn() })).toBe(false)
    expect(handleShortcut(key('a'), { ctx: makeCtx({ readOnly: true }), current: 't_2', select: vi.fn() })).toBe(false)
  })

  // M5: if focus leaves the conclusion editor's textarea (e.g. the user clicks elsewhere) while
  // it is still open, `a` must not accept the original text and discard the edit in progress.
  it('does not accept via a while the conclusion editor is open, even if focus has left it', () => {
    const editor = document.createElement('textarea')
    editor.setAttribute('aria-label', 'Edit conclusion')
    document.body.appendChild(editor)
    try {
      const ctx = makeCtx()
      expect(handleShortcut(key('a'), { ctx, current: 't_2', select: vi.fn() })).toBe(false)
      expect(ctx.run).not.toHaveBeenCalled()
    } finally {
      editor.remove()
    }
  })

  // Stage summary flow, part A/4b: `a` asks the open thread's ConclusionCard to accept (through
  // its in-flight guard), rather than calling ctx.run itself.
  it('dispatches ACCEPT_CONCLUSION_EVENT for a and does not call ctx.run', () => {
    const dispatched = vi.fn()
    document.addEventListener(ACCEPT_CONCLUSION_EVENT, dispatched)
    try {
      const ctx = makeCtx()
      expect(handleShortcut(key('a'), { ctx, current: 't_2', select: vi.fn() })).toBe(true)
      expect(dispatched).toHaveBeenCalledTimes(1)
      expect((dispatched.mock.calls[0][0] as CustomEvent).detail).toEqual({ threadId: 't_2' })
      expect(ctx.run).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener(ACCEPT_CONCLUSION_EVENT, dispatched)
    }
  })

  it('only acts on the line selection while a block is expanded in the modal', () => {
    const select = vi.fn()
    const opened = vi.fn()
    document.addEventListener(RESOLVE_NOTE_EVENT, opened)
    try {
      const ctx = makeCtx({ expandedBlock: 'b_2' })
      expect(handleShortcut(key('j'), { ctx, current: 't_1', select })).toBe(false)
      expect(handleShortcut(key('a'), { ctx, current: 't_2', select })).toBe(false)
      expect(handleShortcut(key('c'), { ctx, current: 't_1', select })).toBe(false)
      expect(select).not.toHaveBeenCalled()
      expect(opened).not.toHaveBeenCalled()
      const selection = { blockId: 'b_2', lines: { start: 14, end: 14 }, editing: false }
      const withSel = makeCtx({ expandedBlock: 'b_2', selection })
      expect(handleShortcut(key('c'), { ctx: withSel, current: 't_1', select })).toBe(true)
      expect(handleShortcut(key('Escape'), { ctx: withSel, current: 't_1', select })).toBe(true)
    } finally {
      document.removeEventListener(RESOLVE_NOTE_EVENT, opened)
    }
  })

  it('opens the comment editor with c and clears the selection with Escape', () => {
    const selection = { blockId: 'b_2', lines: { start: 14, end: 14 }, editing: false }
    const ctx = makeCtx({ selection })
    expect(handleShortcut(key('c'), { ctx, current: 't_1', select: vi.fn() })).toBe(true)
    expect(ctx.setSelection).toHaveBeenCalledWith({ ...selection, editing: true })
    expect(handleShortcut(key('Escape'), { ctx, current: 't_1', select: vi.fn() })).toBe(true)
    expect(ctx.setSelection).toHaveBeenLastCalledWith(null)
    expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 't_2', select: vi.fn() })).toBe(false)
  })

  // Follow-ups B and Review Focus 4: c comments on a line selection first; with no selection it
  // opens the Resolve note on an open thread of a live session, and nowhere else.
  it('opens the Resolve note with c when no line is selected', () => {
    const opened = vi.fn()
    document.addEventListener(RESOLVE_NOTE_EVENT, opened)
    try {
      expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 't_1', select: vi.fn() })).toBe(true)
      expect(opened).toHaveBeenCalledTimes(1)
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ threadId: 't_1' })

      expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 't_2', select: vi.fn() })).toBe(false) // conclusion proposed
      expect(handleShortcut(key('c'), { ctx: makeCtx(), current: 'st_1', select: vi.fn() })).toBe(false) // a stage
      expect(handleShortcut(key('c'), { ctx: makeCtx({ readOnly: true }), current: 't_1', select: vi.fn() })).toBe(false)
      const textarea = document.createElement('textarea')
      expect(handleShortcut(key('c', { target: textarea }), { ctx: makeCtx(), current: 't_1', select: vi.fn() })).toBe(false)

      const selection = { blockId: 'b_2', lines: { start: 14, end: 14 }, editing: false }
      const withSelection = makeCtx({ selection })
      expect(handleShortcut(key('c'), { ctx: withSelection, current: 't_1', select: vi.fn() })).toBe(true)
      expect(withSelection.setSelection).toHaveBeenCalledWith({ ...selection, editing: true })
      const editing = makeCtx({ selection: { ...selection, editing: true } })
      expect(handleShortcut(key('c'), { ctx: editing, current: 't_1', select: vi.fn() })).toBe(false)

      expect(opened).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener(RESOLVE_NOTE_EVENT, opened)
    }
  })

  // Notes on selected text: with the 💬 Note pill up, c opens its editor (over a line selection)
  // and Escape dismisses it.
  it('acts on the text-note pill first', () => {
    const got = vi.fn()
    document.addEventListener(TEXT_NOTE_EVENT, got)
    const pill = document.createElement('button')
    pill.className = 'tn-pill'
    document.body.appendChild(pill)
    try {
      const ctx = makeCtx({ selection: { blockId: 'b_2', lines: { start: 14, end: 14 }, editing: false } })
      expect(handleShortcut(key('c'), { ctx, current: 't_1', select: vi.fn() })).toBe(true)
      expect(handleShortcut(key('Escape'), { ctx, current: 't_1', select: vi.fn() })).toBe(true)
      expect(got.mock.calls.map((c) => (c[0] as CustomEvent).detail)).toEqual(['open', 'dismiss'])
      expect(ctx.setSelection).not.toHaveBeenCalled()
    } finally {
      pill.remove()
      document.removeEventListener(TEXT_NOTE_EVENT, got)
    }
  })
})
