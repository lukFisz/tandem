import type { Message } from '../api/types'
import { Prose } from '../markdown/Prose'
import { NoteBadge, useQuotedNotes } from '../textnote/NoteBadge'
import { messageNotes } from '../textnote/notes'
import { answerParts, lineCommentsLabel, type QuestionRef } from './timeline'

// `status`, when given, is the delivery status line shown under the user's latest message
// (see delivery.ts): null once the AI has acted on it, otherwise a short "sent"/"replying" note.
// `choice` is the title of the variant option the message was sent with (feature review t_3), and
// `question` the question an answer message answers. Each heads the message as a plain link to
// #<id>, like an id chip: useCurrentItem opens the item's thread and SessionPage scrolls to it
// (demo 6 follow-ups 1). `comments` is how many line comments went with it. Its header jumps to
// them via `onShowComments` (follow-ups A). A header may stand alone, as the text may be empty.
// `undelivered` mutes the bubble while the AI has not received it (demo 6 follow-ups 2).
// `threadId` makes a thread message's text take notes on selected text (textnote/dom.ts).
export function MessageView({
  message,
  status,
  choice,
  question,
  comments = 0,
  quoted = false,
  onShowComments,
  undelivered = false,
  threadId,
}: {
  message: Message
  status?: string | null
  choice?: string
  question?: QuestionRef
  comments?: number
  /** Some of the comments are on selected text: the header says "comments", not "line comments". */
  quoted?: boolean
  onShowComments?: () => void
  undelivered?: boolean
  threadId?: string
}) {
  if (message.actor === 'user') {
    // An answer message's text is "Answered: <value>" (domain.AnswerMessage) — only ever paired
    // with `question` (answerTo). Split it so "Answered" reads as a label, not run into the value.
    const parts = question ? answerParts(message.text) : undefined
    const anchor = threadId && !parts && message.text ? { 'data-tn-msg': message.seq, 'data-tn-thread': threadId } : {}
    return (
      <>
        <div className={undelivered ? 'msg-user is-undelivered' : 'msg-user'} {...anchor}>
          {threadId && <MessageBadge threadId={threadId} seq={message.seq} />}
          {question && (
            <a className="msg-ref" href={`#${question.id}`} title={`id: ${question.id}`}>
              <svg className="msg-ref-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M6 3 2 7l4 4M2 7h7a5 5 0 0 1 5 5v1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {question.title}
            </a>
          )}
          {choice && message.choice && (
            <a
              className="msg-ref msg-choice"
              href={`#${message.choice.optionId}`}
              title={`Chose ${choice} (id: ${message.choice.optionId})`}
              aria-label={`Chose ${choice}`}
            >
              <svg className="msg-ref-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="visually-hidden">Chose </span>
              {choice}
            </a>
          )}
          {comments > 0 && (
            <button type="button" className="msg-comments" onClick={onShowComments}>
              {lineCommentsLabel(comments, quoted)}
            </button>
          )}
          {parts ? (
            <>
              <span className="msg-answer-label">Answered</span>
              <span className="msg-answer">{parts.answer}</span>
            </>
          ) : (
            message.text ? <span data-tn-text="">{message.text}</span> : null
          )}
        </div>
        {status && (
          <p className="delivery-status" role="status">
            {status}
          </p>
        )}
      </>
    )
  }
  if (!threadId) return <Prose className="msg-ai" text={message.text} />
  return (
    <div className="msg-ai-wrap" data-tn-msg={message.seq} data-tn-thread={threadId}>
      <MessageBadge threadId={threadId} seq={message.seq} />
      <Prose className="msg-ai" text={message.text} textAnchor />
    </div>
  )
}

function MessageBadge({ threadId, seq }: { threadId: string; seq: number }) {
  return <NoteBadge notes={messageNotes(useQuotedNotes(), threadId, seq)} />
}
