import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderStateful } from '../test/session'
import { BlockModal } from './BlockModal'

describe('BlockModal', () => {
  it('renders nothing while no block is expanded', () => {
    const { container } = renderStateful(<BlockModal />)
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('renders nothing for an unknown block', () => {
    const { container } = renderStateful(<BlockModal />, { expandedBlock: 'b_404' })
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('opens a code block large, with its label and code lines', async () => {
    const { container } = renderStateful(<BlockModal />, { expandedBlock: 'b_2' })
    const dialog = container.querySelector('dialog.block-modal')!
    expect(dialog).toHaveAttribute('open')
    expect(within(dialog as HTMLElement).getByText('File 2 · src/Repo.kt')).toBeInTheDocument()
    expect(await within(dialog as HTMLElement).findByRole('button', { name: 'Line 12' })).toBeInTheDocument()
    // The modal copy carries no id: the thread copy keeps it for jumps.
    expect(dialog.querySelector('#b_2')).toBeNull()
    expect(dialog.querySelector('.code-panel.is-expanded')).toBeInTheDocument()
    expect(within(dialog as HTMLElement).getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
  })

  it('takes line comments inside the modal', async () => {
    const user = userEvent.setup()
    renderStateful(<BlockModal />, { expandedBlock: 'b_2' })
    await user.click(await screen.findByRole('button', { name: 'Line 13' }))
    await user.click(screen.getByRole('button', { name: /Comment on line 13/ }))
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Bigger here.')
    await user.click(screen.getByRole('button', { name: 'Save to draft' }))
    expect(screen.getByText('Bigger here.')).toBeInTheDocument()
  })

  it('closes with the close button', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<BlockModal />, { expandedBlock: 'b_2' })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(ctx.expandBlock).toHaveBeenCalledWith(null)
  })

  it('closes on Escape (the dialog cancel event)', () => {
    const { ctx, container } = renderStateful(<BlockModal />, { expandedBlock: 'b_2' })
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(container.querySelector('dialog')!, cancel)
    expect(ctx.expandBlock).toHaveBeenCalledWith(null)
    expect(cancel.defaultPrevented).toBe(true)
  })

  it('closes on a backdrop click, not on a click inside', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<BlockModal />, { expandedBlock: 'b_4' })
    await user.click(screen.getByRole('heading', { name: 'Storage' }))
    expect(ctx.expandBlock).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('dialog')!)
    expect(ctx.expandBlock).toHaveBeenCalledWith(null)
  })
})
