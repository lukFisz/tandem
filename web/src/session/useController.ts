import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchBlob, openFile, postAction } from '../api/client'
import type { Action, Snapshot } from '../api/types'
import { staleComments, toReview, type Draft, type DraftComment } from '../draft/draft'
import { useDraft } from '../draft/useDraft'
import { agentQuietMinutes } from './agent'
import { noticeFromError, type Notice, type Selection, type SessionCtx } from './context'
import { useNow } from './clock'

export function useController(sid: string, snapshot: Snapshot, notify: (n: Notice) => void): SessionCtx {
  const { draft, add, update, removeMany } = useDraft(sid)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [expandedBlock, expandBlock] = useState<string | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const blobs = useRef(new Map<string, Promise<string>>())
  const { state, waiting, processOutput } = snapshot
  const readOnly = state.session.status === 'closed'
  const now = useNow()
  const quietMinutes = agentQuietMinutes(snapshot, now)

  // Comments a send is still in flight for. Excluded from the next send's
  // review so a second run/sendReview issued before the first resolves
  // (e.g. a double ⌘↵) never submits the same comments twice.
  const inFlight = useRef(new Set<string>())

  // Comments the daemon would reject would make every later action fail: drop them.
  useEffect(() => {
    const stale = staleComments(draft, state)
    if (stale.length) removeMany(stale)
  }, [draft, state, removeMany])

  // Removes only the sent comments whose text is unchanged since they were
  // sent: an edit made while the send was in flight was never submitted, so
  // it must survive (Review Focus 1).
  const removeUnchanged = useCallback(
    (sent: DraftComment[]) => {
      const now = draftRef.current.comments
      const ids = sent
        .filter((c) => {
          const current = now.find((dc) => dc.id === c.id)
          return current !== undefined && current.text === c.text
        })
        .map((c) => c.id)
      removeMany(ids)
    },
    [removeMany],
  )

  const eligible = useCallback((d: Draft): DraftComment[] => d.comments.filter((c) => !inFlight.current.has(c.id)), [])

  const send = useCallback(
    async (action: Action, withDraft: boolean) => {
      if (readOnly) return false
      const sent = withDraft ? eligible(draftRef.current) : []
      sent.forEach((c) => inFlight.current.add(c.id))
      try {
        const review = withDraft ? toReview({ comments: sent }) : undefined
        await (review ? postAction(sid, action, review) : postAction(sid, action))
        if (withDraft) removeUnchanged(sent)
        return true
      } catch (e) {
        notify(noticeFromError(e))
        return false
      } finally {
        sent.forEach((c) => inFlight.current.delete(c.id))
      }
    },
    [sid, notify, readOnly, eligible, removeUnchanged],
  )

  const run = useCallback((action: Action) => send(action, true), [send])

  const sendReview = useCallback(
    async (extra?: { threadId: string; message: string }) => {
      if (readOnly) return false
      const sent = eligible(draftRef.current)
      const review = toReview({ comments: sent }, extra)
      if (!review) return false
      sent.forEach((c) => inFlight.current.add(c.id))
      try {
        await postAction(sid, { type: 'review.submit', data: review })
        removeUnchanged(sent)
        return true
      } catch (e) {
        notify(noticeFromError(e))
        return false
      } finally {
        sent.forEach((c) => inFlight.current.delete(c.id))
      }
    },
    [sid, notify, readOnly, eligible, removeUnchanged],
  )

  const loadBlob = useCallback(
    (sha: string) => {
      let p = blobs.current.get(sha)
      if (!p) {
        p = fetchBlob(sid, sha)
        blobs.current.set(sha, p)
        p.catch(() => blobs.current.delete(sha))
      }
      return p
    },
    [sid],
  )

  const openPath = useCallback(
    async (path: string, line?: number) => {
      try {
        return await openFile(sid, path, line)
      } catch (e) {
        notify(noticeFromError(e))
        return null
      }
    },
    [sid, notify],
  )

  const removeDraft = useCallback((id: string) => removeMany([id]), [removeMany])

  return useMemo<SessionCtx>(
    () => ({
      sid,
      state,
      waiting,
      processOutput,
      quietMinutes,
      readOnly,
      draft,
      addDraft: add,
      updateDraft: update,
      removeDraft,
      selection,
      setSelection,
      expandedBlock,
      expandBlock,
      run,
      sendReview,
      loadBlob,
      openPath,
    }),
    [sid, state, waiting, processOutput, quietMinutes, readOnly, draft, add, update, removeDraft, selection, expandedBlock, run, sendReview, loadBlob, openPath],
  )
}
