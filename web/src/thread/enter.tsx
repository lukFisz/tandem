import type { ReactElement } from 'react'

// enterIfNew wraps a timeline item that arrived after its thread or stage page was opened (its seq
// is past the page's lastSeq at mount) in a .tl-item.tl-enter box, so it eases in once. Items
// present at mount, and every item after a thread or stage switch (the body remounts), render
// unwrapped. An item's seq never changes, so it never flips between wrapped and unwrapped.
export function enterIfNew(el: ReactElement, seq: number, mountSeq: number): ReactElement {
  if (seq <= mountSeq) return el
  return (
    <div key={el.key ?? undefined} className="tl-item tl-enter">
      {el}
    </div>
  )
}

// newestSeq is the seq a page takes as "already there" at mount: the session's lastSeq, or a
// listed item's seq if one is higher (never in a live snapshot, but it keeps an item that is on
// the page from the start from ever easing in).
export function newestSeq(lastSeq: number, items: { seq: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.seq), lastSeq)
}
