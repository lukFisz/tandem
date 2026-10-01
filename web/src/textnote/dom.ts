import type { Anchor } from './notes'

// The DOM contract: a block that takes notes on selected text is marked data-tn-block="<id>"; its
// rows carry data-ls / data-le (their line range, as for line drags) and hold their text in a
// .src (code) or .prose (markdown section) child. A thread chat message is marked
// data-tn-msg="<seq>" data-tn-thread="<id>", with its text in a [data-tn-text] element.
const ROOT = '[data-tn-block], [data-tn-msg]'
const ROW_TEXT = ':scope > .src, :scope > .prose'
const ZWSP = /​/g

// TEXT_NOTE_EVENT carries the keys that act on the 💬 Note pill (handleShortcut) to TextNotes:
// detail 'open' (c) or 'dismiss' (Escape).
export const TEXT_NOTE_EVENT = 'tdm:text-note'

export function hasTextNotePill(): boolean {
  return document.querySelector('.tn-pill') !== null
}

export type Captured = { anchor: Anchor; quote: string; range: Range; root: Element }

const elementOf = (n: Node): Element | null => (n instanceof Element ? n : n.parentElement)

// rowTexts lists a block's rows with their text element, in document order.
function rowTexts(root: Element): { text: Element; lines: { start: number; end: number } }[] {
  const out: { text: Element; lines: { start: number; end: number } }[] = []
  for (const row of root.querySelectorAll<HTMLElement>('[data-ls]')) {
    if (row.closest(ROOT) !== root) continue
    const text = row.querySelector(ROW_TEXT)
    if (text) out.push({ text, lines: { start: Number(row.dataset.ls), end: Number(row.dataset.le) } })
  }
  return out
}

function messageText(root: Element): Element {
  return root.matches('[data-tn-text]') ? root : (root.querySelector('[data-tn-text]') ?? root)
}

// clip is the part of range inside el (an empty range when they do not meet).
function clip(range: Range, el: Element): Range {
  const r = document.createRange()
  r.selectNodeContents(el)
  if (!range.intersectsNode(el)) {
    r.collapse(true)
    return r
  }
  if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset)
  if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset)
  return r
}

const textOf = (r: Range) => r.toString().replace(ZWSP, '')

// capture reads a native selection that lies inside one block or chat message: its anchor (for a
// block, the lines of the rows it touches), the selected text, and the range. For code the quote
// joins the selected part of each line with newlines, so it is a substring of the source lines.
export function capture(sel: Selection | null): Captured | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  const root = elementOf(range.commonAncestorContainer)?.closest(ROOT)
  if (!root) return null
  if (root instanceof HTMLElement && root.dataset.tnMsg) {
    const quote = textOf(clip(range, messageText(root))).trim()
    if (!quote) return null
    const anchor: Anchor = { kind: 'message', threadId: root.dataset.tnThread ?? '', messageSeq: Number(root.dataset.tnMsg) }
    return { anchor, quote, range: range.cloneRange(), root }
  }
  const touched = rowTexts(root)
    .filter((r) => range.intersectsNode(r.text))
    .map((r) => ({ ...r, part: textOf(clip(range, r.text)) }))
  while (touched.length && !touched[0].part.trim()) touched.shift()
  while (touched.length && !touched[touched.length - 1].part.trim()) touched.pop()
  if (!touched.length) return null
  const quote = touched
    .map((r) => r.part)
    .join('\n')
    .trim()
  const blockId = (root as HTMLElement).dataset.tnBlock ?? ''
  const lines = { start: touched[0].lines.start, end: touched[touched.length - 1].lines.end }
  return { anchor: { kind: 'block', threadId: '', blockId, lines }, quote, range: range.cloneRange(), root }
}

// anchorRoots finds the elements a note's anchor renders in (a block can show twice: in the
// thread and in the expanded-block modal).
export function anchorRoots(anchor: Anchor, scope: ParentNode = document): Element[] {
  const sel =
    anchor.kind === 'block'
      ? `[data-tn-block="${anchor.blockId}"]`
      : `[data-tn-msg="${anchor.messageSeq}"][data-tn-thread="${anchor.threadId}"]`
  return [...scope.querySelectorAll(sel)]
}

// findQuote returns the range of the first occurrence of quote in the anchored text of root. It
// ignores whitespace, since rendered markdown and the selected text can differ in it.
export function findQuote(root: Element, anchor: Anchor, quote: string): Range | null {
  const texts =
    anchor.kind === 'message'
      ? [messageText(root)]
      : rowTexts(root)
          .filter((r) => r.lines.end >= anchor.lines.start && r.lines.start <= anchor.lines.end)
          .map((r) => r.text)
  const nodes: Text[] = []
  const offsets: number[] = []
  let flat = ''
  for (const el of texts) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      const v = n.data
      for (let i = 0; i < v.length; i++) {
        if (/\s|​/.test(v[i])) continue
        flat += v[i]
        nodes.push(n)
        offsets.push(i)
      }
    }
  }
  const needle = quote.replace(/\s|​/g, '')
  const at = needle ? flat.indexOf(needle) : -1
  if (at < 0) return null
  const end = at + needle.length - 1
  const r = document.createRange()
  r.setStart(nodes[at], offsets[at])
  r.setEnd(nodes[end], offsets[end] + 1)
  return r
}

// lastRect is where a range ends on screen (its last line box), for placing popovers.
export function lastRect(range: Range): DOMRect | null {
  const rects = range.getClientRects?.()
  if (rects && rects.length) return rects[rects.length - 1]
  const b = range.getBoundingClientRect?.()
  return b && (b.width || b.height) ? b : null
}

// hits reports whether the point (clientX, clientY) is over the text of range.
export function hits(range: Range, x: number, y: number): boolean {
  for (const r of range.getClientRects?.() ?? []) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  return false
}
