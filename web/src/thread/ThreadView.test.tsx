import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeCtx, renderStateful, renderWithCtx } from '../test/session'
import { addComment, emptyDraft } from '../draft/draft'
import { loadThreadText, saveThreadText } from '../draft/threadText'
import { ACCEPT_CONCLUSION_EVENT, RESOLVE_NOTE_EVENT } from '../session/shortcuts'
import { SessionContext, type SessionCtx } from '../session/context'
import { ThreadView } from './ThreadView'

describe('ThreadView', () => {
  it('passes processOutput from the session to the process card', () => {
    const base = makeCtx()
    const state = structuredClone(base.state)
    state.processes = { p_1: { id: 'p_1', threadId: 't_1', pid: 9, cmd: 'make test', status: 'running', seq: 99, startedAt: Date.now() } }
    const { container } = renderWithCtx(<ThreadView threadId="t_1" />, { ...base, state, processOutput: { p_1: 'line a\nline b' } })
    expect([...container.querySelectorAll('#p_1 pre.process-tail > .process-tail-line')].map((l) => l.textContent)).toEqual(['line a', 'line b'])
  })

  it('renders the thread timeline in order', async () => {
    const { container } = renderStateful(<ThreadView threadId="t_1" />)
    expect(screen.getByText('Stage 1 · Thread 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    expect(await screen.findByText('Nullable because the cache is built lazily.')).toBeInTheDocument()
    expect(container.querySelector('.msg-ai')).toHaveTextContent('Here is the repository layer.')
    expect(container.querySelector('.msg-user')).toHaveTextContent('Overall fine.')
    expect(screen.queryByRole('region', { name: 'Proposed conclusion' })).toBeNull()
  })

  it('shows "sent" under the latest user message before the AI has picked it up (F12b-1)', () => {
    // t_1's latest message is the user's "Overall fine." (seq 15); lastAiSeq is 7 and nothing
    // has been delivered yet (fixture delivered: 0), so it is still waiting to be picked up.
    renderStateful(<ThreadView threadId="t_1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Sent · waiting for the AI to pick it up')
  })

  it('hides the delivery status once the AI has acted on the message (F12b-1)', () => {
    // t_2's latest user message is "Answered: Yes" (seq 21), but lastAiSeq is 22: the AI has
    // already acted, so no status line shows.
    renderStateful(<ThreadView threadId="t_2" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a typing bubble instead of a text line once the message has been delivered (round 3, #6)', () => {
    const base = makeCtx()
    base.state.delivered = 15
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(screen.getByRole('status', { name: 'AI is replying' })).toBeInTheDocument()
    expect(screen.queryByText('Sent · waiting for the AI to pick it up')).toBeNull()
    expect(screen.queryByText(/^AI is replying…$/)).toBeNull()
  })

  it('hides the typing bubble before the message is delivered (round 3, #6)', () => {
    renderStateful(<ThreadView threadId="t_1" />)
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('hides the typing bubble once the AI has acted on the message (round 3, #6)', () => {
    // t_2's lastAiSeq (17) is already >= its last user message (16) even with delivered: 0
    // (the fixture default); set delivered high enough to also cover msgSeq <= delivered so a
    // mutant that dropped the "AI acted" check (e.g. `msgSeq <= delivered`) would fail this.
    const base = makeCtx()
    base.state.delivered = 20
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('hides the typing bubble while the AI is waiting for the user (M1: must not contradict the top bar)', () => {
    const base = makeCtx()
    base.state.delivered = 15
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state, waiting: true })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('hides the typing bubble in a read-only session (round 3, #6)', () => {
    const base = makeCtx({ readOnly: true })
    base.state.delivered = 15
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state, readOnly: true })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('says the AI may have stopped when it has been quiet for a while (feature review t_6)', () => {
    const base = makeCtx()
    base.state.delivered = 15
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state, quietMinutes: 12 })
    expect(screen.getByRole('status', { name: 'AI quiet for 12m, it may have stopped' })).toHaveTextContent(
      'AI quiet for 12m, it may have stopped',
    )
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('accepts a proposed conclusion, or edits and saves it without accepting (stage summary flow, part C)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx } = renderStateful(<ThreadView threadId="t_2" onResolved={onResolved} />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(card).toHaveTextContent('Use a lazy delegate for the cache.')
    expect(screen.queryByRole('button', { name: 'Discuss' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'conclusion.accept', data: { threadId: 't_2' } })
    onResolved.mockClear()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit conclusion' })
    await user.clear(box)
    await user.type(box, 'Lazy delegate, documented.')
    expect(screen.queryByRole('button', { name: 'Accept edited' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).toHaveBeenLastCalledWith({
      type: 'conclusion.revise',
      data: { threadId: 't_2', text: 'Lazy delegate, documented.', baseVersion: 1 },
    })
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
    expect(onResolved).not.toHaveBeenCalled() // Save keeps the thread proposed: no auto-advance
  })

  it('does not call onResolved when Accept fails (F12b-4)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const failingCtx = makeCtx({ run: vi.fn(async () => false) })
    const failing = renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, failingCtx)
    await user.click(failing.getByRole('button', { name: /^Accept/ }))
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('calls onResolved after Accept succeeds (F12b-4)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const okCtx = makeCtx({ run: vi.fn(async () => true) })
    const ok = renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, okCtx)
    await user.click(ok.getByRole('button', { name: /^Accept/ }))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('keeps the editor open when Save fails, and cancels back to the proposal', async () => {
    const user = userEvent.setup()
    renderWithCtx(<ThreadView threadId="t_2" />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), ' More.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('textbox', { name: 'Edit conclusion' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('region', { name: 'Proposed conclusion' })).toHaveTextContent('Use a lazy delegate for the cache.')
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
  })

  it('heads a message sent with a variant choice with a check and the option (feature review t_3)', () => {
    const { container } = renderStateful(<ThreadView threadId="t_2" />)
    const msg = container.querySelector('.msg-user')!
    const choice = msg.querySelector('.msg-choice')!
    expect(choice).toHaveTextContent(/^Chose Lazy delegate$/)
    expect(choice.querySelector('.visually-hidden')).toHaveTextContent('Chose')
    expect(choice.querySelector('svg.msg-ref-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(msg).toHaveTextContent('Simpler.')
  })

  // Review Focus 1: a choice without text (also every textless choice in an old log) is its own
  // timeline entry, showing only the header.
  it('shows a textless choice as its own entry with only the header', () => {
    const base = makeCtx()
    const t2 = base.state.threads.t_2
    base.state.threads.t_2 = {
      ...t2,
      // Only the fixture's first message: including its later answer (seq 21) too would add a
      // third user message here.
      messages: [t2.messages[0], { actor: 'user', text: '', seq: 18, choice: { blockId: 'b_3', optionId: 'o_1' } }],
      lastUserSeq: 18,
    }
    const { container } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const msgs = container.querySelectorAll('.msg-user')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toHaveTextContent(/^Chose Empty map$/)
  })

  it('collapses superseded blocks', () => {
    renderStateful(<ThreadView threadId="t_3" />)
    expect(screen.getByText(/Code 5 superseded by/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Code 6' })).toBeInTheDocument()
    expect(screen.getByText('x := 2')).toBeVisible()
  })

  it('sends a reply with the draft via ⌘↵', async () => {
    // The hint follows the host platform; pin macOS so the ⌘↵ assertion holds on every OS.
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    try {
      const user = userEvent.setup()
      const draft = addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'x' })
      const { ctx } = renderStateful(<ThreadView threadId="t_1" />, { draft })
      expect(screen.getByText('⌘↵ sends with 1 draft comment')).toBeInTheDocument()
      await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Looks good{Meta>}{Enter}{/Meta}')
      expect(ctx.sendReview).toHaveBeenCalledWith({ threadId: 't_1', message: 'Looks good' })
    } finally {
      platform.mockRestore()
    }
  })

  it('shows the accepted conclusion under the title and hides the composer when resolved (resolve feedback 1)', () => {
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved', conclusion: 'Lazy it is.', proposedConclusion: undefined }
    const { container } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Conclusion' })
    expect(card).toHaveTextContent('Lazy it is.')
    // Directly after the header, before the first block, and only once.
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' }).closest('header')!.nextElementSibling).toBe(card)
    expect(card.compareDocumentPosition(container.querySelector('#b_3')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.conclusion')).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
  })

  // Demo 7 follow-ups 5: the resolved card keeps Collapse/Expand, and nothing to act on.
  it('lets the resolved conclusion collapse to its preview, starting expanded', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved', conclusion: 'Lazy it is. Tests cover it.', proposedConclusion: undefined }
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Conclusion' })
    expect(within(card).queryByRole('button', { name: /^(Accept|Edit)/ })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Collapse' }))
    expect(within(card).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(card.querySelector('.proposal-preview-text')).toHaveTextContent(/^Lazy it is\.$/)
    expect(card.querySelector('.proposal-preview-more')).toHaveTextContent('(...)')
    expect(card).not.toHaveTextContent('Tests cover it.')
  })

  it('keeps a conclusion collapsed while proposed collapsed once it is accepted', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(within(screen.getByRole('region', { name: 'Proposed conclusion' })).getByRole('button', { name: 'Collapse' }))
    base.state.threads.t_2 = {
      ...base.state.threads.t_2,
      status: 'resolved',
      conclusion: base.state.threads.t_2.proposedConclusion,
      proposedConclusion: undefined,
    }
    rerender(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Conclusion' })
    expect(within(card).getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    expect(card.querySelector('.proposal-preview')).not.toBeNull()
    expect(within(card).queryByText('Updated')).toBeNull()
  })

  it('keeps a proposed conclusion at the bottom, after the timeline (resolve feedback 1)', () => {
    const { container } = renderStateful(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(container.querySelector('#b_3')!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.conclusion')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Conclusion' })).toBeNull()
  })

  it('resolves an open thread in one click (follow-ups B)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx } = renderStateful(<ThreadView threadId="t_1" onResolved={onResolved} />)
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1' } })
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
  })

  // Review Focus 5: one request per Resolve, both buttons disabled while it is in flight.
  it('sends a single Resolve while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_1" onResolved={onResolved} />, makeCtx({ run }))
    const resolve = screen.getByRole('button', { name: 'Resolve' })
    await user.click(resolve)
    expect(resolve).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
    fireEvent.click(resolve)
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('re-enables Resolve and does not advance when it fails', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_1" onResolved={onResolved} />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onResolved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeEnabled()
  })

  // Stage summary flow, part A: one conclusion.accept per click. Accept and Edit are disabled
  // while it is in flight, like Resolve above.
  it('sends a single Accept while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, makeCtx({ run }))
    const accept = screen.getByRole('button', { name: /^Accept/ })
    await user.click(accept)
    expect(accept).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    fireEvent.click(accept)
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('re-enables Accept after a failed accept, without advancing', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(onResolved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  })

  // Stage summary flow, part A/4b: the `a` shortcut goes through the same guard as the button.
  it('accepts once when a is pressed twice while the first accept is in flight', async () => {
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const onResolved = vi.fn()
    renderWithCtx(<ThreadView threadId="t_2" onResolved={onResolved} />, makeCtx({ run }))
    await act(async () => {
      document.dispatchEvent(new CustomEvent(ACCEPT_CONCLUSION_EVENT, { detail: { threadId: 't_2' } }))
    })
    await act(async () => {
      document.dispatchEvent(new CustomEvent(ACCEPT_CONCLUSION_EVENT, { detail: { threadId: 't_2' } }))
    })
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('adds a note before resolving (follow-ups B)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx, container } = renderStateful(<ThreadView threadId="t_1" onResolved={onResolved} />)
    expect(container.querySelector('.resolve-hint')).toHaveTextContent('or press c to add a note')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Repository stays.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1', text: 'Repository stays.' } })
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('resolves with an empty note, and cancels the note back to the buttons', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    const submit = screen.getByRole('button', { name: 'Resolve' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_3' } })
  })

  // Final review Minor #2: c must not open the note editor while a one-click Resolve is in
  // flight (Add note is disabled then too).
  it('ignores the note-editor shortcut while a Resolve is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    renderWithCtx(<ThreadView threadId="t_1" />, makeCtx({ run }))
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()

    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_1' } }))
    })
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()

    await act(async () => finish(true))
  })

  it('opens the note editor when the c shortcut targets this thread', () => {
    renderStateful(<ThreadView threadId="t_1" />)
    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_3' } }))
    })
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_1' } }))
    })
    expect(screen.getByRole('textbox', { name: 'Conclusion (optional)' })).toHaveFocus()
  })

  it('offers Resolve only on open threads of a live session', () => {
    const { unmount } = renderStateful(<ThreadView threadId="t_2" />) // conclusion proposed
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
    unmount()
    const base = makeCtx({ readOnly: true })
    renderStateful(<ThreadView threadId="t_1" />, { state: base.state, readOnly: true })
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
  })

  it('advances after Choose & resolve in the thread (feature review t_7)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    renderStateful(<ThreadView threadId="t_2" onResolved={onResolved} />)
    await user.click(screen.getAllByRole('button', { name: 'Choose' })[0])
    await user.click(screen.getByRole('button', { name: 'Choose & resolve' }))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  // Final review Minor #1: Choose & resolve adds a user message as part of resolving the
  // thread, which without this would show "Sent · waiting for the AI to pick it up" forever,
  // since no AI action is coming for it in this thread.
  it('shows no delivery status line on a thread resolved by a choice', () => {
    const base = makeCtx()
    const t2 = base.state.threads.t_2
    base.state.threads.t_2 = {
      ...t2,
      status: 'resolved',
      conclusion: 'Lazy delegate',
      messages: [...t2.messages, { actor: 'user', text: 'Simpler, go with it.', seq: 18, choice: { blockId: 'b_3', optionId: 'o_1' } }],
      lastUserSeq: 18,
    }
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows no typing bubble on a thread resolved by a choice', () => {
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved', conclusion: 'Lazy delegate', lastUserSeq: 18 }
    base.state.delivered = 18
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('resets the composer draft and conclusion editor when switching threads', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), ' more')
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'draft text')

    rerender(<ThreadView threadId="t_1" />)

    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
  })
})

describe('ThreadView header links (demo 6 follow-ups 1)', () => {
  it('heads an answer with the first line of its question, linking to the question', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    const link = screen.getByRole('link', { name: 'Cache user lookups too?' })
    expect(link).toHaveAttribute('href', '#q_2')
    expect(link).toHaveAttribute('title', 'id: q_2')
    expect(link).toHaveClass('msg-ref')
    expect(link.closest('.msg-user')).toHaveTextContent(/^Cache user lookups too\?AnsweredYes$/)
    expect(link.querySelector('svg.msg-ref-icon')).toHaveAttribute('aria-hidden', 'true')
  })

  it('splits an answer message into a muted "Answered" label and the value, apart from each other', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    const mine = screen.getByRole('link', { name: 'Cache user lookups too?' }).closest('.msg-user') as HTMLElement
    expect(mine.querySelector('.msg-answer-label')).toHaveTextContent('Answered')
    expect(mine.querySelector('.msg-answer')).toHaveTextContent('Yes')
    expect(mine.textContent).not.toContain('Answered: Yes')
  })

  it('strips the quotes off a custom answer and still renders it apart from the label', () => {
    const base = makeCtx()
    const t2 = base.state.threads.t_2
    const custom = { actor: 'user' as const, text: 'Answered: "Only the API part"', seq: 21, answerTo: 'q_2' }
    base.state.threads.t_2 = { ...t2, messages: [t2.messages[0], t2.messages[1], custom] }
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const mine = screen.getByRole('link', { name: 'Cache user lookups too?' }).closest('.msg-user') as HTMLElement
    expect(mine.querySelector('.msg-answer-label')).toHaveTextContent('Answered')
    expect(mine.querySelector('.msg-answer')).toHaveTextContent('Only the API part')
  })

  it('links a choice header to its option', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    const link = screen.getByRole('link', { name: /Chose .*Lazy delegate/ })
    expect(link).toHaveAttribute('href', '#o_2')
    expect(link).toHaveAttribute('title', 'Chose Lazy delegate (id: o_2)')
    expect(link).toHaveClass('msg-ref')
  })
})

describe('ThreadView undelivered messages (demo 6 follow-ups 2)', () => {
  it('mutes a user message until the AI receives it', () => {
    // t_1's "Overall fine." (seq 15) is past t_1's lastAiSeq (7) and the fixture's delivered (0).
    const first = renderStateful(<ThreadView threadId="t_1" />)
    expect(first.container.querySelector('.msg-user')).toHaveClass('is-undelivered')
    first.unmount()
    const base = makeCtx()
    base.state.delivered = 15
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(container.querySelector('.msg-user')).not.toHaveClass('is-undelivered')
  })

  // Review Focus 4.
  it('mutes an undelivered message on a resolved thread too, but never in a read-only session', () => {
    const base = makeCtx()
    base.state.threads.t_1 = { ...base.state.threads.t_1, status: 'resolved', conclusion: 'Keep the repository.' }
    const first = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(first.container.querySelector('.msg-user')).toHaveClass('is-undelivered')
    first.unmount()
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { readOnly: true })
    expect(container.querySelector('.msg-user')).not.toHaveClass('is-undelivered')
  })

  it('pin test: messages the AI has acted on keep the normal style', () => {
    // t_2's user messages (seq 16 and 21) are both at or below its lastAiSeq (22).
    const { container } = renderStateful(<ThreadView threadId="t_2" />)
    expect(container.querySelectorAll('.msg-user')).toHaveLength(2)
    expect(container.querySelector('.msg-user.is-undelivered')).toBeNull()
  })
})

describe('ThreadView line comment header (follow-ups A)', () => {
  // jsdom has no scrollIntoView: record which element it was called on.
  const scrolled: Element[] = []
  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
  })
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('heads a message sent with comments and jumps to them on click', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<ThreadView threadId="t_1" />)
    const note = (await screen.findByText('Why not an empty map?')).closest('.line-note')
    // The fixture's review also sent a note on "db: Db" (line 13) and one on the AI's message.
    const badges = [...container.querySelectorAll('.tn-badge[data-comment-seqs]')]
    expect(badges).toHaveLength(2)
    expect(container.querySelector('.msg-user')).toHaveTextContent(/^3 commentsOverall fine\.$/)
    await user.click(screen.getByRole('button', { name: '3 comments' }))
    expect(scrolled).toEqual([badges[0]])
    for (const el of [note, ...badges]) expect(el).toHaveClass('is-flash')
  })

  // Review Focus 1: a draft-only send is a header-only entry, with no empty text.
  it('shows a draft-only send as a header-only entry', () => {
    const base = makeCtx()
    const t1 = base.state.threads.t_1
    base.state.threads.t_1 = {
      ...t1,
      messages: [...t1.messages, { actor: 'user', text: '', seq: 18 }],
      comments: [
        ...t1.comments,
        { blockId: 'b_2', lines: { start: 12, end: 12 }, text: 'Rename?', seq: 18 },
        { blockId: 'b_2', lines: { start: 13, end: 13 }, text: 'Why a val?', seq: 18 },
      ],
      lastUserSeq: 18,
    }
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    const msgs = container.querySelectorAll('.msg-user')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toHaveTextContent(/^2 line comments$/)
  })

  it('shows no header on messages sent without comments', () => {
    renderStateful(<ThreadView threadId="t_2" />)
    expect(screen.queryByRole('button', { name: /line comment/ })).toBeNull()
  })
})

describe('ThreadView keeps unsent text per thread (demo2 follow-up 2)', () => {
  // Review Focus 1: switching threads mid-draft restores each thread's own text.
  it('restores the composer text and the Resolve note of each thread after switching', async () => {
    const user = userEvent.setup()
    const { rerender } = renderStateful(<ThreadView threadId="t_1" />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'reply on t_1')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'note on t_1')

    rerender(<ThreadView threadId="t_3" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Conclusion (optional)' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'reply on t_3')

    rerender(<ThreadView threadId="t_1" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('reply on t_1')
    expect(screen.getByRole('textbox', { name: 'Conclusion (optional)' })).toHaveValue('note on t_1')

    rerender(<ThreadView threadId="t_3" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('reply on t_3')
  })

  it('forgets the note once Resolve succeeds', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_1" />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Keep it.')
    expect(loadThreadText('note', 's_fixture', 't_1')).toBe('Keep it.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'thread.resolve', data: { threadId: 't_1', text: 'Keep it.' } })
    expect(loadThreadText('note', 's_fixture', 't_1')).toBe('')
  })

  it('keeps the note when Resolve fails, and forgets it on Cancel', async () => {
    const user = userEvent.setup()
    renderWithCtx(<ThreadView threadId="t_3" />, makeCtx({ run: vi.fn(async () => false) }))
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Conclusion (optional)' }), 'Docs later.')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(loadThreadText('note', 's_fixture', 't_3')).toBe('Docs later.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(loadThreadText('note', 's_fixture', 't_3')).toBe('')
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
  })
})

describe('ThreadView reveals the Resolve note editor (demo2 follow-up 1)', () => {
  // jsdom has no scrollIntoView: record the element and the options it was called with.
  const scrolled: { el: Element; arg: unknown }[] = []
  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg })
    }
  })
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.unstubAllGlobals()
  })

  it('scrolls the whole editor into view when Add note opens it', async () => {
    const user = userEvent.setup()
    renderStateful(<ThreadView threadId="t_1" />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    const editor = screen.getByRole('region', { name: 'Resolve thread' })
    expect(scrolled.find((s) => s.el === editor)?.arg).toEqual({ block: 'nearest', behavior: 'smooth' })
    expect(screen.getByRole('textbox', { name: 'Conclusion (optional)' })).toHaveFocus()
  })

  it('jumps without animation under reduced motion, also when c opens it', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    renderStateful(<ThreadView threadId="t_1" />)
    act(() => {
      document.dispatchEvent(new CustomEvent(RESOLVE_NOTE_EVENT, { detail: { threadId: 't_1' } }))
    })
    const editor = screen.getByRole('region', { name: 'Resolve thread' })
    expect(scrolled.find((s) => s.el === editor)?.arg).toEqual({ block: 'nearest', behavior: 'auto' })
  })

  it('reopens a saved note without scrolling or taking focus', () => {
    saveThreadText('note', 's_fixture', 't_1', 'half a note')
    renderStateful(<ThreadView threadId="t_1" />)
    const box = screen.getByRole('textbox', { name: 'Conclusion (optional)' })
    expect(box).toHaveValue('half a note')
    expect(box).not.toHaveFocus()
    expect(scrolled).toEqual([])
  })
})

