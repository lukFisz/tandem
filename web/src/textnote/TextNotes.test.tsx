import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addComment, emptyDraft } from '../draft/draft'
import { handleShortcut } from '../session/shortcuts'
import { makeCtx, renderStateful, renderWithCtx } from '../test/session'
import { ThreadView } from '../thread/ThreadView'
import { TextNotes } from './TextNotes'

const ui = (
  <>
    <ThreadView threadId="t_1" />
    <TextNotes />
  </>
)

// selectText selects the first occurrence of needle in el's text and releases the mouse.
function selectText(el: Element, needle: string) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text)
  const at = nodes.map((n) => n.data).join('').indexOf(needle)
  const point = (i: number): [Text, number] => {
    for (const n of nodes) {
      if (i <= n.data.length) return [n, i]
      i -= n.data.length
    }
    throw new Error(`no ${needle}`)
  }
  const r = document.createRange()
  r.setStart(...point(at))
  r.setEnd(...point(at + needle.length))
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(r)
  fireEvent.mouseUp(el)
}

const row = (n: number) => document.querySelector(`.code-row[data-line="${n}"]`)!
const pill = () => screen.findByRole('button', { name: 'Add a note on the selection' })

async function openPill() {
  const p = await pill()
  fireEvent.mouseDown(p)
  fireEvent.click(p)
}

afterEach(() => window.getSelection()?.removeAllRanges())

