import { describe, expect, it, vi } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { useFollowBottom } from './useFollowBottom'

// jsdom has no layout: scrollHeight/clientHeight/scrollTop and scrollTo are stubbed by hand.
function makeContainer(opts: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = document.createElement('div')
  let scrollTop = opts.scrollTop
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
    configurable: true,
  })
  el.scrollTo = vi.fn((arg: ScrollToOptions | number) => {
    if (typeof arg === 'object' && typeof arg.top === 'number') scrollTop = arg.top
  }) as typeof el.scrollTo
  return el
}

function setup(el: HTMLElement, contentKey: string) {
  const ref = { current: el as HTMLElement | null }
  return renderHook(({ key }) => useFollowBottom(ref, key), { initialProps: { key: contentKey } })
}

describe('useFollowBottom', () => {
  it('scrolls to the bottom when content grows while the user is near the bottom', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - 100 }) // 100px from bottom
    const { result, rerender } = setup(el, 't_1:1:')
    expect(result.current.showPill).toBe(false)

    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' })

    expect(el.scrollTo).toHaveBeenCalled()
    expect(result.current.showPill).toBe(false)
  })

  it('shows a "New below" pill instead of scrolling when the user is scrolled up', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from bottom
    const { result, rerender } = setup(el, 't_1:1:')
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' })

    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(true)
  })

  it('scrollToBottom() scrolls and clears the pill', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    const { result, rerender } = setup(el, 't_1:1:')
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' })
    expect(result.current.showPill).toBe(true)

    result.current.scrollToBottom()
    rerender({ key: 't_1:2:' })
    expect(result.current.showPill).toBe(false)
    expect(el.scrollTo).toHaveBeenCalled()
  })

  it('does not show the pill when switching to a different item', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from bottom
    const { result, rerender } = setup(el, 't_1:1:')
    rerender({ key: 't_2:1:' }) // different item id prefix
    expect(result.current.showPill).toBe(false)
    expect(el.scrollTo).not.toHaveBeenCalled()
  })

  it('uses instant scrolling under prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    try {
      const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - 50 })
      const { rerender } = setup(el, 't_1:1:')
      Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
      rerender({ key: 't_1:2:' })
      expect(el.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('re-measures near-bottom on item switch, so new content on a long item does not yank the user down (fix round 1, Important)', () => {
    // Near the bottom of a short item...
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
    const { result, rerender } = setup(el, 't_1:1:')
    expect(result.current.showPill).toBe(false)

    // ...switch to a much longer item, landing at its top (no scroll event fires for this: it's
    // a fresh render, not a user scroll).
    Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true })
    el.scrollTop = 0
    rerender({ key: 't_2:1:' })
    expect(result.current.showPill).toBe(false) // switching itself never shows the pill
    expect(el.scrollTo).not.toHaveBeenCalled()

    // New content arrives in that same (long) item while still far from its bottom: must show
    // the pill instead of scrolling, because the user is nowhere near the bottom of it.
    Object.defineProperty(el, 'scrollHeight', { value: 5400, configurable: true })
    rerender({ key: 't_2:2:' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(true)
  })

  it('resets scrollTop to 0 on an item switch (M3: scroll position must not carry over between items)', () => {
    // Real DOM: the container is the SAME .main element across items (React only swaps the
    // ThreadView/StageView children below it), so nothing resets scrollTop on its own — unlike
    // the other item-switch tests above, which simulate a fresh layout by setting scrollTop by
    // hand. Here it is left at its old value to prove the hook itself must reset it.
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 900 }) // scrolled deep into t_1
    const { rerender } = setup(el, 't_1:1:')

    Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true })
    rerender({ key: 't_2:1:' }) // switch to a different item; scrollTop still stuck at 900

    expect(el.scrollTop).toBe(0)
  })

  it('arm() forces the next same-item growth to scroll even when scrolled up (fix round 2)', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from bottom
    const { result, rerender } = setup(el, 't_1:1:')
    result.current.arm()
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' })
    expect(el.scrollTo).toHaveBeenCalled()
    expect(result.current.showPill).toBe(false)
  })

  it('a failed action does not arm (fix round 2)', () => {
    // Simulates a component that only calls arm() after a successful action; a failed one
    // simply never calls it, so this asserts the baseline (no call, scrolled up) behaves as
    // the ordinary far-from-bottom case: pill, no forced scroll.
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    const { result, rerender } = setup(el, 't_1:1:')
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(true)
  })

  it('arm() does not fire on an item switch, and does not carry over to the new item (fix round 2)', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from bottom
    const { result, rerender } = setup(el, 't_1:1:')
    result.current.arm()

    // Switch item (e.g. auto-advance after Accept, or the user navigating away).
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    el.scrollTop = 0
    rerender({ key: 't_2:1:' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(false) // switching itself never shows the pill either

    // New content grows in the new item while still far from its bottom: the stale arm must not
    // force a scroll here.
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_2:2:' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(true)
  })

  it('a manual scroll after arm() disarms it (fix round 2)', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from bottom
    const { result, rerender } = setup(el, 't_1:1:')
    result.current.arm()
    el.scrollTop = 5 // the user scrolls a little; still far from the bottom
    el.dispatchEvent(new Event('scroll'))

    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(true)
  })

  it('returns a referentially stable object across rerenders when nothing changed (regression: ctx stability)', () => {
    // LoadedSession's ctx useMemo depends on `follow` as a whole; a fresh object literal on
    // every call (even with unchanged showPill/scrollToBottom/arm) would make ctx — and every
    // consumer of useSessionCtx, including the global keydown listener — re-render/re-subscribe
    // on every unrelated render (e.g. a Toast notice).
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
    const { result, rerender } = setup(el, 't_1:1:')
    const first = result.current
    rerender({ key: 't_1:1:' })
    expect(result.current).toBe(first)
  })

  it('does not auto-scroll while focus is in an unrelated input, but still shows the pill', () => {
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    try {
      const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - 50 }) // near bottom
      const { result, rerender } = setup(el, 't_1:1:')
      Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
      rerender({ key: 't_1:2:' })
      expect(el.scrollTo).not.toHaveBeenCalled()
      expect(result.current.showPill).toBe(true)
    } finally {
      input.remove()
    }
  })
})

