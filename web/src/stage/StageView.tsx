import { useEffect, useRef, useState } from 'react'
import { CommentEditor } from '../blocks/CommentEditor'
import { Prose } from '../markdown/Prose'
import { EarlierProposal, ProposalCard } from '../proposal/ProposalCard'
import { useProposalCollapse } from '../proposal/useProposalCollapse'
import { AgentText, IdChip } from '../refs/IdChip'
import { useSessionCtx } from '../session/context'
import { statusIcon } from '../session/nav'
import { StageComposer } from '../thread/Composer'
import { isUndelivered, stageAwaitsNextStep, stageAwaitsSummary, stageDeliveryStatus, stageIsReplying } from '../thread/delivery'
import { MessageView } from '../thread/MessageView'
import { QuestionMessage } from '../thread/QuestionMessage'
import { answeredQuestion } from '../thread/timeline'
import { TypingBubble } from '../thread/TypingBubble'
import { openQuestion, type State } from '../api/types'
import { stageTimeline, type StageTimelineItem } from './stageTimeline'
import { enterIfNew, newestSeq } from '../thread/enter'

const SUMMARY_PENDING = "All threads resolved — waiting for the AI's stage summary."
const NEXT_PENDING = "Summary accepted — waiting for the AI's next step…"
const NOTHING_MORE = 'The AI has nothing more planned. Message it, or end the session.'

// onAccepted runs after Accept summary succeeds: SessionPage then moves on to the next stage
// (stage summary flow, part B). onEnd is the top bar's End session, offered in the accepted box
// of the last stage. onSent runs after a stage message was sent, so the page follows the reply
// (part E).
export function StageView({
  stageId,
  onAccepted,
  onEnd,
  onSent,
}: {
  stageId: string
  onAccepted?: () => void
  onEnd?: () => void
  onSent?: () => void
}) {
  const { state } = useSessionCtx()
  // Keyed on stageId so per-stage UI state (the summary editor, the composer's text) resets
  // when the caller switches stages without remounting StageView itself.
  return <StageBody key={stageId} stageId={stageId} state={state} onAccepted={onAccepted} onEnd={onEnd} onSent={onSent} />
}

// view: the proposed summary and its buttons; edit: the summary in the Save editor (part C).
// Asking for changes is a message on the stage now (stage summary flow spec, part E).
type SummaryMode = 'view' | 'edit'