describe('ThreadView id chips (demo2 follow-up 4)', () => {
  it('shows ids in AI messages and annotations as chips', async () => {
    const base = makeCtx()
    const t1 = base.state.threads.t_1
    base.state.threads.t_1 = { ...t1, messages: [{ actor: 'ai', text: 'Same trade-off as t_2.', seq: 7 }, t1.messages[1]] }
    base.state.blocks.b_2 = { ...base.state.blocks.b_2, annotations: [{ lines: { start: 14, end: 14 }, text: 'Decided in st_1.' }] }
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    expect(within(container.querySelector('.msg-ai') as HTMLElement).getByRole('link', { name: 'Cache strategy' })).toHaveAttribute('href', '#t_2')
    expect(await screen.findByRole('link', { name: 'Data model' })).toHaveAttribute('title', 'id: st_1')
  })

  it('shows ids in variant pros and cons as chips', () => {
    const base = makeCtx()
    const b3 = base.state.blocks.b_3
    base.state.blocks.b_3 = {
      ...b3,
      variants: { ...b3.variants!, options: [{ ...b3.variants!.options[0], pros: ['Simpler than t_1'] }, ...b3.variants!.options.slice(1)] },
    }
    renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    expect(screen.getByRole('link', { name: 'Repository layer' })).toHaveAttribute('title', 'id: t_1')
  })

  it('shows option ids in AI messages as chips (question message spec, part A)', () => {
    const base = makeCtx()
    const t1 = base.state.threads.t_1
    base.state.threads.t_1 = { ...t1, messages: [{ actor: 'ai', text: 'Compare o_1 with o_9.', seq: 7 }, t1.messages[1]] }
    const { container } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    const chip = within(container.querySelector('.msg-ai') as HTMLElement).getByRole('link', { name: 'Empty map' })
    expect(chip).toHaveAttribute('href', '#o_1')
    expect(chip).toHaveAttribute('title', 'id: o_1')
    expect(container.querySelector('.msg-ai')).toHaveTextContent('Compare Empty map with o_9.')
  })
})