describe('useFollowBottom landOn (demo2 follow-up 6)', () => {
  function setupLanding(el: HTMLElement, contentKey: string, target: { current: HTMLElement | null }) {
    const ref = { current: el as HTMLElement | null }
    return renderHook(({ key }) => useFollowBottom(ref, key, () => target.current), { initialProps: { key: contentKey } })
  }
  function summary() {
    const s = document.createElement('section')
    s.scrollIntoView = vi.fn()
    return s
  }

  it('scrolls to the start of the landing target instead of the bottom', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 }) // near the bottom
    const target = { current: null as HTMLElement | null }
    const { result, rerender } = setupLanding(el, 'st_1:', target)
    target.current = summary()
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 'st_1:We keep a log.' })
    expect(target.current.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(false)
  })

  it('lands even when scrolled up, and jumps under prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    try {
      const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }) // far from the bottom
      const target = { current: null as HTMLElement | null }
      const { result, rerender } = setupLanding(el, 'st_1:', target)
      target.current = summary()
      rerender({ key: 'st_1:We keep a log.' })
      expect(target.current.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
      expect(result.current.showPill).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('follows the bottom as before when there is no landing target', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 })
    const { rerender } = setupLanding(el, 'st_1:', { current: null })
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 'st_1:' + 'x' })
    expect(el.scrollTo).toHaveBeenCalled()
  })

  it('does not land on an item switch', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    const target = { current: summary() }
    const { rerender } = setupLanding(el, 't_1:1:', target)
    rerender({ key: 'st_1:We keep a log.' })
    expect(target.current.scrollIntoView).not.toHaveBeenCalled()
  })
})

