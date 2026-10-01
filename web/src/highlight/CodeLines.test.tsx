import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeLines } from './CodeLines'

describe('CodeLines', () => {
  it('numbers lines from firstLine and keeps blank lines (Review Focus 5)', () => {
    const { container } = render(<CodeLines code={'a\n\nb\n'} lang="rust" firstLine={12} />)
    const rows = container.querySelectorAll('.code-row')
    expect([...rows].map((r) => r.getAttribute('data-line'))).toEqual(['12', '13', '14'])
    expect(rows[1].querySelector('.src')?.textContent).toBe('​')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reports clicks and shift-clicks on line numbers, marks the selection and renders slots', async () => {
    const onLineClick = vi.fn()
    const { container } = render(
      <CodeLines code={'a\nb\nc\n'} lang="text" firstLine={1} selected={{ start: 2, end: 3 }} onLineClick={onLineClick}
        after={(n) => (n === 2 ? <div>note after 2</div> : null)} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Line 1' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Line 3' }))
    await user.keyboard('{/Shift}')
    expect(onLineClick.mock.calls).toEqual([[1, false], [3, true]])
    expect([...container.querySelectorAll('.code-row.is-selected')].map((r) => r.getAttribute('data-line'))).toEqual(['2', '3'])
    expect(screen.getByText('note after 2')).toBeInTheDocument()
  })
})