describe('ThreadView Edit → Save → Accept (stage summary flow, part C)', () => {
  it('marks a conclusion the user saved, and Accept accepts it as it stands', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, proposedConclusion: 'Lazy delegate, documented.', editedByUser: true }
    const { ctx } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(card).getByText('edited by you')).toHaveClass('edited-by-you')
    expect(card).toHaveTextContent('Lazy delegate, documented.')
    await user.click(within(card).getByRole('button', { name: /^Accept/ }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'conclusion.accept', data: { threadId: 't_2' } })
  })

  it("shows no marker on the AI's own proposal", () => {
    renderStateful(<ThreadView threadId="t_2" />)
    expect(screen.queryByText('edited by you')).toBeNull()
  })

  it('closes the editor without sending when the text is unchanged', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_2" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), '  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
  })

  it('sends a single Save while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    renderWithCtx(<ThreadView threadId="t_2" />, makeCtx({ run }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), ' More.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
  })

  it('closes the editor and shows the new proposal when the AI re-proposes underneath it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // Mutated in place and re-rendered with the same threadId, as in StageView's matching test.
    base.state.threads.t_2 = { ...base.state.threads.t_2, proposedConclusion: 'Use a lazy delegate; document it.' }
    rerender(<ThreadView threadId="t_2" />)
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Proposed conclusion' })).toHaveTextContent('Use a lazy delegate; document it.')
  })
  it('closes the editor when the AI re-proposes the same text underneath it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const t2 = base.state.threads.t_2
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // Same text, new version: a Save against v1 would be rejected, so the editor closes on v2.
    base.state.threads.t_2 = { ...t2, proposalVersion: 2, proposals: [...(t2.proposals ?? []), { text: t2.proposedConclusion ?? '', seq: 40 }] }
    rerender(<ThreadView threadId="t_2" />)
    expect(screen.queryByRole('textbox', { name: 'Edit conclusion' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('sends the proposal version the editor opened on, even when the AI re-proposes while Save is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx()
    const t2 = base.state.threads.t_2
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state, run })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit conclusion' }), ' Documented.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    base.state.threads.t_2 = { ...t2, proposedConclusion: 'Use a lazy delegate; v2.', proposalVersion: 2 }
    rerender(<ThreadView threadId="t_2" />)
    await act(async () => finish(false))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith({
      type: 'conclusion.revise',
      data: { threadId: 't_2', text: 'Use a lazy delegate for the cache. Documented.', baseVersion: 1 },
    })
  })
})

