import { prefersReducedMotion } from '../shell/motion'

// The flash's CSS animation duration (app.css's tdm-flash) — under reduced motion the animation
// is switched off (a static outline stands in for it, see app.css), so animationend never
// fires; this timer removes is-flash instead, matching how long the animation would have shown.
const FLASH_MS = 1600

// showSentComments scrolls to the first sent note of one send (its review seq) and briefly
// flashes all of them; a note on selected text is found by its badge. A note inside a collapsed superseded block is expanded first. Returns
// false when none of the notes is on the page. Honors prefers-reduced-motion: the scroll jumps
// instead of smooth-scrolling, and the flash is a static highlight cleared on a timer.
export function showSentComments(root: ParentNode, seq: number): boolean {
  const notes = [
    ...root.querySelectorAll<HTMLElement>(`.line-note[data-comment-seq="${seq}"], .tn-badge[data-comment-seqs~="${seq}"]`),
  ]
  if (notes.length === 0) return false
  const reduced = prefersReducedMotion()
  for (const note of notes) {
    const details = note.closest('details')
    if (details && !details.open) details.open = true
    note.classList.remove('is-flash')
    void note.offsetWidth // restart the animation on a repeated click
    note.classList.add('is-flash')
    if (reduced) setTimeout(() => note.classList.remove('is-flash'), FLASH_MS)
    else note.addEventListener('animationend', () => note.classList.remove('is-flash'), { once: true })
  }
  notes[0].scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  return true
}
