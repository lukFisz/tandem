import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message, State } from '../api/types'
import { makeCtx, renderStateful, withQuestion } from '../test/session'
import { ThreadView } from './ThreadView'

const openState = (): State => withQuestion(makeCtx().state)
const question = () => screen.getByRole('region', { name: 'Question' })

describe('QuestionMessage (question message spec)', () => {
  it('shows an open question with its buttons and Other…, and answers with a click', async () => {
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    const q = question()
    expect(q).toHaveAttribute('data-question', 'q_1')
    expect(q).toHaveTextContent('Should the docs cover the blob layout?')
    expect(within(q).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yes', 'No', 'Other…'])
    await userEvent.click(within(q).getByRole('button', { name: 'No' }))
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', optionId: 'o_4' } })
  })

  it('swaps the buttons for a one-line input on Other…; Enter sends the trimmed text, Esc cancels', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    const input = within(question()).getByRole('textbox', { name: 'Your answer' })
    expect(input).toHaveFocus()
    expect(input.closest('.input-card.is-inline')).not.toBeNull()
    expect(within(question()).queryByRole('button', { name: 'Yes' })).toBeNull()
    // Review Focus 4: blank text cannot be sent.
    expect(within(question()).getByRole('button', { name: 'Send answer' })).toBeDisabled()
    await user.type(input, '   {Enter}')
    expect(ctx.run).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(within(question()).queryByRole('textbox', { name: 'Your answer' })).toBeNull()
    expect(within(question()).getByRole('button', { name: 'Yes' })).toBeInTheDocument()

    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    await user.type(within(question()).getByRole('textbox', { name: 'Your answer' }), '  Only the API part {Enter}')
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', other: 'Only the API part' } })
  })

  // Finding 3: Other text must not vanish while the answer is pending after a successful send.
  it('keeps the Other text visible and disabled after a successful send, until the answer arrives', async () => {
    const user = userEvent.setup()
    const run = vi.fn(async () => true)
    renderStateful(<ThreadView threadId="t_3" />, { state: openState(), run })
    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    await user.type(within(question()).getByRole('textbox', { name: 'Your answer' }), 'Later')
    await user.click(within(question()).getByRole('button', { name: 'Send answer' }))
    expect(run).toHaveBeenCalledTimes(1)
    const input = within(question()).getByRole('textbox', { name: 'Your answer' })
    expect(input).toHaveValue('Later')
    expect(input).toBeDisabled()
    expect(within(question()).getByRole('button', { name: 'Send answer' })).toBeDisabled()
  })

  it('sends with the Send answer button too', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    await user.type(within(question()).getByRole('textbox', { name: 'Your answer' }), 'Later')
    await user.click(within(question()).getByRole('button', { name: 'Send answer' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', other: 'Later' } })
  })

  // Review Focus 1: exactly one answer, even once `run` has resolved before the answered state
  // arrives over SSE.
  it('sends one answer while one is in flight', async () => {
    const user = userEvent.setup()
    const run = vi.fn(() => new Promise<boolean>(() => {}))
    renderStateful(<ThreadView threadId="t_3" />, { state: openState(), run })
    await user.click(within(question()).getByRole('button', { name: 'Yes' }))
    expect(within(question()).getByRole('button', { name: 'No' })).toBeDisabled()
    await user.keyboard('2')
    expect(run).toHaveBeenCalledTimes(1)
  })

  // Review Focus 1: a successful answer stays locked even after `run` resolves, since the
  // answered state only arrives later over SSE.
  it('stays locked after a successful answer, even once run has resolved', async () => {
    const user = userEvent.setup()
    const run = vi.fn(async () => true)
    renderStateful(<ThreadView threadId="t_3" />, { state: openState(), run })
    await user.click(within(question()).getByRole('button', { name: 'Yes' }))
    await user.keyboard('2')
    expect(run).toHaveBeenCalledTimes(1)
  })

  // Review Focus 2.
  it('picks a button with keys 1–4 when focus is not in a text field', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.keyboard('3') // only two options
    expect(ctx.run).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '1')
    expect(ctx.run).not.toHaveBeenCalled()
    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('2')
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_1', optionId: 'o_4' } })
  })

  it('gives the keys to the latest open question only', async () => {
    const user = userEvent.setup()
    const base = openState()
    const second: Message = { actor: 'ai', text: 'Second?', seq: 20, question: { id: 'q_2', options: [{ id: 'o_5', title: 'A' }, { id: 'o_6', title: 'B' }] } }
    const state = withQuestion(base, {}, { messages: [...base.threads.t_3.messages, second], lastAiSeq: 20 })
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state })
    expect(screen.getAllByRole('region', { name: 'Question' })).toHaveLength(2)
    await user.keyboard('1')
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_2', optionId: 'o_5' } })
  })

  it('shows the answer as a muted line, followed by the Answered user message', () => {
    const base = withQuestion(makeCtx().state, { answer: { optionId: 'o_4' } })
    const t3 = base.threads.t_3
    const state: State = {
      ...base,
      threads: { ...base.threads, t_3: { ...t3, messages: [...t3.messages, { actor: 'user', text: 'Answered: No', seq: 20 }], lastUserSeq: 20 } },
    }
    const { container } = renderStateful(<ThreadView threadId="t_3" />, { state })
    expect(within(question()).queryAllByRole('button')).toHaveLength(0)
    expect(question()).toHaveTextContent('Answer: No')
    expect(container.querySelector('.msg-user')).toHaveTextContent('Answered: No')
  })

  it('quotes an Other answer', () => {
    renderStateful(<ThreadView threadId="t_3" />, { state: withQuestion(makeCtx().state, { answer: { other: 'Only the API part' } }) })
    expect(question()).toHaveTextContent('Answer: "Only the API part"')
  })

  it('shows Withdrawn and no buttons for a withdrawn question', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />) // the fixture's q_1 is withdrawn
    expect(question()).toHaveTextContent('Withdrawn')
    expect(within(question()).queryAllByRole('button')).toHaveLength(0)
    await user.keyboard('1')
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it('shows Not answered and takes no keys on a resolved thread or in a read-only session', async () => {
    const user = userEvent.setup()
    for (const over of [
      { state: withQuestion(makeCtx().state, {}, { status: 'resolved', conclusion: 'Done.' }) },
      { state: openState(), readOnly: true },
    ]) {
      const { ctx, unmount } = renderStateful(<ThreadView threadId="t_3" />, over)
      expect(question()).toHaveTextContent('Not answered')
      expect(within(question()).queryAllByRole('button')).toHaveLength(0)
      await user.keyboard('1')
      expect(ctx.run).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('keeps the question open while the user sends a normal message', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<ThreadView threadId="t_3" />, { state: openState() })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Why do you ask?{Meta>}{Enter}{/Meta}')
    expect(ctx.sendReview).toHaveBeenCalledWith({ threadId: 't_3', message: 'Why do you ask?' })
    expect(within(question()).getByRole('button', { name: 'Yes' })).toBeInTheDocument()
  })
})