// Demo 7 follow-ups 3: each item's scroll position is remembered when leaving it and restored on
// return. A browser fires a scroll event for every user scroll, so the tests dispatch one too.
describe('useFollowBottom restores scroll per item (demo 7 follow-ups 3)', () => {
  function scrollBy(el: HTMLElement, top: number) {
    el.scrollTop = top
    el.dispatchEvent(new Event('scroll'))
  }

  it('restores the scroll position when returning to an item; a never-visited item starts at the top', () => {
    const el = makeContainer({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
    const { result, rerender } = setup(el, 't_1:1:')
    scrollBy(el, 700)

    rerender({ key: 't_2:1:' }) // never visited
    expect(el.scrollTop).toBe(0)
    scrollBy(el, 300)

    rerender({ key: 't_1:1:' })
    expect(el.scrollTop).toBe(700)
    expect(result.current.showPill).toBe(false)
    rerender({ key: 't_2:1:' })
    expect(el.scrollTop).toBe(300)
    rerender({ key: 't_3:1:' }) // never visited
    expect(el.scrollTop).toBe(0)
  })

  it('re-measures near-bottom after restoring, so later growth follows only when restored near the bottom', () => {
    const el = makeContainer({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
    const { result, rerender } = setup(el, 't_1:1:')
    scrollBy(el, 700) // far from t_1's bottom
    rerender({ key: 't_2:1:' })
    rerender({ key: 't_1:1:' })
    Object.defineProperty(el, 'scrollHeight', { value: 3400, configurable: true })
    rerender({ key: 't_1:2:' })
    expect(el.scrollTo).not.toHaveBeenCalled()
    expect(result.current.showPill).toBe(true)
  })

  it('restores an item the user was following at the bottom to its (new) bottom, and keeps following', () => {
    const el = makeContainer({ scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    const { result, rerender } = setup(el, 't_1:1:')
    scrollBy(el, 1450) // within the follow threshold of t_1's bottom (not exactly at it)

    rerender({ key: 't_2:1:' })
    expect(el.scrollTop).toBe(0)

    // t_1 grew while the user was away.
    Object.defineProperty(el, 'scrollHeight', { value: 2600, configurable: true })
    rerender({ key: 't_1:3:' })
    expect(el.scrollTop).toBe(2600 - 500)
    expect(result.current.showPill).toBe(false)

    Object.defineProperty(el, 'scrollHeight', { value: 3000, configurable: true })
    rerender({ key: 't_1:4:' })
    expect(el.scrollTo).toHaveBeenCalled()
  })

  it('remembers an item followed to its bottom by a follow scroll, with no user scroll event', () => {
    const el = makeContainer({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 })
    const { rerender } = setup(el, 't_1:1:')
    Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true })
    rerender({ key: 't_1:2:' }) // followed to the bottom (scrollTo)
    rerender({ key: 't_2:1:' })
    rerender({ key: 't_1:2:' })
    expect(el.scrollTop).toBe(1400 - 500)
  })

  it('lands on a landing target that changed while the user was away, instead of restoring', () => {
    const el = makeContainer({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
    const ref = { current: el as HTMLElement | null }
    const target = document.createElement('section')
    target.scrollIntoView = vi.fn()
    const landing = { current: null as HTMLElement | null }
    const { rerender } = renderHook(({ key }) => useFollowBottom(ref, key, () => landing.current), {
      initialProps: { key: 'st_1:' },
    })
    scrollBy(el, 700)
    rerender({ key: 't_1:1:' })
    landing.current = target // the summary was proposed while the user was on t_1
    rerender({ key: 'st_1:We keep a log.' })
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })
})

// Fix round 1 (batch 2 review): a hashchange navigation is a default-priority update, so the
// browser can paint, clamp scrollTop to the new (shorter) item and fire a scroll event before
// passive effects run. The item being left must already be saved by then: the switch runs in a
// layout effect. A child's passive effect runs before its parent's, so it stands in for that
// early scroll event here.
describe('useFollowBottom saves the item being left before a clamp scroll event (fix round 1)', () => {
  it('restores a long item read mid-way, not its bottom, after a shorter item clamped scrollTop', () => {
    const el = makeContainer({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
    const ref = { current: el as HTMLElement | null }
    function Clamp({ contentKey }: { contentKey: string }) {
      useEffect(() => {
        const max = el.scrollHeight - el.clientHeight
        if (el.scrollTop > max) el.scrollTop = max
        el.dispatchEvent(new Event('scroll'))
      }, [contentKey])
      return null
    }
    function Host({ contentKey, children }: { contentKey: string; children: ReactNode }) {
      useFollowBottom(ref, contentKey)
      return <>{children}</>
    }
    const ui = (key: string) => (
      <Host contentKey={key}>
        <Clamp contentKey={key} />
      </Host>
    )
    const { rerender } = render(ui('t_1:1:'))
    el.scrollTop = 700
    el.dispatchEvent(new Event('scroll'))

    Object.defineProperty(el, 'scrollHeight', { value: 800, configurable: true }) // t_2 is short
    rerender(ui('t_2:1:'))
    Object.defineProperty(el, 'scrollHeight', { value: 3000, configurable: true })
    rerender(ui('t_1:1:'))
    expect(el.scrollTop).toBe(700)
  })
})

// Scroll restore with late content: file/markdown blocks load their text after mount, so on a
// return the item is still short when the switch runs, and the browser clamps the restored
// scrollTop. The hook keeps the restore pending and re-applies it as the content grows (observed
// with a ResizeObserver, stubbed here), until reached, a user scroll, another switch, a jump
// (cancelRestore) or a timeout.
describe('useFollowBottom re-applies a restored position as late content loads', () => {
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observed = new Set<Element>()
    constructor(private cb: ResizeObserverCallback) {
      FakeResizeObserver.instances.push(this)
    }
    observe(t: Element) {
      this.observed.add(t)
    }
    unobserve(t: Element) {
      this.observed.delete(t)
    }
    disconnect() {
      this.observed.clear()
    }
    static fire() {
      for (const o of FakeResizeObserver.instances)
        if (o.observed.size) o.cb([], o as unknown as ResizeObserver)
    }
  }

  // A container that clamps scrollTop like a browser does, with a mutable content height.
  function makeClamping(clientHeight: number, scrollHeight: number) {
    const el = document.createElement('div')
    el.appendChild(document.createElement('article'))
    const box = { height: scrollHeight, top: 0 }
    Object.defineProperty(el, 'scrollHeight', { get: () => Math.max(box.height, clientHeight), configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
    Object.defineProperty(el, 'scrollTop', {
      get: () => box.top,
      set: (v: number) => {
        const next = Math.max(0, Math.min(v, Math.max(box.height, clientHeight) - clientHeight))
        const changed = next !== box.top
        box.top = next
        if (changed) el.dispatchEvent(new Event('scroll'))
      },
      configurable: true,
    })
    el.scrollTo = vi.fn((arg: ScrollToOptions | number) => {
      if (typeof arg === 'object' && typeof arg.top === 'number') el.scrollTop = arg.top
    }) as typeof el.scrollTo
    const grow = (h: number) => {
      box.height = h
      FakeResizeObserver.fire()
    }
    const setHeight = (h: number) => {
      box.height = h
    }
    return { el, grow, setHeight }
  }

  function withRO(fn: () => void) {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      fn()
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('reaches the saved position once the content has grown enough', () =>
    withRO(() => {
      const { el, grow, setHeight } = makeClamping(700, 3800)
      const { rerender } = setup(el, 't_2:1:')
      el.scrollTop = 1000
      setHeight(900) // t_1 is short
      rerender({ key: 't_1:1:' })
      setHeight(700) // t_2 comes back before its file block has loaded
      rerender({ key: 't_2:1:' })
      expect(el.scrollTop).toBe(0) // clamped
      grow(1200)
      expect(el.scrollTop).toBe(500) // as far as it can go so far
      grow(3800)
      expect(el.scrollTop).toBe(1000)
      grow(5000) // reached: further growth leaves it alone
      expect(el.scrollTop).toBe(1000)
    }))

  it('reaches the new bottom of an item the user was following at its bottom', () =>
    withRO(() => {
      const { el, grow, setHeight } = makeClamping(700, 2000)
      const { rerender } = setup(el, 't_2:1:')
      el.scrollTop = 1300 // at the bottom
      setHeight(900)
      rerender({ key: 't_1:1:' })
      setHeight(1000)
      rerender({ key: 't_2:1:' })
      expect(el.scrollTop).toBe(300)
      grow(3000)
      expect(el.scrollTop).toBe(2300)
    }))

  it('a user wheel or keydown before the content grows cancels the pending restore', () =>
    withRO(() => {
      for (const type of ['wheel', 'keydown', 'touchmove', 'pointerdown']) {
        const { el, grow, setHeight } = makeClamping(700, 3800)
        const { rerender, unmount } = setup(el, 't_2:1:')
        el.scrollTop = 1000
        setHeight(900)
        rerender({ key: 't_1:1:' })
        setHeight(700)
        rerender({ key: 't_2:1:' })
        el.dispatchEvent(new Event(type, { bubbles: true }))
        grow(3800)
        expect(el.scrollTop, type).toBe(0)
        unmount()
      }
    }))

  it('leaving before the content loads keeps the originally saved position for the item', () =>
    withRO(() => {
      const { el, grow, setHeight } = makeClamping(700, 3800)
      const { rerender } = setup(el, 't_2:1:')
      el.scrollTop = 1000
      setHeight(900)
      rerender({ key: 't_1:1:' })
      setHeight(700)
      rerender({ key: 't_2:1:' }) // clamped to 0, fires a scroll event
      setHeight(900)
      rerender({ key: 't_1:1:' }) // left before t_2's file block loaded
      grow(900) // growth now belongs to t_1: nothing to restore there (top 0)
      expect(el.scrollTop).toBe(0)
      setHeight(700)
      rerender({ key: 't_2:1:' })
      grow(3800)
      expect(el.scrollTop).toBe(1000)
    }))

  it('a jump via cancelRestore() wins over the pending restore', () =>
    withRO(() => {
      const { el, grow, setHeight } = makeClamping(700, 3800)
      const { result, rerender } = setup(el, 't_2:1:')
      el.scrollTop = 1000
      setHeight(900)
      rerender({ key: 't_1:1:' })
      setHeight(700)
      rerender({ key: 't_2:1:' })
      result.current.cancelRestore()
      el.scrollTop = 0 // stands in for the jump target's scrollIntoView
      grow(3800)
      expect(el.scrollTop).toBe(0)
    }))

  it('gives up after a timeout', () =>
    withRO(() => {
      vi.useFakeTimers()
      try {
        const { el, grow, setHeight } = makeClamping(700, 3800)
        const { rerender } = setup(el, 't_2:1:')
        el.scrollTop = 1000
        setHeight(900)
        rerender({ key: 't_1:1:' })
        setHeight(700)
        rerender({ key: 't_2:1:' })
        vi.advanceTimersByTime(3500)
        grow(3800)
        expect(el.scrollTop).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }))

  // pin(): a jump's target is kept centered while content above it grows.
  function makePinned() {
    const c = makeClamping(700, 2000)
    const target = document.createElement('div')
    c.el.firstElementChild!.appendChild(target)
    const box = { y: 344 } // the target's offset in the content; late content above moves it
    target.scrollIntoView = vi.fn(() => {
      c.el.scrollTop = box.y - 350
    }) as typeof target.scrollIntoView
    document.body.appendChild(c.el)
    return { ...c, target, box }
  }

  it('pin() re-centers the target when content resizes, and reports the move', () =>
    withRO(() => {
      const { el, grow, target, box } = makePinned()
      const onMoved = vi.fn()
      const { result } = setup(el, 't_1:1:')
      result.current.pin(target, onMoved)
      grow(2000) // nothing moved the target: no scroll, no report
      expect(onMoved).not.toHaveBeenCalled()
      box.y = 935 // a file block above grew
      grow(2600)
      expect(el.scrollTop).toBe(585)
      expect(onMoved).toHaveBeenCalledTimes(1)
      box.y = 1200
      grow(2900)
      expect(el.scrollTop).toBe(850)
      expect(onMoved).toHaveBeenCalledTimes(2)
      el.remove()
    }))

  it('a user scroll input cancels the pin', () =>
    withRO(() => {
      for (const type of ['wheel', 'keydown', 'touchmove', 'pointerdown']) {
        const { el, grow, target, box } = makePinned()
        const { result, unmount } = setup(el, 't_1:1:')
        result.current.pin(target)
        el.dispatchEvent(new Event(type, { bubbles: true }))
        box.y = 935
        grow(2600)
        expect(el.scrollTop, type).toBe(0)
        unmount()
        el.remove()
      }
    }))

  it('pin() ends on a timeout, on cancelRestore() and on an item switch', () =>
    withRO(() => {
      vi.useFakeTimers()
      try {
        for (const end of ['timeout', 'cancel', 'switch']) {
          const { el, grow, target, box } = makePinned()
          const { result, rerender, unmount } = setup(el, 't_1:1:')
          result.current.pin(target)
          if (end === 'timeout') vi.advanceTimersByTime(3500)
          else if (end === 'cancel') result.current.cancelRestore()
          else rerender({ key: 't_2:1:' })
          box.y = 935
          grow(2600)
          expect(el.scrollTop, end).toBe(0)
          unmount()
          el.remove()
        }
      } finally {
        vi.useRealTimers()
      }
    }))

  it('does not start a pending restore when a landing target is used', () =>
    withRO(() => {
      const { el, grow, setHeight } = makeClamping(700, 3800)
      const ref = { current: el as HTMLElement | null }
      const target = document.createElement('section')
      target.scrollIntoView = vi.fn()
      const landing = { current: null as HTMLElement | null }
      const { rerender } = renderHook(({ key }) => useFollowBottom(ref, key, () => landing.current), {
        initialProps: { key: 'st_1:' },
      })
      el.scrollTop = 1000
      setHeight(900)
      rerender({ key: 't_1:1:' })
      landing.current = target
      setHeight(700)
      rerender({ key: 'st_1:We keep a log.' })
      expect(target.scrollIntoView).toHaveBeenCalled()
      grow(3800)
      expect(el.scrollTop).toBe(0)
    }))
})