describe('ThreadView proposal card (stage summary flow spec, part D)', () => {
  it('collapses the proposed conclusion after a sent message, keeping Accept and Edit in its header', async () => {
    const user = userEvent.setup()
    renderStateful(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(card).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Why lazy?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(within(card).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(card.querySelector('.proposal-preview')).toHaveTextContent('Use a lazy delegate for the cache.')
    expect(card.querySelector('.prose')).toBeNull()
    expect(within(card).getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('keeps the card open when the send fails', async () => {
    const user = userEvent.setup()
    renderStateful(<ThreadView threadId="t_2" />, { sendReview: vi.fn(async () => false) })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Why lazy?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a conclusion proposed after a sent message expanded', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_1" />, { state: base.state })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Conclude, please.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    base.state.threads.t_1 = {
      ...base.state.threads.t_1,
      status: 'conclusion_proposed',
      proposedConclusion: 'Keep the repository.',
      proposalVersion: 1,
      proposals: [{ text: 'Keep the repository.', seq: 30 }],
    }
    rerender(<ThreadView threadId="t_1" />)
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows Updated when the AI re-proposes while collapsed, and clears it on expand', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const { rerender } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Updated')).toBeNull()

    const next = 'Lazy delegate, documented. Tests cover it.'
    base.state.threads.t_2 = {
      ...base.state.threads.t_2,
      proposedConclusion: next,
      proposalVersion: 2,
      proposals: [...(base.state.threads.t_2.proposals ?? []), { text: next, seq: 30 }],
    }
    rerender(<ThreadView threadId="t_2" />)
    const card = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(card).getByText('Updated')).toBeInTheDocument()
    expect(within(card).getByText('· v2')).toBeInTheDocument()
    expect(card.querySelector('.proposal-preview-text')).toHaveTextContent(/^Lazy delegate, documented\.$/)

    await user.click(within(card).getByRole('button', { name: 'Expand' }))
    expect(within(card).queryByText('Updated')).toBeNull()
    expect(card).toHaveTextContent('Tests cover it.')
  })

  it('lists earlier proposals as closed vN entries in the timeline', () => {
    const base = makeCtx()
    base.state.threads.t_2 = {
      ...base.state.threads.t_2,
      proposalVersion: 2,
      proposals: [
        { text: 'Empty map.', seq: 17 },
        { text: 'Use a lazy delegate for the cache.', seq: 23 },
      ],
    }
    const { container } = renderStateful(<ThreadView threadId="t_2" />, { state: base.state })
    const earlier = screen.getByText('Proposed conclusion · v1').closest('details') as HTMLElement
    expect(earlier).not.toHaveAttribute('open')
    expect(earlier).toHaveTextContent('Empty map.')
    expect(container.querySelectorAll('.conclusion')).toHaveLength(1) // the entry is not a second card
  })
})

describe('ThreadView entrances (UI polish)', () => {
  const view = (ctx: SessionCtx) => (
    <SessionContext.Provider value={ctx}>
      <ThreadView threadId="t_1" />
    </SessionContext.Provider>
  )

  it('eases in only the items that arrive after the thread was opened', () => {
    const base = makeCtx()
    const { container, rerender } = render(view(base))
    expect(container.querySelector('.msg-user')).toHaveTextContent('Overall fine.')
    expect(container.querySelector('.tl-enter')).toBeNull()

    const state = structuredClone(base.state)
    const seq = state.lastSeq + 1
    state.lastSeq = seq
    state.threads.t_1.messages = [...state.threads.t_1.messages, { actor: 'ai', text: 'A fresh reply.', seq }]
    rerender(view({ ...base, state }))

    const entered = container.querySelectorAll('.tl-enter')
    expect(entered).toHaveLength(1)
    expect(entered[0]).toHaveTextContent('A fresh reply.')
    expect(screen.getByText('Overall fine.').closest('.tl-enter')).toBeNull()
  })

  it('does not ease in anything when the thread is opened with its items already there', () => {
    const base = makeCtx()
    const state = structuredClone(base.state)
    // An item past lastSeq that is on the page from the start still counts as already there.
    state.threads.t_1.messages = [...state.threads.t_1.messages, { actor: 'ai', text: 'Late.', seq: state.lastSeq + 5 }]
    const { container } = render(view({ ...base, state }))
    expect(screen.getByText('Late.')).toBeInTheDocument()
    expect(container.querySelector('.tl-enter')).toBeNull()
  })
})
