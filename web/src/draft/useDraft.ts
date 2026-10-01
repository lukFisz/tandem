import { useCallback, useEffect, useState } from 'react'
import { addComment, loadDraft, removeComments, saveDraft, updateComment, type Draft, type NewDraftComment } from './draft'

export function useDraft(sid: string) {
  // Keep sid and draft together so a sid change is detected during render
  // (React's "adjust state when a prop changes" pattern) instead of relying
  // on a lazy useState initializer, which only runs on mount.
  const [state, setState] = useState<{ sid: string; draft: Draft }>(() => ({ sid, draft: loadDraft(sid) }))
  if (state.sid !== sid) {
    setState({ sid, draft: loadDraft(sid) })
  }
  const draft = state.sid === sid ? state.draft : loadDraft(sid)

  useEffect(() => {
    if (state.sid === sid) saveDraft(sid, state.draft)
  }, [sid, state])

  const add = useCallback((c: NewDraftComment) => setState((s) => ({ ...s, draft: addComment(s.draft, c) })), [])
  const update = useCallback((id: string, text: string) => setState((s) => ({ ...s, draft: updateComment(s.draft, id, text) })), [])
  const removeMany = useCallback((ids: string[]) => setState((s) => ({ ...s, draft: removeComments(s.draft, ids) })), [])
  return { draft, add, update, removeMany }
}
