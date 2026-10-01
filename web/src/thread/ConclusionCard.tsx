import { useEffect, useRef, useState } from 'react'
import type { Thread } from '../api/types'
import { CommentEditor } from '../blocks/CommentEditor'
import { ProposalCard } from '../proposal/ProposalCard'
import type { ProposalCollapse } from '../proposal/useProposalCollapse'
import { ResolveThread } from './ResolveThread'
import { useSessionCtx } from '../session/context'
import { ACCEPT_CONCLUSION_EVENT } from '../session/shortcuts'

export function ConclusionCard({ thread, proposal, onResolved }: { thread: Thread; proposal: ProposalCollapse; onResolved?: () => void }) {
  const { run, readOnly } = useSessionCtx()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const saving = useRef(false)
  // The proposalVersion the Edit editor opened on. Save sends it as baseVersion, so the daemon
  // rejects it (proposal_changed) if the AI re-proposed while the user was editing or saving.
  const baseVersion = useRef(0)
  const edit = () => {
    baseVersion.current = thread.proposalVersion ?? 0
    setMode('edit')
  }
  // If the AI re-proposes while the Edit editor is open, close it and show the new proposal, so a
  // Save never replaces a proposal the user has not read (as StageView does for the summary). The
  // version counts too: a same-text re-proposal would make every Save fail with proposal_changed.
  useEffect(() => {
    setMode((m) => (m === 'edit' ? 'view' : m))
  }, [thread.proposedConclusion, thread.proposalVersion])

  // In-flight guard (stage summary flow, part A), like ResolveThread's resolve: one
  // conclusion.accept per click, and Accept and Edit are disabled while it is being sent.
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const accept = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (await run({ type: 'conclusion.accept', data: { threadId: thread.id } })) onResolved?.()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // The `a` shortcut (Task 2, step 4b): accept through the same guard as the button. A key press
  // while an accept is in flight, or while the Edit editor is open, is ignored.
  useEffect(() => {
    const onKey = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail?.threadId !== thread.id) return
      if (readOnly || thread.status !== 'conclusion_proposed') return
      if (mode !== 'view') return
      void accept()
    }
    document.addEventListener(ACCEPT_CONCLUSION_EVENT, onKey)
    return () => document.removeEventListener(ACCEPT_CONCLUSION_EVENT, onKey)
  })

  // Demo 7 follow-ups 5: the resolved card keeps the proposal's collapse state and toggle.
  if (thread.status === 'resolved') {
    return (
      <ProposalCard
        resolved
        label="Conclusion"
        kicker="Conclusion"
        text={thread.conclusion ?? ''}
        collapsed={proposal.collapsed}
        onToggle={proposal.toggle}
      />
    )
  }
  if (thread.status === 'open') return readOnly ? null : <ResolveThread thread={thread} onResolved={onResolved} />
  if (thread.status !== 'conclusion_proposed') return null
  const text = thread.proposedConclusion ?? ''

  // Save replaces the proposal and keeps the thread proposed; Accept is a separate click (stage
  // summary flow, part C). An unchanged text has nothing to save, and a second Save while one is
  // in flight is dropped (the daemon would reject it as text_unchanged).
  const save = async (t: string) => {
    if (saving.current) return
    if (t === text.trim()) {
      setMode('view')
      return
    }
    saving.current = true
    try {
      if (await run({ type: 'conclusion.revise', data: { threadId: thread.id, text: t, baseVersion: baseVersion.current } })) setMode('view')
    } finally {
      saving.current = false
    }
  }

  return (
    <ProposalCard
      label="Proposed conclusion"
      kicker="Proposed conclusion"
      text={text}
      version={thread.proposalVersion ?? 1}
      editedByUser={thread.editedByUser}
      collapsed={proposal.collapsed}
      updated={proposal.updated}
      onToggle={proposal.toggle}
      body={
        mode === 'edit' ? (
          <CommentEditor
            label="Edit conclusion"
            initial={text}
            submitLabel="Save"
            autoGrow
            onSave={(t) => void save(t)}
            onCancel={() => setMode('view')}
          />
        ) : undefined
      }
      actions={
        mode === 'view' && !readOnly ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void accept()}>
              Accept <kbd>a</kbd>
            </button>
            <button type="button" className="btn" disabled={busy} onClick={edit}>
              Edit
            </button>
          </>
        ) : null
      }
    />
  )
}