describe('CodeLines line drag', () => {
  const setup = () => {
    const onLineClick = vi.fn()
    const onLineDrag = vi.fn()
    const utils = render(<CodeLines code={'a\nb\nc\nd\n'} lang="text" firstLine={1} onLineClick={onLineClick} onLineDrag={onLineDrag} />)
    const row = (n: number) => utils.container.querySelector(`.code-row[data-line="${n}"]`)!
    return { ...utils, onLineClick, onLineDrag, row }
  }
  const down = (el: Element, init: PointerEventInit = {}) => fireEvent.pointerDown(el, { button: 0, isPrimary: true, ...init })

  afterEach(() => vi.useRealTimers())

  it('selects a range by dragging from a line number, without firing a click select', () => {
    const { row, onLineDrag, onLineClick, getByRole } = setup()
    const ln = getByRole('button', { name: 'Line 2' })
    down(ln)
    expect(onLineDrag).not.toHaveBeenCalled()
    fireEvent.pointerMove(row(4))
    fireEvent.pointerMove(row(3))
    fireEvent.pointerUp(row(3))
    expect(onLineDrag.mock.calls).toEqual([[{ start: 2, end: 4 }], [{ start: 2, end: 3 }]])
    fireEvent.click(row(3))
    expect(onLineClick).not.toHaveBeenCalled()
  })

  it('leaves a plain press on a line number to the click handler', () => {
    const { onLineDrag, onLineClick, getByRole } = setup()
    const ln = getByRole('button', { name: 'Line 2' })
    down(ln)
    fireEvent.pointerUp(ln)
    fireEvent.click(ln)
    expect(onLineDrag).not.toHaveBeenCalled()
    expect(onLineClick).toHaveBeenCalledWith(2, false)
  })

  it('ignores shift-press on a line number', () => {
    const { row, onLineDrag, getByRole } = setup()
    down(getByRole('button', { name: 'Line 2' }), { shiftKey: true })
    fireEvent.pointerMove(row(3))
    expect(onLineDrag).not.toHaveBeenCalled()
  })

  it('enters line mode after a 300ms long-press on the text, then drag extends', () => {
    vi.useFakeTimers()
    const { row, onLineDrag } = setup()
    const src = row(2).querySelector('.src')!
    down(src, { clientX: 10, clientY: 10 })
    vi.advanceTimersByTime(299)
    expect(onLineDrag).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onLineDrag).toHaveBeenLastCalledWith({ start: 2, end: 2 })
    expect(row(2)).toHaveAttribute('data-pulse')
    fireEvent.pointerMove(row(1).querySelector('.src')!)
    expect(onLineDrag).toHaveBeenLastCalledWith({ start: 1, end: 2 })
    fireEvent.pointerUp(row(1))
    fireEvent.pointerMove(row(4))
    expect(onLineDrag).toHaveBeenCalledTimes(2)
  })

  it('cancels the long-press when the pointer moves more than 4px', () => {
    vi.useFakeTimers()
    const { row, onLineDrag } = setup()
    const src = row(2).querySelector('.src')!
    down(src, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(src, { clientX: 20, clientY: 10 })
    vi.advanceTimersByTime(500)
    expect(onLineDrag).not.toHaveBeenCalled()
  })

  it('keeps the long-press when the pointer jitters under 4px, and cancels on pointercancel', () => {
    vi.useFakeTimers()
    const { row, onLineDrag } = setup()
    const src = row(2).querySelector('.src')!
    down(src, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(src, { clientX: 12, clientY: 11 })
    vi.advanceTimersByTime(301)
    expect(onLineDrag).toHaveBeenCalledTimes(1)
    down(src, { clientX: 10, clientY: 10 })
    fireEvent.pointerCancel(src)
    vi.advanceTimersByTime(500)
    expect(onLineDrag).toHaveBeenCalledTimes(1)
  })

  it('ignores non-primary buttons', () => {
    vi.useFakeTimers()
    const { row, onLineDrag } = setup()
    down(row(2).querySelector('.src')!, { button: 2 })
    vi.advanceTimersByTime(500)
    expect(onLineDrag).not.toHaveBeenCalled()
  })
})

describe('CodeLines changes vs HEAD', () => {
  // Lines 1–4: 2 added, 3 modified (replacing "old c"), "gone" deleted before line 4.
  const changes = new Map([
    [2, { kind: 'add' as const, group: 1 }],
    [3, { kind: 'mod' as const, group: 2, delBefore: { group: 2, lines: ['old c'], pure: false } }],
    [4, { delBefore: { group: 3, lines: ['gone'], pure: true } }],
  ])
  const setup = (showDeleted: boolean) => {
    const onLineClick = vi.fn()
    const onLineDrag = vi.fn()
    const onChangeClick = vi.fn()
    const utils = render(
      <CodeLines code={'a\nb\nc\nd\n'} lang="text" firstLine={1} onLineClick={onLineClick} onLineDrag={onLineDrag}
        changes={changes} showDeleted={showDeleted} onChangeClick={onChangeClick} />,
    )
    const row = (n: number) => utils.container.querySelector(`.code-row[data-line="${n}"]`)!
    return { ...utils, onLineClick, onLineDrag, onChangeClick, row }
  }

  it('draws change bars and a deletion wedge that open their change group', async () => {
    const { row, onChangeClick, container } = setup(false)
    expect(row(2)).toHaveClass('is-add')
    expect(row(3)).toHaveClass('is-mod')
    expect(row(1).querySelector('.gbar')).not.toBeNull() // an empty slot keeps the code aligned
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Added line, show the diff' }))
    await user.click(screen.getByRole('button', { name: '1 line deleted above, show the diff' }))
    expect(onChangeClick.mock.calls).toEqual([[1], [3]])
    expect(container.querySelector('.is-ghost')).toBeNull()
  })

  it('shows deleted lines ghosted without renumbering or making them selectable', () => {
    vi.useFakeTimers()
    const { row, container, onLineDrag } = setup(true)
    const ghosts = [...container.querySelectorAll('.code-row.is-ghost')]
    expect(ghosts.map((g) => g.textContent)).toEqual(['−old c', '−gone'])
    expect(ghosts.every((g) => !g.hasAttribute('data-ls') && !g.hasAttribute('data-line'))).toBe(true)
    // Ghosts sit right before the line they precede.
    expect(row(3).previousElementSibling).toBe(ghosts[0])
    expect(row(4).previousElementSibling).toBe(ghosts[1])
    expect([...container.querySelectorAll('[data-line]')].map((r) => r.getAttribute('data-line'))).toEqual(['1', '2', '3', '4'])
    expect(screen.queryByRole('button', { name: /deleted above/ })).toBeNull()
    // A long-press on a ghost does not start a line selection; one on a real line still does.
    fireEvent.pointerDown(ghosts[0].querySelector('.src')!, { button: 0, isPrimary: true })
    vi.advanceTimersByTime(400)
    expect(onLineDrag).not.toHaveBeenCalled()
    fireEvent.pointerUp(ghosts[0])
    fireEvent.pointerDown(row(3).querySelector('.src')!, { button: 0, isPrimary: true })
    vi.advanceTimersByTime(301)
    expect(onLineDrag).toHaveBeenLastCalledWith({ start: 3, end: 3 })
    fireEvent.pointerMove(ghosts[1])
    fireEvent.pointerMove(row(4).querySelector('.src')!)
    expect(onLineDrag).toHaveBeenLastCalledWith({ start: 3, end: 4 })
    vi.useRealTimers()
  })
})
