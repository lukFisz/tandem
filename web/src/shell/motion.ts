// prefersReducedMotion is shared by anything that scrolls or animates on its own (useFollowBottom's
// scrollToBottom, showSentComments' jump-and-flash) so they all honor the OS setting the same way.
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// scrollFullyIntoView scrolls the least needed to show all of el: for an editor opened near the
// bottom edge, that brings its buttons into view too (demo2 follow-up 1). Honors reduced motion.
// A no-op where scrollIntoView is missing (jsdom).
export function scrollFullyIntoView(el: Element): void {
  if (typeof el.scrollIntoView !== 'function') return
  el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

// JUMP_HIGHLIGHT_MS is how long the target of a jump stays tinted: app.css's tdm-jump fade runs
// this long, and under reduced motion the static tint shows for as long (demo 6 follow-ups 3).
export const JUMP_HIGHLIGHT_MS = 1000

const jumpTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

// highlightJumpTarget tints the option or question a chip or header link jumped to. Like the nav's
// resolve flash, the class is dropped on a timer, so it behaves the same with and without reduced
// motion. A repeated jump restarts it: the class comes off and back on after a reflow (restarting
// the animation), and the earlier timer is cancelled so it cannot clear the new tint early.
export function highlightJumpTarget(el: HTMLElement): void {
  clearTimeout(jumpTimers.get(el))
  el.classList.remove('is-jump-target')
  void el.offsetWidth // restart the animation on a repeated jump
  el.classList.add('is-jump-target')
  jumpTimers.set(
    el,
    setTimeout(() => {
      el.classList.remove('is-jump-target')
      jumpTimers.delete(el)
    }, JUMP_HIGHLIGHT_MS),
  )
}

// clearJumpHighlight cancels a pending highlightJumpTarget timer for el, if any, and removes the
// tint immediately. The timer and the class always go together, so SessionPage's effect calls this
// as its cleanup: on unmount, so no timer outlives the component, and on a jump from one element to
// another, so the previous jump's target (which the effect is about to move away from) is not left
// tinted forever. A no-op when el has no pending timer.
export function clearJumpHighlight(el: Element): void {
  clearTimeout(jumpTimers.get(el))
  jumpTimers.delete(el)
  el.classList.remove('is-jump-target')
}
