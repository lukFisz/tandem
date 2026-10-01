import type { Proposal } from '../api/types'

// previewOf is the one-line preview of a collapsed proposal card (stage summary flow spec, part D):
// the first sentence of the first paragraph that is not a heading (the heading when that is all
// there is), as plain text. List, quote and heading markers at its start and bold and code marks
// are dropped. Single `*` and `_` stay, so ids like t_2 survive. The sentence ends at the first
// `.`, `!` or `?` followed by a space or the end of the line, and CSS clips what does not fit.
export function previewOf(text: string): string {
  return preview(text).preview
}

// hasMore is true when the full text holds more than previewOf shows: another non-empty line (a
// heading left out, a second paragraph or list item) or more after the first sentence. The
// collapsed card then ends its preview with "(...)" (demo 7 follow-ups 1).
export function hasMore(text: string): boolean {
  const { lines, plain, preview: shown } = preview(text)
  return lines > 1 || plain.slice(shown.length).trim() !== ''
}

function preview(text: string): { lines: number; plain: string; preview: string } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const line = lines.find((l) => !l.startsWith('#')) ?? lines[0] ?? ''
  const plain = line.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '').replace(/\*\*|__|`/g, '')
  return { lines: lines.length, plain, preview: /^.*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain }
}

export interface PastProposal {
  version: number
  seq: number
  text: string
}

// earlierProposals are the proposals the timeline lists as closed "vN" entries (part D). The
// newest is left out only while something else shows that very text: the live card (proposed) or
// the accepted text (resolved or accepted), passed as shownText. A proposal the user edited, or an
// edited accept, shows another text, so the AI's newest version is listed too; with nothing shown
// (a thread or stage sent back to open in older logs), every version is listed.
export function earlierProposals(proposals: Proposal[] | undefined, shownText: string | undefined): PastProposal[] {
  const all = (proposals ?? []).map((p, i) => ({ version: i + 1, seq: p.seq, text: p.text }))
  const newestShown = shownText !== undefined && shownText === proposals?.at(-1)?.text
  return newestShown ? all.slice(0, -1) : all
}
