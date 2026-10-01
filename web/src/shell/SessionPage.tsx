import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchExport } from '../api/client'
import { BlockModal } from '../blocks/BlockModal'
import type { Action, Snapshot } from '../api/types'
import { useSession, type Connection } from '../api/useSession'
import { SessionContext, noticeFromError, type Notice, type SessionCtx } from '../session/context'
import { CollapseStoreProvider, type CollapseStore } from '../proposal/useProposalCollapse'
import { nextAfterResolve, nextAfterStageAccept, useCurrentItem } from '../session/nav'
import { useShortcuts } from '../session/shortcuts'
import { TextNotes } from '../textnote/TextNotes'
import { useController } from '../session/useController'
import { StageView } from '../stage/StageView'
import { stageIsReplying, threadIsReplying } from '../thread/delivery'
import { timeline } from '../thread/timeline'
import { ThreadView } from '../thread/ThreadView'
import { Nav } from './Nav'
import { clearJumpHighlight, highlightJumpTarget, prefersReducedMotion } from './motion'
import { Toast } from './Toast'
import { TopBar } from './TopBar'
import { useFollowBottom } from './useFollowBottom'

export function SessionPage({ sid }: { sid: string }) {
  const { snapshot, connection } = useSession(sid)
  if (!snapshot) {
    return (
      <main className="center">
        {connection === 'lost' ? (
          <p>
            Cannot load session {sid}. Run <code>tdm open</code> to reopen it.
          </p>
        ) : (
          <p className="muted">Connecting…</p>
        )}
      </main>
    )
  }
  // Keyed on sid, so per-session page state (scroll positions, landing keys, collapse store) never
  // carries over to another session.
  return <LoadedSession key={sid} sid={sid} snapshot={snapshot} connection={connection} />
}