describe('TextNotes', () => {
  it('turns a code selection into a draft note with its quote and lines', async () => {
    const user = userEvent.setup()
    const { ctx } = renderWithCtx(ui)
    await screen.findByText('Nullable because the cache is built lazily.')
    selectText(row(14).querySelector('.src')!, 'Map<String, User>?')
    await openPill()
    const editor = screen.getByRole('dialog', { name: 'Note on selection' })
    expect(within(editor).getByText('Map<String, User>?')).toHaveClass('tn-quote')
    expect(window.getSelection()!.isCollapsed).toBe(true)
    await user.type(within(editor).getByRole('textbox', { name: 'Note' }), 'Why nullable?{Control>}{Enter}{/Control}')
    expect(ctx.addDraft).toHaveBeenCalledWith({
      threadId: 't_1',
      blockId: 'b_2',
      lines: { start: 14, end: 14 },
      quote: 'Map<String, User>?',
      text: 'Why nullable?',
    })
    expect(screen.queryByRole('dialog', { name: 'Note on selection' })).toBeNull()
  })

  it('quotes a selection across lines as the source text', async () => {
    const { ctx } = renderWithCtx(ui)
    await screen.findByText('Nullable because the cache is built lazily.')
    const r = document.createRange()
    r.setStart(row(13).querySelector('.src')!.firstChild!.firstChild!, 8)
    r.setEnd(row(14).querySelector('.src')!.firstChild!.firstChild!, 13)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(r)
    fireEvent.mouseUp(row(14))
    await openPill()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Two lines' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to draft/ }))
    expect(ctx.addDraft).toHaveBeenCalledWith(expect.objectContaining({ lines: { start: 13, end: 14 }, quote: 'db: Db,\n    val cache' }))
  })

  it('cancels the editor with Escape and the pill with Escape', async () => {
    const user = userEvent.setup()
    const { ctx } = renderWithCtx(ui)
    await screen.findByText('Nullable because the cache is built lazily.')
    selectText(row(13).querySelector('.src')!, 'db')
    await openPill()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.addDraft).not.toHaveBeenCalled()

    selectText(row(13).querySelector('.src')!, 'db')
    await pill()
    const env = { ctx, current: 't_1', select: () => {} }
    act(() => {
      handleShortcut({ key: 'Escape', metaKey: false, ctrlKey: false, altKey: false, target: document.body }, env)
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add a note on the selection' })).toBeNull())
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  it('opens the editor with c while text is selected, over a line selection', async () => {
    const { ctx } = renderWithCtx(ui, makeCtx({ selection: { blockId: 'b_2', lines: { start: 12, end: 12 }, editing: false } }))
    await screen.findByText('Nullable because the cache is built lazily.')
    selectText(row(13).querySelector('.src')!, 'db')
    await pill()
    act(() => {
      handleShortcut({ key: 'c', metaKey: false, ctrlKey: false, altKey: false, target: document.body }, { ctx, current: 't_1', select: () => {} })
    })
    expect(await screen.findByRole('dialog', { name: 'Note on selection' })).toBeInTheDocument()
    expect(ctx.setSelection).toHaveBeenCalledWith(null)
  })

  it('shows no pill where line comments are not allowed', async () => {
    renderWithCtx(ui, makeCtx({ readOnly: true }))
    await screen.findByText('Nullable because the cache is built lazily.')
    selectText(row(14).querySelector('.src')!, 'cache')
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Add a note on the selection' })).toBeNull()
  })

  it('saves a note on a chat message, then shows its badge and card, edits and removes it', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(ui)
    await screen.findByText('Nullable because the cache is built lazily.')
    const msg = container.querySelector('[data-tn-msg="7"] [data-tn-text]')!
    selectText(msg, 'Here is')
    await openPill()
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Where?{Control>}{Enter}{/Control}')

    const badge = container.querySelector<HTMLElement>('[data-tn-msg="7"] .tn-badge')!
    expect(badge).toHaveClass('is-draft')
    expect(badge.dataset.tnNotes!.split(' ')).toHaveLength(2) // the fixture's sent note and the draft
    fireEvent.mouseOver(badge)
    const card = await screen.findByRole('dialog', { name: 'Notes' })
    expect(card).toHaveTextContent('You · message')
    expect(card).toHaveTextContent('Which one?')
    expect(card).toHaveTextContent('You · draft · message')
    expect(card).toHaveTextContent('Here is')
    expect(within(card).getAllByRole('button', { name: 'Edit draft note' })).toHaveLength(1)

    await user.click(within(card).getByRole('button', { name: 'Edit draft note' }))
    const box = screen.getByRole('textbox', { name: 'Note' })
    expect(box).toHaveValue('Where?')
    await user.clear(box)
    await user.type(box, 'Which part?{Control>}{Enter}{/Control}')
    fireEvent.click(badge)
    expect(await screen.findByRole('dialog', { name: 'Notes' })).toHaveTextContent('Which part?')

    await user.click(screen.getByRole('button', { name: 'Remove draft note' }))
    expect(container.querySelector('[data-tn-msg="7"] .tn-badge')).not.toHaveClass('is-draft')
  })

  it('shows sent notes on selected text as a badge and a card, not inline', async () => {
    const { container } = renderStateful(ui)
    await screen.findByText('Nullable because the cache is built lazily.')
    expect(screen.queryByText('Which Db?')).toBeNull()
    const badge = row(13).querySelector<HTMLElement>('.tn-badge')!
    expect(badge).toHaveAttribute('data-comment-seqs', '15')
    expect(row(13)).toHaveClass('has-note')
    badge.focus()
    const card = await screen.findByRole('dialog', { name: 'Note' })
    expect(card).toHaveTextContent('You · line 13')
    expect(card).toHaveTextContent('db: Db')
    expect(card).toHaveTextContent('Which Db?')
    expect(within(card).queryByRole('button')).toBeNull()
    expect(container.querySelectorAll('.line-note.is-sent')).toHaveLength(1)
  })

  it('keeps drafts from the draft store: a quoted draft has no inline note', async () => {
    const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 12, end: 12 }, quote: 'Repo', text: 'Rename?' })
    renderWithCtx(ui, makeCtx({ draft }))
    await screen.findByText('Nullable because the cache is built lazily.')
    expect(screen.queryByText('Rename?')).toBeNull()
    expect(row(12).querySelector('.tn-badge')).toHaveClass('is-draft')
  })
})
