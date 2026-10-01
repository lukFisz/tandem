import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fixtureSnapshot, makeCtx, renderStateful } from '../test/session'
import { VariantsBlock } from './VariantsBlock'

const b3 = () => fixtureSnapshot().state.blocks.b_3
// o_2 is chosen in the fixture; some tests need both options selectable.
const b3Unchosen = () => ({ ...b3(), chosenOption: undefined })

describe('VariantsBlock', () => {
  it('shows options with pros, cons, nested code and the chosen one', () => {
    const { container } = renderStateful(<VariantsBlock block={b3()} />)
    expect(screen.getByText('Pick an approach for the cache')).toBeInTheDocument()
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    const lazy = container.querySelector<HTMLElement>('[data-option="o_2"]')!
    expect(within(empty).getByRole('heading', { name: 'Empty map' })).toBeInTheDocument()
    expect(within(empty).getByText('No null checks')).toHaveClass('pro')
    expect(within(empty).getByText('Eager allocation')).toHaveClass('con')
    expect(within(empty).getByText(/mutableMapOf/)).toBeInTheDocument()
    expect(within(lazy).getByText('Build the map on first use.')).toBeInTheDocument()
    expect(within(lazy).getByText('Chosen')).toBeInTheDocument()
    expect(within(empty).getByRole('button', { name: 'Choose' })).toBeInTheDocument()
  })

  it('marks the chosen option with a quiet check label, not a pill (the dimmed siblings are CSS)', () => {
    const { container } = renderStateful(<VariantsBlock block={b3()} />)
    const lazy = container.querySelector<HTMLElement>('[data-option="o_2"]')!
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    const label = within(lazy).getByLabelText('Chosen')
    expect(label).toHaveClass('variant-chosen')
    expect(label.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(lazy).toHaveClass('is-chosen')
    expect(container.querySelector('.chip')).toBeNull()
    expect(within(empty).queryByLabelText('Chosen')).toBeNull()
  })

  it('selecting an option does not send a request', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    expect(ctx.run).not.toHaveBeenCalled()
    expect(empty).toHaveClass('is-selected')
    expect(within(empty).getByRole('button', { name: 'Selected' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Send choice' })).toBeInTheDocument()
  })

  it('switches the selection to another card', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<VariantsBlock block={b3Unchosen()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    const lazy = container.querySelector<HTMLElement>('[data-option="o_2"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(within(lazy).getByRole('button', { name: 'Choose' }))
    expect(empty).not.toHaveClass('is-selected')
    expect(lazy).toHaveClass('is-selected')
    expect(within(empty).getByRole('button', { name: 'Choose' })).toBeInTheDocument()
  })

  it('cancel clears the selection and the confirm bar', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<VariantsBlock block={b3()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(empty).not.toHaveClass('is-selected')
    expect(screen.queryByRole('button', { name: 'Send choice' })).toBeNull()
    expect(within(empty).getByRole('button', { name: 'Choose' })).toBeInTheDocument()
  })

  it('writes the choice comment inside an input card', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<VariantsBlock block={b3()} />)
    await user.click(within(container.querySelector<HTMLElement>('[data-option="o_1"]')!).getByRole('button', { name: 'Choose' }))
    expect(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' }).closest('.input-card')).not.toBeNull()
  })

  it('sends the choice with the typed comment', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.type(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' }), 'Actually simpler')
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'variant.choose', data: { blockId: 'b_3', optionId: 'o_1', comment: 'Actually simpler' } })
  })

  it('sends the choice without a comment when none was typed', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'variant.choose', data: { blockId: 'b_3', optionId: 'o_1' } })
  })

  it('sends the choice on cmd+enter in the comment textarea', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.type(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' }), '{Meta>}{Enter}{/Meta}')
    expect(ctx.run).toHaveBeenCalledWith({ type: 'variant.choose', data: { blockId: 'b_3', optionId: 'o_1' } })
  })

  it('keeps the selection and comment after a failed send', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    vi.mocked(ctx.run).mockResolvedValueOnce(false)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.type(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' }), 'try again')
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(empty).toHaveClass('is-selected')
    expect(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' })).toHaveValue('try again')
  })

  it('disables Send choice while a request is in flight', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    let resolve!: (v: boolean) => void
    vi.mocked(ctx.run).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    const sendBtn = screen.getByRole('button', { name: 'Send choice' })
    await user.click(sendBtn)
    expect(sendBtn).toBeDisabled()
    await user.click(sendBtn)
    expect(ctx.run).toHaveBeenCalledTimes(1)
    resolve(true)
  })

  // Stage summary flow, part A: neither Cancel nor Escape can drop the selection while the choice
  // is being sent, so a failed send leaves the choice and the comment to retry.
  it('disables Cancel, and ignores Escape, while a choice is sending', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} />)
    let resolve!: (v: boolean) => void
    vi.mocked(ctx.run).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    const box = screen.getByRole('textbox', { name: 'Comment for your choice (optional)' })
    await user.type(box, 'keep it')
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(empty).toHaveClass('is-selected')
    await act(async () => resolve(false))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(empty).toHaveClass('is-selected')
    expect(box).toHaveValue('keep it')
  })

  it('opening the reject editor clears any pending selection', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<VariantsBlock block={b3()} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'None of these' }))
    expect(empty).not.toHaveClass('is-selected')
    expect(screen.queryByRole('button', { name: 'Send choice' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Why none of these?' })).toBeInTheDocument()
  })

  it('selecting an option closes the reject editor', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<VariantsBlock block={b3()} />)
    await user.click(screen.getByRole('button', { name: 'None of these' }))
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    expect(screen.queryByRole('textbox', { name: 'Why none of these?' })).toBeNull()
  })

  // Stage summary flow, part A: the link and the editor's submit share one name.
  it('rejects all options with a reason, under one name: None of these', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<VariantsBlock block={b3()} />)
    await user.click(screen.getByRole('button', { name: 'None of these' }))
    await user.type(screen.getByRole('textbox', { name: 'Why none of these?' }), 'Both leak memory')
    expect(screen.queryByRole('button', { name: 'Reject all' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'None of these' }))
    expect(ctx.run).toHaveBeenCalledWith({ type: 'variants.reject', data: { blockId: 'b_3', comment: 'Both leak memory' } })
  })

  it('chooses and resolves in one step, with the comment (feature review t_7)', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} onResolved={onResolved} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.type(screen.getByRole('textbox', { name: 'Comment for your choice (optional)' }), 'Fewer null checks')
    await user.click(screen.getByRole('button', { name: 'Choose & resolve' }))
    expect(ctx.run).toHaveBeenCalledWith({
      type: 'variant.choose',
      data: { blockId: 'b_3', optionId: 'o_1', comment: 'Fewer null checks', resolve: true },
    })
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('does not resolve on a plain Send choice, nor call onResolved when Choose & resolve fails', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const { ctx, container } = renderStateful(<VariantsBlock block={b3()} onResolved={onResolved} />)
    const empty = container.querySelector<HTMLElement>('[data-option="o_1"]')!
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Send choice' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'variant.choose', data: { blockId: 'b_3', optionId: 'o_1' } })
    expect(onResolved).not.toHaveBeenCalled()

    vi.mocked(ctx.run).mockResolvedValueOnce(false)
    await user.click(within(empty).getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Choose & resolve' }))
    expect(onResolved).not.toHaveBeenCalled()
    expect(empty).toHaveClass('is-selected')
  })

  it('offers no actions once the thread is resolved', () => {
    const base = makeCtx()
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved' }
    renderStateful(<VariantsBlock block={b3()} />, { state: base.state })
    expect(screen.queryByRole('button', { name: 'Choose' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'None of these' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send choice' })).toBeNull()
  })
})
