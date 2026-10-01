import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fixtureSnapshot, renderStateful } from '../test/session'
import { MarkdownBlock } from './MarkdownBlock'

describe('MarkdownBlock', () => {
  it('anchors a note ending on a blank line between sections to the preceding section', async () => {
    const b4 = fixtureSnapshot().state.blocks.b_4
    // b_4 text: "# Storage\n\nWe keep an event log.\n\n- JSONL\n- blobs\n" — line 4 is the
    // blank line between the "We keep an event log." paragraph (line 3) and the list (lines 5-6).
    const block = { ...b4, annotations: [{ lines: { start: 4, end: 4 }, text: 'Why blank here?' }] }
    renderStateful(<MarkdownBlock block={block} />)
    expect(await screen.findByText('Why blank here?')).toBeInTheDocument()
    expect(screen.getByText('AI · line 4')).toBeInTheDocument()
  })

  it('renders sections with line gutters and takes section comments', async () => {
    const user = userEvent.setup()
    renderStateful(<MarkdownBlock block={fixtureSnapshot().state.blocks.b_4} />)
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lines 5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lines 6' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lines 3' }))
    await user.click(screen.getByRole('button', { name: /Comment on line 3/ }))
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Say why.')
    await user.click(screen.getByRole('button', { name: 'Save to draft' }))
    expect(screen.getByText('You · draft · line 3')).toBeInTheDocument()
  })
  it('selects list items one at a time and extends with shift-click', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<MarkdownBlock block={fixtureSnapshot().state.blocks.b_4} />)
    const items = container.querySelectorAll('.md-section.md-list-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('md-list-first')
    expect(items[1]).toHaveClass('md-list-last')
    await user.click(screen.getByRole('button', { name: 'Lines 5' }))
    expect(items[0]).toHaveClass('is-selected')
    expect(items[1]).not.toHaveClass('is-selected')
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Lines 6' }))
    await user.keyboard('{/Shift}')
    expect(items[0]).toHaveClass('is-selected')
    expect(items[1]).toHaveClass('is-selected')
  })

  it('anchors a note on the second list item to that item', async () => {
    const b4 = fixtureSnapshot().state.blocks.b_4
    const block = { ...b4, annotations: [{ lines: { start: 6, end: 6 }, text: 'Blobs why?' }] }
    const { container } = renderStateful(<MarkdownBlock block={block} />)
    expect(await screen.findByText('Blobs why?')).toBeInTheDocument()
    const items = container.querySelectorAll('.md-section.md-list-item')
    expect(items[1]).toHaveTextContent('Blobs why?')
    expect(items[0]).not.toHaveTextContent('Blobs why?')
  })

  it('has an expand control in its header row, and a Collapse one without an id when expanded', async () => {
    const user = userEvent.setup()
    const b4 = fixtureSnapshot().state.blocks.b_4
    const first = renderStateful(<MarkdownBlock block={b4} />)
    expect(first.container.querySelector('.md-head')).toBeInTheDocument()
    expect(first.container.querySelector('section')).toHaveAttribute('id', 'b_4')
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    expect(first.ctx.expandBlock).toHaveBeenCalledWith('b_4')
    first.unmount()

    const second = renderStateful(<MarkdownBlock block={b4} expanded />)
    expect(second.container.querySelector('section')).not.toHaveAttribute('id')
    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(second.ctx.expandBlock).toHaveBeenCalledWith(null)
  })

  it('drags from a gutter across sections, selecting their union', () => {
    const { container } = renderStateful(<MarkdownBlock block={fixtureSnapshot().state.blocks.b_4} />)
    const sections = container.querySelectorAll('.md-section')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Lines 3' }), { button: 0, isPrimary: true })
    fireEvent.pointerMove(sections[sections.length - 1].querySelector('.prose')!)
    fireEvent.pointerUp(sections[sections.length - 1])
    expect([...sections].map((x) => x.classList.contains('is-selected'))).toEqual([false, true, true, true])
  })

  it('long-press on a section body starts line mode and clears the native selection', () => {
    vi.useFakeTimers()
    const { container } = renderStateful(<MarkdownBlock block={fixtureSnapshot().state.blocks.b_4} />)
    const sections = container.querySelectorAll('.md-section')
    const removeAll = vi.spyOn(window.getSelection()!, 'removeAllRanges')
    fireEvent.pointerDown(sections[2].querySelector('.prose')!, { button: 0, isPrimary: true, clientX: 5, clientY: 5 })
    act(() => {
      vi.advanceTimersByTime(301)
    })
    expect(removeAll).toHaveBeenCalled()
    expect(sections[2]).toHaveAttribute('data-pulse')
    expect([...sections].map((x) => x.classList.contains('is-selected'))).toEqual([false, false, true, false])
    fireEvent.pointerMove(sections[3].querySelector('.prose')!)
    expect([...sections].map((x) => x.classList.contains('is-selected'))).toEqual([false, false, true, true])
    fireEvent.pointerUp(sections[3])
    vi.useRealTimers()
  })
})