function LoadedSession({ sid, snapshot, connection }: { sid: string; snapshot: Snapshot; connection: Connection }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const rawCtx = useController(sid, snapshot, setNotice)
  const [current, select, scrollTo] = useCurrentItem(snapshot.state)
  // Demo 7 follow-ups 3: the cards' collapse state for this page session, by card key. It
  // outlives each item's view, and a reload (or another session) starts over.
  const [collapseStore] = useState<CollapseStore>(() => new Map())

  // F12b-2 (fix round 2, user report): any successful user action in the current item — not
  // only a composer send — arms the follow so the next growth of that item's content (a new
  // timeline item, or a newly proposed/changed conclusion/summary) scrolls to the bottom, even
  // if the user isn't near it (choosing a variant, "None of these", a stage message and the top
  // bar's "Send to AI" are all "I acted, now show me the reply"; Discuss was removed from the
  // conclusion card in round 3 #7, but a plain composer message during a proposed conclusion is
  // still such an action). Wrapping run/sendReview here (rather than threading a callback
  // through every action button) covers all of them uniformly. readOnly no-ops and failures
  // resolve false and don't arm.
  const mainRef = useRef<HTMLElement | null>(null)
  const currentStage = current.startsWith('st_') ? snapshot.state.stages.find((s) => s.id === current) : undefined
  const contentKey = useMemo(() => {
    if (current.startsWith('st_')) {
      if (!currentStage) return current
      // Stage summary flow spec, part E: stage messages and the stage's typing bubble are content
      // growth too, like a thread's.
      const bubble = stageIsReplying(currentStage, snapshot.state.delivered, snapshot.waiting) ? 1 : 0
      return `${current}:${currentStage.messages?.length ?? 0}:${currentStage.proposedSummary ?? currentStage.summary ?? ''}:${bubble}`
    }
    const thread = snapshot.state.threads[current]
    if (!thread) return current
    // Round 3 #6: the typing bubble appearing at the end of the timeline is content growth too,
    // so it must be reflected here — otherwise it could pop in without regard to whether the
    // user is near the bottom (follow-bottom would only ever look at it by accident).
    const bubble = threadIsReplying(thread, snapshot.state.delivered, snapshot.waiting) ? 1 : 0
    return `${current}:${timeline(snapshot.state, thread).length}:${thread.proposedConclusion ?? thread.conclusion ?? ''}:${bubble}`
  }, [current, currentStage, snapshot.state, snapshot.waiting])
  // Demo2 follow-up 6: a (re-)proposed stage summary is read from its start. Stage messages now
  // change the stage's key too, so land only when the proposed summary itself changed since the
  // user last saw this item; anything else follows the bottom (part E, Review Focus 3). Each item
  // keeps its own last-seen key, so a return to a stage whose summary was (re-)proposed while the
  // user was away lands on it too, over the restored scroll position (demo 7 follow-ups 3).
  const landKey = currentStage?.proposedSummary ?? ''
  const landKeyRef = useRef(landKey)
  landKeyRef.current = landKey
  const currentLandRef = useRef(current)
  currentLandRef.current = current
  const landedKeys = useRef(new Map<string, string>())
  const landOn = useCallback(() => {
    const item = currentLandRef.current
    const seen = landedKeys.current.get(item)
    landedKeys.current.set(item, landKeyRef.current)
    const changed = seen !== undefined && seen !== landKeyRef.current
    return changed ? (mainRef.current?.querySelector<HTMLElement>('[data-land="proposed-summary"]') ?? null) : null
  }, [])
  const follow = useFollowBottom(mainRef, contentKey, landOn)
  // useFollowBottom does not ask landOn on the first visit to an item: record the item's key here.
  // Declared after useFollowBottom, so this runs after its effect.
  useEffect(() => {
    landedKeys.current.set(current, landKeyRef.current)
  }, [current])
  // Question message spec, part A: an option chip opens the option's thread; once that renders,
  // bring the option into view. Declared after useFollowBottom so its item-switch reset
  // (scrollTop = 0) has already run.
  // Demo 6 follow-ups 3: the target is then tinted briefly. scrollTo is a new object on every
  // visit, so a repeated click on the same chip or header plays it again. The cleanup clears that
  // tint: on unmount, so no timer outlives the component, and on a jump to a new target, so the
  // element this effect is leaving behind isn't left tinted forever.
  // A jump also wins over a restored position still waiting for late content (cancelRestore).
  const cancelRestore = follow.cancelRestore
  useEffect(() => {
    if (!scrollTo) return
    const el = mainRef.current?.querySelector<HTMLElement>(scrollTo.selector)
    if (!el) return
    cancelRestore()
    if (typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    highlightJumpTarget(el)
    return () => clearJumpHighlight(el)
  }, [scrollTo, cancelRestore])
  // Depends on `follow.arm` alone (stable across renders — see useFollowBottom), not on the
  // whole `follow` object, so ctx (and everything downstream of it, including useShortcuts'
  // global keydown listener) doesn't get a new identity just because the "New below ↓" pill
  // toggled (review round 3, Minor).
  const arm = follow.arm
  const ctx = useMemo<SessionCtx>(
    () => ({
      ...rawCtx,
      run: async (action: Action) => {
        const ok = await rawCtx.run(action)
        if (ok) arm()
        return ok
      },
      sendReview: async (extra?: { threadId: string; message: string }) => {
        const ok = await rawCtx.sendReview(extra)
        if (ok) arm()
        return ok
      },
    }),
    [rawCtx, arm],
  )
  useShortcuts(ctx, current, select)
  const title = snapshot.state.session.title
  useEffect(() => {
    document.title = `${title} · Tandem`
  }, [title])

  // F10: a fetch failure goes through the generic noticeFromError (its "Is the tdm daemon
  // running?" hint fits), but a clipboard failure is a separate, unrelated failure mode (the
  // browser blocked clipboard access) and gets its own message instead of that hint.
  const onExport = useCallback(async () => {
    let text: string
    try {
      text = await fetchExport(sid)
    } catch (e) {
      setNotice(noticeFromError(e))
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setNotice({ kind: 'info', text: 'Decision document copied to the clipboard.' })
    } catch {
      setNotice({ kind: 'error', text: 'Could not copy to the clipboard.', hint: 'Your browser blocked clipboard access.' })
    }
  }, [sid])

  // Resolve feedback 3: confirm a successful end with a toast. A failure already shows its error
  // notice (useController), and a cancelled confirm sends nothing.
  const onEnd = useCallback(() => {
    if (!window.confirm('End this session? The AI will wrap up and export.')) return
    void ctx.run({ type: 'session.end', data: {} }).then((ok) => {
      if (ok) setNotice({ kind: 'info', text: '✓ Session ended' })
    })
  }, [ctx])

  const closeNotice = useCallback(() => setNotice(null), [])

  // F12b-4: when the user resolves the current thread from the UI (Accept, Resolve, or Choose &
  // resolve; Save only replaces the proposal and never resolves), move on to the next unresolved
  // thread (or the stage, if none remain) — but only for that user action, never as a side effect
  // of a snapshot change caused by the AI. Kept in sync on every render (not via an effect) so
  // onResolved, which may fire after the user has since navigated elsewhere, can tell whether that
  // navigation happened (fix round 1, Important).
  // M4: a line selection (and any editor it has open) belongs to a specific item. Without this,
  // switching items — j/k, Nav, or auto-advance after Accept — leaves it dangling: pressing `c`
  // on the new item's stale selection, or navigating back to the old one, can pop a comment
  // editor open unexpectedly. setSelection has a stable identity (it's a plain useState setter
  // upstream), so this only depends on `current` actually changing.
  // The same goes for an expanded block (the block modal).
  useEffect(() => {
    rawCtx.setSelection(null)
    rawCtx.expandBlock(null)
  }, [current, rawCtx.setSelection, rawCtx.expandBlock])

  const currentRef = useRef(current)
  currentRef.current = current
  const onResolved = useCallback(() => {
    if (currentRef.current !== current) return
    select(nextAfterResolve(snapshot.state, current))
  }, [snapshot.state, current, select])

  // Stage summary flow, part B: after the user accepts a stage summary, move on to the next
  // stage (its first unresolved thread, else its page) as soon as one exists: at once, or when
  // the AI adds it while the user is still on this stage. Like onResolved, it only applies while
  // the user is still on the stage they accepted. Navigating away drops it, and nothing survives
  // a reload.
  // Demo 7 follow-ups 4: an accept that does not move on (no later stage yet) scrolls the page to
  // the bottom once, so the accepted box and its waiting or end state are in view. It waits for the
  // snapshot that shows the stage accepted, which can come before or after the accept resolves.
  const [advanceFrom, setAdvanceFrom] = useState<string | null>(null)
  const scrollAfterAccept = useRef(false)
  const onStageAccepted = useCallback(() => {
    if (currentRef.current !== current) return
    scrollAfterAccept.current = true
    setAdvanceFrom(current)
  }, [current])
  const scrollToBottom = follow.scrollToBottom
  useEffect(() => {
    if (!advanceFrom) return
    if (current !== advanceFrom) {
      scrollAfterAccept.current = false
      setAdvanceFrom(null)
      return
    }
    const next = nextAfterStageAccept(snapshot.state, advanceFrom)
    if (!next) {
      if (scrollAfterAccept.current && snapshot.state.stages.find((s) => s.id === advanceFrom)?.status === 'accepted') {
        scrollAfterAccept.current = false
        scrollToBottom()
      }
      return
    }
    scrollAfterAccept.current = false
    setAdvanceFrom(null)
    select(next)
  }, [advanceFrom, current, snapshot.state, select, scrollToBottom])

  return (
    <SessionContext.Provider value={ctx}>
      <CollapseStoreProvider store={collapseStore}>
        <div className="app">
          <TopBar connection={connection} onExport={() => void onExport()} onEnd={onEnd} />
          <div className="body">
            <Nav current={current} onSelect={select} live={connection === 'open'} />
            <main className="main" ref={mainRef}>
              {current.startsWith('st_') ? (
                <StageView stageId={current} onAccepted={onStageAccepted} onEnd={onEnd} onSent={follow.scrollToBottom} />
              ) : current ? (
                <ThreadView threadId={current} onResolved={onResolved} onSent={follow.scrollToBottom} />
              ) : (
                <p className="muted">No stages yet. The AI is preparing the first one.</p>
              )}
              {follow.showPill && (
                <button type="button" className="new-below" onClick={follow.scrollToBottom}>
                  New below ↓
                </button>
              )}
            </main>
          </div>
          <BlockModal />
          <TextNotes />
          {notice && <Toast notice={notice} onClose={closeNotice} />}
        </div>
      </CollapseStoreProvider>
    </SessionContext.Provider>
  )
}
