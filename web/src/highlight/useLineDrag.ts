import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { LineRange } from '../api/types'

const HOLD_MS = 300
const SLOP_PX = 4
const HANDLE = '.ln, .md-gutter'
const BODY = '.src, .prose'
const INTERACTIVE = 'a, button, input, textarea, select'

// Rows (code lines or markdown sections) carry data-ls / data-le: the line range they cover.
function rowOf(el: Element | null, root: Element): { el: HTMLElement; range: LineRange } | null {
  const row = el?.closest<HTMLElement>('[data-ls]')
  if (!row || !root.contains(row)) return null
  return { el: row, range: { start: Number(row.dataset.ls), end: Number(row.dataset.le) } }
}

const union = (a: LineRange, b: LineRange): LineRange => ({ start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) })

// Drag-to-select lines. Pressing a line-number handle and dragging selects at once; holding still on
// the text for HOLD_MS enters line mode (clearing the native selection), after which dragging extends
// the range. Moving past SLOP_PX before the hold fires leaves native text selection alone. A plain
// click on a handle never reaches onRange, so the caller's click handler keeps working.
export function useLineDrag(onRange: ((range: LineRange) => void) | undefined) {
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  return useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!onRange || e.button !== 0 || !e.isPrimary) return
      const root = e.currentTarget
      const target = e.target as Element
      const handle = !!target.closest(HANDLE)
      const body = !handle && !!target.closest(BODY) && !target.closest(INTERACTIVE)
      if (!handle && !body) return
      if (handle && e.shiftKey) return
      const start = rowOf(target, root)
      if (!start) return
      cleanup.current?.()

      let active = handle
      let moved = false
      let last = start.range
      let timer: ReturnType<typeof setTimeout> | undefined
      const x0 = e.clientX
      const y0 = e.clientY

      const swallowClick = (ev: Event) => ev.stopPropagation()
      const noSelect = (ev: Event) => ev.preventDefault()

      const enter = () => {
        active = true
        root.classList.add('is-line-dragging')
        document.addEventListener('selectstart', noSelect)
        window.getSelection()?.removeAllRanges()
        // An attribute, not a class: React rewrites className when the row becomes selected.
        start.el.setAttribute('data-pulse', '')
        setTimeout(() => start.el.removeAttribute('data-pulse'), 400)
        onRange(start.range)
      }
      if (handle) root.classList.add('is-line-dragging')
      else timer = setTimeout(enter, HOLD_MS)
      if (handle) document.addEventListener('selectstart', noSelect)

      const move = (ev: PointerEvent) => {
        if (!active) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP_PX) stop()
          return
        }
        const under = document.elementFromPoint?.(ev.clientX, ev.clientY) ?? (ev.target as Element)
        const row = rowOf(under, root)
        if (!row || (row.range.start === last.start && row.range.end === last.end)) return
        last = row.range
        moved = true
        onRange(union(start.range, row.range))
      }
      const stop = () => {
        clearTimeout(timer)
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', stop)
        document.removeEventListener('selectstart', noSelect)
        window.removeEventListener('scroll', stop, true)
        root.classList.remove('is-line-dragging')
        cleanup.current = null
      }
      const up = () => {
        stop()
        if (handle && moved) {
          // The drag ended on another row, or back on the handle: either way it is not a click.
          root.addEventListener('click', swallowClick, { capture: true, once: true })
          setTimeout(() => root.removeEventListener('click', swallowClick, true), 0)
        }
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', stop)
      window.addEventListener('scroll', stop, true)
      cleanup.current = stop
    },
    [onRange],
  )
}
