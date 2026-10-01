import { useCallback, useState } from 'react'

// Unsent text the user typed in one thread or on one stage page (demo2 follow-up 2; stage summary flow spec, part E): the composer's reply and the
// Resolve note. Kept in localStorage per session and thread, like the draft comments (draft.ts),
// so a thread switch or a reload does not lose it. A successful send (composer) or Resolve (note),
// or Cancel on the note, clears it. Every access is guarded: localStorage may be missing or may
// throw (private mode, blocked site data, quota), and the text then lives in memory only.
export type ThreadTextKind = 'composer' | 'note'

const key = (kind: ThreadTextKind, sid: string, threadId: string) => `tdm:${kind}:${sid}:${threadId}`

export function loadThreadText(kind: ThreadTextKind, sid: string, threadId: string): string {
  try {
    return localStorage.getItem(key(kind, sid, threadId)) ?? ''
  } catch {
    return ''
  }
}

// saveThreadText stores the text as typed, or removes the entry when it is blank.
export function saveThreadText(kind: ThreadTextKind, sid: string, threadId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(key(kind, sid, threadId), text)
    else localStorage.removeItem(key(kind, sid, threadId))
  } catch {
    // Storage unavailable: the text still lives in component state.
  }
}

// useThreadText is useState backed by loadThreadText/saveThreadText. Its callers remount per
// thread (ThreadView keys its body on the thread id), so the initial load runs once per thread.
export function useThreadText(kind: ThreadTextKind, sid: string, threadId: string): [string, (text: string) => void] {
  const [text, setText] = useState(() => loadThreadText(kind, sid, threadId))
  const set = useCallback(
    (next: string) => {
      setText(next)
      saveThreadText(kind, sid, threadId, next)
    },
    [kind, sid, threadId],
  )
  return [text, set]
}
