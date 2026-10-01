import { describe, expect, it, vi } from 'vitest'
import { showSentComments } from './showSentComments'

function page(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  for (const n of root.querySelectorAll<HTMLElement>('.line-note')) n.scrollIntoView = vi.fn()
  return root
}

describe('showSentComments', () => {
  it('scrolls to the first note of a send and flashes all of them', () => {
    const root = page(
      '<div class="line-note" data-comment-seq="15"></div>' +
        '<div class="line-note" data-comment-seq="18"></div>' +
        '<div class="line-note" data-comment-seq="18"></div>',
    )
    const notes = [...root.querySelectorAll<HTMLElement>('.line-note')]
    expect(showSentComments(root, 18)).toBe(true)
    expect(notes[1].scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(notes[2].scrollIntoView).not.toHaveBeenCalled()
    expect(notes.map((n) => n.classList.contains('is-flash'))).toEqual([false, true, true])
    notes[1].dispatchEvent(new Event('animationend'))
    expect(notes[1]).not.toHaveClass('is-flash')
  })

  // Review Focus 3: a comment on a superseded block sits inside the collapsed <details>.
  it('expands a collapsed superseded block first', () => {
    const root = page('<details><summary>b_5 superseded by b_6</summary><div class="line-note" data-comment-seq="9"></div></details>')
    expect(showSentComments(root, 9)).toBe(true)
    expect(root.querySelector('details')!.open).toBe(true)
  })

  it('does nothing when the notes are not on the page', () => {
    expect(showSentComments(page('<div class="line-note" data-comment-seq="15"></div>'), 99)).toBe(false)
  })

  it('jumps instantly and clears the flash on a timer under prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    vi.useFakeTimers()
    try {
      const root = page('<div class="line-note" data-comment-seq="7"></div>')
      const note = root.querySelector<HTMLElement>('.line-note')!
      expect(showSentComments(root, 7)).toBe(true)
      expect(note.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
      expect(note).toHaveClass('is-flash')
      vi.advanceTimersByTime(1600)
      expect(note).not.toHaveClass('is-flash')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
