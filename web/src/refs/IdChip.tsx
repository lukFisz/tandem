import { Fragment, useContext, useMemo } from 'react'
import { SessionContext } from '../session/context'
import type { State } from '../api/types'
import { idTitles, splitIds, type TitleOf } from './ids'

// useTitleOf resolves ids against the current session state. It is undefined outside a session,
// where agent text renders as written. Every SSE event brings a new state object, so the function
// is memoized on the id/title pairs, not on the state: it keeps its identity (and Prose keeps its
// rendered markdown) until a title actually changes.
export function useTitleOf(): TitleOf | undefined {
  const state = useContext(SessionContext)?.state
  const key = state ? titleKey(state) : undefined
  return useMemo(() => {
    if (key === undefined) return undefined
    const titles = new Map<string, string>(JSON.parse(key))
    return (id: string) => titles.get(id)
  }, [key])
}

function titleKey(state: State): string {
  return JSON.stringify(idTitles(state))
}

// IdChip shows a thread, stage, block or option by its title (demo2 follow-up 4, question message spec).
// It is a plain link to #<id>, so a click opens the item through the page's hash routing
// (useCurrentItem, which maps a block or option to its thread and scrolls to it). The title attribute
// shows the id on hover. Its HTML twin for markdown is idChipHtml (markdown/markdown.ts); keep
// the two in sync.
export function IdChip({ id, title }: { id: string; title: string }) {
  return (
    <a className="id-chip" href={`#${id}`} title={`id: ${id}`}>
      {title}
    </a>
  )
}

// AgentText renders plain (non-markdown) agent text with its thread and stage ids as chips.
export function AgentText({ text }: { text: string }) {
  const titleOf = useTitleOf()
  if (!titleOf) return <>{text}</>
  return (
    <>
      {splitIds(text, titleOf).map((s, i) =>
        s.kind === 'text' ? <Fragment key={i}>{s.text}</Fragment> : <IdChip key={i} id={s.id} title={s.title} />,
      )}
    </>
  )
}
