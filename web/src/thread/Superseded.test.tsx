import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import type { Block } from '../api/types'
import { makeCtx, renderWithCtx } from '../test/session'
import { Superseded } from './Superseded'

afterEach(() => vi.restoreAllMocks())

function setup() {
  const ctx = makeCtx()
  const old: Block = { ...ctx.state.blocks.b_1, id: 'b_2', supersededBy: 'b_3' }
  ctx.state.blocks.b_2 = old
  ctx.state.blocks.b_3 = { ...ctx.state.blocks.b_1, id: 'b_3' }
  return { ctx, old }
}

describe('Superseded', () => {
  it('names both blocks in human terms', () => {
    const { ctx, old } = setup()
    renderWithCtx(<Superseded block={old} />, ctx)
    expect(screen.getByText(/Note 2 superseded by/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Note 3' })).toBeInTheDocument()
  })

  it('falls back to the raw id when the newer block is unknown', () => {
    const { ctx, old } = setup()
    delete ctx.state.blocks.b_3
    renderWithCtx(<Superseded block={old} />, ctx)
    expect(screen.getByRole('button', { name: 'b_3' })).toBeInTheDocument()
  })

  it('scrolls to the newer block without toggling the details', () => {
    const { ctx, old } = setup()
    const target = document.createElement('section')
    target.id = 'b_3'
    document.body.appendChild(target)
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const { container } = renderWithCtx(<Superseded block={old} />, ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Note 3' }))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.contexts[0]).toBe(target)
    expect(container.querySelector('details')).not.toHaveAttribute('open')
    target.remove()
  })
})
