import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderStateful } from '../test/session'
import { addComment, emptyDraft } from '../draft/draft'
import { loadThreadText } from '../draft/threadText'
import type { Stage, Thread } from '../api/types'
import { Composer, StageComposer } from './Composer'

const thread: Thread = {
  id: 't_1',
  stageId: 'st_1',
  title: 'Repository layer',
  status: 'open',
  blockIds: [],
  messages: [],
  comments: [],
  messageComments: [],
  lastUserSeq: 0,
  lastAiSeq: 0,
}

describe('Composer', () => {
  it('shows the jsdom-detected mod-key hint when there is no draft', () => {
    renderStateful(<Composer thread={thread} />)
    expect(screen.getByText('⌘↵ to send')).toBeInTheDocument()
  })

  it('writes into a soft card with a round send button', () => {
    const { container } = renderStateful(<Composer thread={thread} />)
    const card = container.querySelector('.composer > .composer-card')!
    expect(card).toContainElement(screen.getByRole('textbox', { name: 'Reply' }))
    const send = screen.getByRole('button', { name: 'Send' })
    expect(card).toContainElement(send)
    expect(send).toHaveClass('composer-send')
    expect(send).toHaveAttribute('title', 'Send (⌘↵)')
    expect(send.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('⌘↵ to send')).toHaveClass('composer-hint')
  })

  // M7: ⌘↵/Ctrl↵ with an empty composer and a non-empty draft must send the draft alone.
  it('sends the draft alone via the mod-key shortcut when the composer is empty', async () => {
    const user = userEvent.setup()
    const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const { ctx } = renderStateful(<Composer thread={thread} />, { draft })
    const box = screen.getByRole('textbox', { name: 'Reply' })
    box.focus()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(ctx.sendReview).toHaveBeenCalledWith(undefined)
  })

  it('disables Send and ignores the mod-key shortcut while a send is pending', async () => {
    const user = userEvent.setup()
    let resolveSend: ((ok: boolean) => void) | undefined
    const sendReview = vi.fn(() => new Promise<boolean>((resolve) => (resolveSend = resolve)))
    const { ctx } = renderStateful(<Composer thread={thread} />, { sendReview })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'hello')
    const sendButton = screen.getByRole('button', { name: 'Send' })
    await user.click(sendButton)
    expect(sendButton).toBeDisabled()

    // A second ⌘↵ while the first send is still in flight must not call sendReview again.
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(ctx.sendReview).toHaveBeenCalledTimes(1)

    resolveSend!(true)
    // The send resolved and cleared the (unchanged) text, so Send is disabled again for having
    // nothing to send — not stuck disabled by the in-flight guard.
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'again')
    expect(sendButton).not.toBeDisabled()
  })

  it('clears the text on success only if it is unchanged since the send started', async () => {
    const user = userEvent.setup()
    let resolveSend: ((ok: boolean) => void) | undefined
    const sendReview = vi.fn(() => new Promise<boolean>((resolve) => (resolveSend = resolve)))
    renderStateful(<Composer thread={thread} />, { sendReview })
    const box = screen.getByRole('textbox', { name: 'Reply' })
    await user.type(box, 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    // The user edits the text while the send is still in flight.
    await user.type(box, ' world')
    resolveSend!(true)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled())
    expect(box).toHaveValue('hello world')
  })

  it('shows how many draft comments go with the message on Send (feature review t_1)', () => {
    const one = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const first = renderStateful(<Composer thread={thread} />, { draft: one })
    expect(screen.getByRole('button', { name: 'Send (1 comment)' })).toBeInTheDocument()
    first.unmount()

    // Comments on other threads go out with the message too, so they count.
    const three = addComment(
      addComment(one, { threadId: 't_3', blockId: 'b_4', lines: { start: 1, end: 1 }, text: 'y' }),
      { threadId: 't_1', blockId: 'b_2', lines: { start: 13, end: 13 }, text: 'z' },
    )
    const second = renderStateful(<Composer thread={thread} />, { draft: three })
    expect(screen.getByRole('button', { name: 'Send (3 comments)' })).toBeInTheDocument()
    second.unmount()

    renderStateful(<Composer thread={thread} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  // Demo2 follow-up 3: draft comments alone enable Send, and it sends only them.
  it('enables Send with draft comments and an empty box, and sends the draft alone', async () => {
    const user = userEvent.setup()
    const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const { ctx } = renderStateful(<Composer thread={thread} />, { draft })
    const send = screen.getByRole('button', { name: 'Send (1 comment)' })
    expect(send).toBeEnabled()
    await user.click(send)
    expect(ctx.sendReview).toHaveBeenCalledWith(undefined)
  })

  // Review Focus 5: whitespace is not a message; it is cleared along with the sent draft.
  it('sends only the comments when the box holds whitespace, and clears it', async () => {
    const user = userEvent.setup()
    const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
    const { ctx } = renderStateful(<Composer thread={thread} />, { draft })
    const box = screen.getByRole('textbox', { name: 'Reply' })
    await user.type(box, '   ')
    await user.click(screen.getByRole('button', { name: 'Send (1 comment)' }))
    expect(ctx.sendReview).toHaveBeenCalledWith(undefined)
    await vi.waitFor(() => expect(box).toHaveValue(''))
  })

  it('keeps Send disabled with neither text nor comments', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<Composer thread={thread} />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '  ')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(ctx.sendReview).not.toHaveBeenCalled()
  })

  // Demo2 follow-up 2: unsent text survives a remount (thread switch or reload) and is dropped once sent.
  it('keeps unsent text across a remount and forgets it after sending', async () => {
    const user = userEvent.setup()
    const first = renderStateful(<Composer thread={thread} />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'half a thought')
    first.unmount()
    renderStateful(<Composer thread={thread} />)
    const box = screen.getByRole('textbox', { name: 'Reply' })
    expect(box).toHaveValue('half a thought')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => expect(box).toHaveValue(''))
    expect(loadThreadText('composer', 's_fixture', 't_1')).toBe('')
  })

  // Final review: a send that resolves after its composer unmounted must not wipe text a newer
  // mount of the same thread stored meanwhile (send on A, switch to B and back to A).
  it('keeps text typed in a newer mount when an older mount\'s send resolves', async () => {
    const user = userEvent.setup()
    let resolveSend: ((ok: boolean) => void) | undefined
    const sendReview = vi.fn(() => new Promise<boolean>((resolve) => (resolveSend = resolve)))
    const first = renderStateful(<Composer thread={thread} />, { sendReview })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'first')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    first.unmount()

    renderStateful(<Composer thread={thread} />, { sendReview })
    const box = screen.getByRole('textbox', { name: 'Reply' })
    await user.clear(box)
    await user.type(box, 'second')
    resolveSend!(true)
    await vi.waitFor(() => expect(sendReview).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0)) // let the stale send settle
    expect(loadThreadText('composer', 's_fixture', 't_1')).toBe('second')
    expect(box).toHaveValue('second')
  })

  it('forgets the sent text when its composer unmounted and nothing newer was typed', async () => {
    const user = userEvent.setup()
    let resolveSend: ((ok: boolean) => void) | undefined
    const sendReview = vi.fn(() => new Promise<boolean>((resolve) => (resolveSend = resolve)))
    const first = renderStateful(<Composer thread={thread} />, { sendReview })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'gone')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    first.unmount()
    resolveSend!(true)
    await vi.waitFor(() => expect(loadThreadText('composer', 's_fixture', 't_1')).toBe(''))
  })
})

describe('StageComposer (stage summary flow spec, part E)', () => {
  const stage: Stage = { id: 'st_1', title: 'Data model', status: 'open', threadIds: [] }

  it('sends the trimmed text as a stage message and forgets it', async () => {
    const user = userEvent.setup()
    const onSent = vi.fn()
    const { ctx } = renderStateful(<StageComposer stage={stage} onSent={onSent} />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '  Mention blobs.  ')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Mention blobs.' } })
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue(''))
    expect(loadThreadText('composer', 's_fixture', 'st_1')).toBe('')
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('needs text to send, keeps unsent text per stage, and keeps it when the send fails', async () => {
    const user = userEvent.setup()
    const first = renderStateful(<StageComposer stage={stage} />, { run: vi.fn(async () => false) })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Draft')
    first.unmount()
    renderStateful(<StageComposer stage={stage} />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Draft')
  })

  it('is hidden on a read-only session', () => {
    renderStateful(<StageComposer stage={stage} />, { readOnly: true })
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
  })
})
