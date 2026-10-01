import { useEffect, useRef, useState } from 'react'
import type { Message, MessageQuestion } from '../api/types'
import { isOpenQuestion } from '../api/types'
import { Prose } from '../markdown/Prose'
import { useSessionCtx } from '../session/context'
import { isTyping } from '../session/shortcuts'

type AnswerData = { optionId: string } | { other: string }

// answerLabel is how an answer reads in the question bubble: the option title, or the user's own
// text in quotes. The user message the answer adds reads the same after "Answered: "
// (domain.AnswerMessage).
export function answerLabel(q: MessageQuestion): string | undefined {
  const a = q.answer
  if (!a) return undefined
  if (a.other !== undefined) return `"${a.other}"`
  return q.options.find((o) => o.id === a.optionId)?.title ?? a.optionId
}

// QuestionMessage is an AI message with answer buttons (question message spec). A button answers
// at once; Other… swaps the row for a one-line input (Enter sends, Esc cancels). withKeys lets 1–4
// pick a button while focus is not in a text field; ThreadView and StageView give it to the latest
// open question of the item on screen only. The answer is final, so an answered, withdrawn,
// read-only or `closed` (in a resolved thread) question shows a status line instead of buttons. A
// question on a stage page is never closed: any stage takes an answer (demo 7 follow-ups 6).
export function QuestionMessage({ message, closed = false, withKeys = false }: { message: Message; closed?: boolean; withKeys?: boolean }) {
  const { run, readOnly } = useSessionCtx()
  const q = message.question!
  const [other, setOther] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Review Focus 1: a ref, not the state, guards against a second answer: two key presses in one
  // tick both see pending === false. Once `run` resolves true the answer is final, so the guard
  // stays set (the answered state only arrives later over SSE) — it is cleared only on failure.
  const inFlight = useRef(false)
  const open = isOpenQuestion(q)
  const interactive = open && !readOnly && !closed

  const answer = async (data: AnswerData) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    const ok = await run({ type: 'question.answer', data: { questionId: q.id, ...data } })
    if (ok) {
      // Keep the Other input mounted with its sent text: the answered state only arrives later
      // over SSE, and swapping back to the (disabled) option buttons would hide what was sent.
      return
    }
    inFlight.current = false
    setPending(false)
  }
  const answerRef = useRef(answer)
  answerRef.current = answer

  const keys = interactive && withKeys && other === null
  const options = q.options
  useEffect(() => {
    if (!keys) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !/^[1-4]$/.test(e.key)) return
      const option = options[Number(e.key) - 1]
      if (!option) return
      e.preventDefault()
      void answerRef.current({ optionId: option.id })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [keys, options])

  const sendOther = () => {
    const text = (other ?? '').trim()
    if (text) void answer({ other: text })
  }

  return (
    <section className="msg-question" data-question={q.id} aria-label="Question">
      <Prose className="msg-ai" text={message.text} />
      {interactive &&
        (other === null ? (
          <div className="question-options">
            {q.options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className="btn"
                disabled={pending}
                aria-keyshortcuts={withKeys ? String(i + 1) : undefined}
                onClick={() => void answer({ optionId: o.id })}
              >
                {o.title}
              </button>
            ))}
            <button type="button" className="btn link" disabled={pending} onClick={() => setOther('')}>
              Other…
            </button>
          </div>
        ) : (
          <div className="question-other">
            <div className="input-card is-inline">
              <input
                type="text"
                aria-label="Your answer"
                autoFocus
                value={other}
                disabled={pending}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    sendOther()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setOther(null)
                  }
                }}
              />
            </div>
            <button type="button" className="btn primary small" disabled={pending || !other.trim()} onClick={sendOther}>
              Send answer
            </button>
          </div>
        ))}
      {q.answer && <p className="question-status">Answer: {answerLabel(q)}</p>}
      {q.withdrawn && <p className="question-status">Withdrawn</p>}
      {open && !interactive && <p className="question-status">Not answered</p>}
    </section>
  )
}