function StageBody({
  stageId,
  state,
  onAccepted,
  onEnd,
  onSent,
}: {
  stageId: string
  state: State
  onAccepted?: () => void
  onEnd?: () => void
  onSent?: () => void
}) {
  const { run, readOnly, waiting, quietMinutes } = useSessionCtx()
  const [mode, setMode] = useState<SummaryMode>('view')
  const saving = useRef(false)
  // The proposalVersion the Edit editor opened on. Save sends it as baseVersion, so the daemon
  // rejects it (proposal_changed) if the AI re-proposed while the user was editing or saving.
  const baseVersion = useRef(0)
  const [accepting, setAccepting] = useState(false)
  const acceptInFlight = useRef(false)
  // state.lastSeq when this page's accept was sent; null if the stage was accepted before the page
  // loaded. See `still` below.
  const [acceptedAfter, setAcceptedAfter] = useState<number | null>(null)
  const index = state.stages.findIndex((s) => s.id === stageId)
  const stage = state.stages[index]
  const threads = stage.threadIds.map((id) => state.threads[id])
  const resolved = threads.filter((t) => t.status === 'resolved').length
  const awaitsSummary = stageAwaitsSummary(stage, threads)
  const nextStage = state.stages[index + 1]
  const awaitsNext = stageAwaitsNextStep(state, stage)
  // The bubble goes still once the agent is back in tdm wait with nothing planned. Right after an
  // accept made here, the agent can still be in the tdm wait that is about to deliver it, so that
  // accept counts only once `delivered` has passed the seq it was sent after.
  const still = waiting && (acceptedAfter === null || state.delivered > acceptedAfter)
  const messages = stage.messages ?? []
  const lastUserMessageSeq = messages.filter((m) => m.actor === 'user').at(-1)?.seq
  const replying = !readOnly && stageIsReplying(stage, state.delivered, waiting)
  // Keys 1–4 answer the stage's latest open question only, as in a thread (demo 7 follow-ups 6).
  const keyQuestion = openQuestion(stage)?.id
  // Part D: the summary card's collapse state, collapsed by a sent stage message. Kept in the
  // session's store under the stage (demo 7 follow-ups 3), so it survives leaving the stage.
  const proposal = useProposalCollapse(`summary:${stage.id}`, stage.proposalVersion ?? 0)
  // Part E: once a summary is proposed, the thread list folds into one line so the conversation and
  // the summary lead. It can be unfolded.
  const folds = stage.status !== 'open'
  const [threadsOpen, setThreadsOpen] = useState(false)
  // The conversation in seq order (part E). The summary card, proposed or accepted, sits in its
  // chronological place: after what came before its (last) proposal, before the messages sent
  // since. Without a recorded proposal seq (older snapshots) it follows every message. An edited
  // summary lists the AI's newest version at the proposal's own seq, and that entry goes above the
  // card. Accepted-stage follow-up: the accepted card used to follow the whole conversation, which
  // put the reply bubble below it while the message it answers sat above it.
  // Decided by the user in a live demo: while the summary is proposed, the proposed card is
  // pinned at the bottom, just above the composer, like a thread's live conclusion card — every
  // stage message (including ones sent after the proposal), earlier-version entries and the
  // typing bubble render above it, not split by the proposal's seq. Once accepted, the card stays
  // where it was at the moment of accepting (also decided in a live demo): the timeline splits at
  // the accept event's seq, so messages exchanged between the proposal and the accept stay above
  // it. Older snapshots without acceptedSeq fall back to the last proposal's seq.
  const timeline = stageTimeline(stage)
  // The newest seq when this body mounted (it remounts on a stage switch): only conversation items
  // past it arrived while the page was open, and ease in (enterIfNew).
  const [mountSeq] = useState(() => newestSeq(state.lastSeq, timeline))
  const pinCard = stage.status === 'summary_proposed'
  const liveSeq = stage.status === 'open' || pinCard ? Infinity : (stage.acceptedSeq ?? stage.proposals?.at(-1)?.seq ?? Infinity)
  const beforeCard = timeline.filter((i) => i.seq <= liveSeq)
  const afterCard = timeline.filter((i) => i.seq > liveSeq)
  // If the AI re-proposes while the Edit editor is open, close it and show the new proposal,
  // so a Save never replaces a proposal the user has not read. The version counts too: a same-text
  // re-proposal would make every Save fail with proposal_changed.
  useEffect(() => {
    setMode((m) => (m === 'edit' ? 'view' : m))
  }, [stage.proposedSummary, stage.proposalVersion])
  // Save replaces the proposed summary and keeps it proposed; Accept summary is a separate click
  // (stage summary flow, part C). An unchanged text has nothing to save, and a second Save while
  // one is in flight is dropped (the daemon would reject it as text_unchanged).
  const edit = () => {
    baseVersion.current = stage.proposalVersion ?? 0
    setMode('edit')
  }
  const save = async (text: string) => {
    if (saving.current) return
    if (text === (stage.proposedSummary ?? '').trim()) {
      setMode('view')
      return
    }
    saving.current = true
    try {
      if (await run({ type: 'stage.revise', data: { stageId: stage.id, text, baseVersion: baseVersion.current } })) setMode('view')
    } finally {
      saving.current = false
    }
  }
  // In-flight guard (stage summary flow, part A), like ResolveThread's resolve: one stage.accept
  // at a time, and the summary's buttons are disabled while it is being sent. Resolves false
  // without sending while another accept is in flight. On success it remembers the seq it was
  // sent after and lets the page move on (part B). Edit saves with stage.revise (part C), so an
  // accept never carries a text.
  // Fix round 1 (Important): the SSE snapshot with status 'accepted' can reach the browser before
  // this POST resolves (the server notifies before its handler responds), so `acceptedAfter` is
  // set *before* the await, not after — otherwise "nothing more planned" can flash in that window,
  // since `waiting` can already be true while `acceptedAfter` is still null. On failure the
  // previous value is restored.
  const accept = async (): Promise<boolean> => {
    if (acceptInFlight.current) return false
    acceptInFlight.current = true
    setAccepting(true)
    const before = state.lastSeq
    const previous = acceptedAfter
    setAcceptedAfter(before)
    try {
      const ok = await run({ type: 'stage.accept', data: { stageId: stage.id } })
      if (ok) onAccepted?.()
      else setAcceptedAfter(previous)
      return ok
    } finally {
      acceptInFlight.current = false
      setAccepting(false)
    }
  }
  const renderItem = (item: StageTimelineItem) =>
    item.kind === 'proposal' ? (
      <EarlierProposal key={`p${item.version}`} kicker="Proposed stage summary" version={item.version} text={item.text} />
    ) : item.message.question ? (
      <QuestionMessage key={`m${item.seq}`} message={item.message} withKeys={item.message.question.id === keyQuestion} />
    ) : (
      <MessageView
        key={`m${item.seq}`}
        message={item.message}
        question={answeredQuestion(stage, item.message)}
        undelivered={!readOnly && item.message.actor === 'user' && isUndelivered(item.seq, { lastAiSeq: stage.lastAiSeq ?? 0 }, state.delivered)}
        status={!readOnly && item.message.actor === 'user' && item.seq === lastUserMessageSeq ? stageDeliveryStatus(item.seq, stage, state.delivered) : null}
      />
    )
  return (
    <article className="stage">
      <header>
        <div className="kicker">Stage {index + 1}</div>
        <h1>{stage.title}</h1>
        {stage.goal && (
          <p className="goal">
            Goal: <AgentText text={stage.goal} />
          </p>
        )}
      </header>
      {folds && (
        <button type="button" className="stage-threads-toggle" aria-expanded={threadsOpen} onClick={() => setThreadsOpen((o) => !o)}>
          Threads ({resolved}/{threads.length} resolved) {threadsOpen ? '▾' : '▸'}
        </button>
      )}
      {(!folds || threadsOpen) && (
        <ul className="stage-threads">
          {threads.map((t) => (
            <li key={t.id}>
              {/* The icon's fixed-width slot is inline-block, which would drop the space from the
                  accessible name; the explicit label keeps it "✓ Title". */}
              <a href={`#${t.id}`} aria-label={`${statusIcon(t)} ${t.title}`}>
                <span className="stage-thread-icon">{statusIcon(t)}</span>
                {t.title}
              </a>
              {t.conclusion && <Prose className="stage-concl" text={t.conclusion} />}
            </li>
          ))}
        </ul>
      )}
      {beforeCard.map((item) => enterIfNew(renderItem(item), item.seq, mountSeq))}
      {pinCard && replying && <TypingBubble quietMinutes={quietMinutes} />}
      {stage.status === 'summary_proposed' && (
        <ProposalCard
          label="Proposed stage summary"
          kicker="Proposed stage summary"
          land="proposed-summary"
          text={stage.proposedSummary ?? ''}
          version={stage.proposalVersion ?? 1}
          editedByUser={stage.editedByUser}
          collapsed={proposal.collapsed}
          updated={proposal.updated}
          onToggle={proposal.toggle}
          body={
            !readOnly && mode === 'edit' ? (
              <CommentEditor
                label="Edit summary"
                initial={stage.proposedSummary ?? ''}
                submitLabel="Save"
                autoGrow
                onSave={(text) => void save(text)}
                onCancel={() => setMode('view')}
              />
            ) : undefined
          }
          actions={
            !readOnly && mode === 'view' ? (
              <>
                <button type="button" className="btn primary" disabled={accepting} onClick={() => void accept()}>
                  Accept summary
                </button>
                <button type="button" className="btn" disabled={accepting} onClick={edit}>
                  Edit
                </button>
              </>
            ) : null
          }
        />
      )}
      {/* The accepted summary sits where it was accepted (see liveSeq); messages sent since the
          accept follow it. Demo 7 follow-ups 5: only the summary text collapses, with the proposal's
          collapse state; what comes next is the card's footer and stays in view below it. */}
      {stage.status === 'accepted' && (
        <ProposalCard
          resolved
          label="Stage summary"
          kicker="Stage summary"
          text={stage.summary ?? ''}
          collapsed={proposal.collapsed}
          onToggle={proposal.toggle}
          footer={nextStage ? (
            <p className="stage-next">
              Next: <IdChip id={nextStage.id} title={nextStage.title} /> →
            </p>
          ) : (
            !readOnly &&
            awaitsNext && (
              <>
                {keyQuestion ? null : still ? (
                  // An open stage question is the AI's next step (demo 7 follow-ups 6): neither
                  // "nothing more planned" nor the waiting bubble while it is open.
                  <p className="muted">{NOTHING_MORE}</p>
                ) : replying ? null : (
                  // While the AI replies to a stage message, the reply bubble below this box
                  // stands for it (part E).
                  <TypingBubble quietMinutes={quietMinutes} label={NEXT_PENDING} text={NEXT_PENDING} />
                )}
                {onEnd && !state.endRequested && (
                  <div className="actions">
                    <button type="button" className="btn" onClick={onEnd}>
                      End session
                    </button>
                  </div>
                )}
              </>
            )
          )}
        />
      )}
      {afterCard.map((item) => enterIfNew(renderItem(item), item.seq, mountSeq))}
      {!pinCard && replying && <TypingBubble quietMinutes={quietMinutes} />}
      {stage.status === 'open' &&
        (awaitsSummary ? (
          // Demo2 follow-up 5: the typing bubble's rules. Still while the agent sits in tdm wait
          // (or the session is closed), the quiet state after 10 minutes of silence.
          readOnly || waiting || replying ? (
            <p className="muted">{SUMMARY_PENDING}</p>
          ) : (
            <TypingBubble quietMinutes={quietMinutes} label={SUMMARY_PENDING} text={SUMMARY_PENDING} />
          )
        ) : (
          <p className="muted">
            The AI proposes a stage summary once every thread is resolved ({resolved}/{threads.length}).
          </p>
        ))}
      <StageComposer
        stage={stage}
        onSent={() => {
          // Part D: a sent message collapses the summary card, proposed or accepted, so the reply
          // stays in view; a summary proposed later starts expanded (Review Focus 3).
          if (stage.status !== 'open') proposal.collapse()
          onSent?.()
        }}
      />
    </article>
  )
}
