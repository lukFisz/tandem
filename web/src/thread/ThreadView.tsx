import { useRef, useState } from 'react'
import { openQuestion, type State } from '../api/types'
import { BlockView } from '../blocks/BlockView'
import { EarlierProposal } from '../proposal/ProposalCard'
import { useProposalCollapse } from '../proposal/useProposalCollapse'
import { useSessionCtx } from '../session/context'
import { Composer } from './Composer'
import { ConclusionCard } from './ConclusionCard'
import { deliveryStatus, isUndelivered, threadIsReplying } from './delivery'
import { MessageView } from './MessageView'
import { QuestionMessage } from './QuestionMessage'
import { showSentComments } from './showSentComments'
import { Superseded } from './Superseded'
import { answeredQuestion, choiceTitle, sentComments, timeline, type TimelineItem } from './timeline'
import { ProcessCard } from './ProcessCard'
import { TypingBubble } from './TypingBubble'
import { enterIfNew, newestSeq } from './enter'

export function ThreadView({ threadId, onResolved, onSent }: { threadId: string; onResolved?: () => void; onSent?: () => void }) {
  const { state } = useSessionCtx()
  // Keyed on threadId so per-thread UI state (the conclusion editor and the composer draft
  // below) resets when the caller switches threads without remounting ThreadView itself.
  return <ThreadBody key={threadId} threadId={threadId} state={state} onResolved={onResolved} onSent={onSent} />
}

function ThreadBody({
  threadId,
  state,
  onResolved,
  onSent,
}: {
  threadId: string
  state: State
  onResolved?: () => void
  onSent?: () => void
}) {
  const { readOnly, waiting, quietMinutes, processOutput } = useSessionCtx()
  const articleRef = useRef<HTMLElement>(null)
  // The newest seq when this body mounted (it remounts on a thread switch): only items past it
  // arrived while the thread was open, and ease in (enterIfNew).
  const [mountSeq] = useState(() => newestSeq(state.lastSeq, timeline(state, state.threads[threadId])))
  const thread = state.threads[threadId]
  const stageIndex = state.stages.findIndex((s) => s.id === thread.stageId)
  const threadIndex = state.stages[stageIndex].threadIds.indexOf(thread.id)
  const lastUserMessageSeq = [...thread.messages].filter((m) => m.actor === 'user').at(-1)?.seq
  // Resolve feedback 1: a resolved thread leads with its outcome; an open or proposed one keeps
  // the card at the bottom, next to the composer where the user acts on it.
  const resolved = thread.status === 'resolved'
  // Keys 1–4 answer the latest open question only (question message spec).
  const keyQuestion = openQuestion(thread)?.id
  // Part D: the proposal card's collapse state, next to the composer that collapses it. It is kept
  // in the session's store under the thread (demo 7 follow-ups 3), so it survives leaving the thread.
  const proposal = useProposalCollapse(`conclusion:${thread.id}`, thread.proposalVersion ?? 0)
  const renderItem = (item: TimelineItem) =>
    item.kind === 'proposal' ? (
      <EarlierProposal key={`p${item.version}`} kicker="Proposed conclusion" version={item.version} text={item.text} />
    ) : item.kind === 'process' ? (
      <ProcessCard key={item.process.id} process={item.process} tail={processOutput[item.process.id]} />
    ) : item.kind === 'block' ? (
      item.block.supersededBy ? (
        <Superseded key={item.block.id} block={item.block} />
      ) : (
        <BlockView key={item.block.id} block={item.block} onResolved={onResolved} />
      )
    ) : item.message.question ? (
      <QuestionMessage
        key={`m${item.seq}`}
        message={item.message}
        closed={resolved}
        withKeys={item.message.question.id === keyQuestion}
      />
    ) : (
      <MessageView
        key={`m${item.seq}`}
        message={item.message}
        threadId={thread.id}
        choice={choiceTitle(state, item.message)}
        question={answeredQuestion(thread, item.message)}
        undelivered={!readOnly && item.message.actor === 'user' && isUndelivered(item.message.seq, thread, state.delivered)}
        comments={sentComments(thread, item.message).length}
        quoted={sentComments(thread, item.message).some((c) => !!c.quote)}
        onShowComments={() => {
          if (articleRef.current) showSentComments(articleRef.current, item.message.seq)
        }}
        status={
          !readOnly && item.message.actor === 'user' && item.message.seq === lastUserMessageSeq
            ? deliveryStatus(item.message.seq, thread, state.delivered)
            : null
        }
      />
    )
  return (
    <article className="thread" ref={articleRef}>
      <header>
        <div className="kicker">
          Stage {stageIndex + 1} · Thread {threadIndex + 1}
        </div>
        <h1>{thread.title}</h1>
      </header>
      {resolved && <ConclusionCard thread={thread} proposal={proposal} onResolved={onResolved} />}
      {timeline(state, thread).map((item) => enterIfNew(renderItem(item), item.seq, mountSeq))}
      {!readOnly && threadIsReplying(thread, state.delivered, waiting) && <TypingBubble quietMinutes={quietMinutes} />}
      {!resolved && <ConclusionCard thread={thread} proposal={proposal} onResolved={onResolved} />}
      <Composer
        thread={thread}
        onSent={() => {
          // Part D: a sent message collapses the live card so the reply stays in view. A card that
          // appears later starts expanded (Review Focus 3).
          if (thread.status === 'conclusion_proposed') proposal.collapse()
          onSent?.()
        }}
      />
    </article>
  )
}
