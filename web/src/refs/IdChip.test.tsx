import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { render, renderHook, screen } from '@testing-library/react'
import { makeCtx, renderWithCtx } from '../test/session'
import { SessionContext, type SessionCtx } from '../session/context'
import { AgentText, useTitleOf } from './IdChip'

describe('AgentText (demo2 follow-up 4)', () => {
  it('shows known ids as chips that link to the item, with the id on hover', () => {
    const { container } = renderWithCtx(
      <p>
        <AgentText text="Settled in t_2; see st_1, not t_9 or `t_1`." />
      </p>,
    )
    const chip = screen.getByRole('link', { name: 'Cache strategy' })
    expect(chip).toHaveAttribute('href', '#t_2')
    expect(chip).toHaveAttribute('title', 'id: t_2')
    expect(chip).toHaveClass('id-chip')
    expect(screen.getByRole('link', { name: 'Data model' })).toHaveAttribute('title', 'id: st_1')
    expect(container.querySelectorAll('.id-chip')).toHaveLength(2)
    expect(container).toHaveTextContent('Settled in Cache strategy; see Data model, not t_9 or `t_1`.')
  })

  it('renders plain text outside a session', () => {
    const { container } = render(
      <p>
        <AgentText text="see t_2" />
      </p>,
    )
    expect(container).toHaveTextContent('see t_2')
    expect(screen.queryByRole('link')).toBeNull()
  })
})

// Fix round 1: every SSE event brings a new state; titleOf must keep its identity unless a title
// changes, or every Prose memo (markdown + Shiki) re-renders on each event.
describe('useTitleOf', () => {
  it('keeps the same function while the titles stay the same', () => {
    let ctx: SessionCtx = makeCtx()
    const wrapper = ({ children }: { children: ReactNode }) => <SessionContext.Provider value={ctx}>{children}</SessionContext.Provider>
    const { result, rerender } = renderHook(() => useTitleOf(), { wrapper })
    const first = result.current
    expect(first?.('t_2')).toBe('Cache strategy')
    expect(first?.('o_1')).toBe('Empty map')

    const same = structuredClone(ctx.state)
    same.threads.t_1 = { ...same.threads.t_1, status: 'resolved', conclusion: 'Done.' }
    ctx = { ...ctx, state: same }
    rerender()
    expect(result.current).toBe(first)

    const renamed = structuredClone(same)
    renamed.threads.t_2 = { ...renamed.threads.t_2, title: 'Cache policy' }
    ctx = { ...ctx, state: renamed }
    rerender()
    expect(result.current).not.toBe(first)
    expect(result.current?.('t_2')).toBe('Cache policy')

    const option = structuredClone(renamed)
    const b3 = option.blocks.b_3
    option.blocks.b_3 = {
      ...b3,
      variants: { ...b3.variants!, options: b3.variants!.options.map((o) => (o.id === 'o_1' ? { ...o, title: 'Empty hash map' } : o)) },
    }
    ctx = { ...ctx, state: option }
    rerender()
    expect(result.current?.('o_1')).toBe('Empty hash map')
  })
})
