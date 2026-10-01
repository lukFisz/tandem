import { openQuestion } from '../api/types'
import { countDraft } from '../draft/draft'
import { useSessionCtx } from '../session/context'
import { statusIcon } from '../session/nav'
import { useJustResolved } from './useJustResolved'

// live is connection === 'open'; it keeps a reconnect snapshot from flashing (resolve feedback 2).
export function Nav({ current, onSelect, live = true }: { current: string; onSelect(id: string): void; live?: boolean }) {
  const { state, draft } = useSessionCtx()
  const justResolved = useJustResolved(state.threads, live)
  return (
    <nav className="nav" aria-label="Stages and threads">
      {state.stages.map((stage, i) => (
        <div key={stage.id} className="nav-stage">
          <button
            type="button"
            className={current === stage.id ? 'nav-stage-title is-active' : 'nav-stage-title'}
            aria-current={current === stage.id ? 'page' : undefined}
            onClick={() => onSelect(stage.id)}
          >
            {i + 1} · {stage.title}
            {stage.status === 'summary_proposed' && <span className="badge" aria-label="summary awaiting you" />}
            {openQuestion(stage) && <span className="badge is-dot" aria-label="question awaiting you" />}
          </button>
          {stage.threadIds.map((id) => {
            const t = state.threads[id]
            const n = countDraft(draft, id)
            return (
              <button
                type="button"
                key={id}
                className={`nav-thread is-${t.status}${current === id ? ' is-active' : ''}${justResolved.has(id) ? ' is-just-resolved' : ''}`}
                aria-current={current === id ? 'page' : undefined}
                onClick={() => onSelect(id)}
              >
                <span className="icon" aria-hidden>
                  {statusIcon(t)}
                </span>
                <span className="label">{t.title}</span>
                {t.status !== 'resolved' && openQuestion(t) && (
                  <span className="badge is-dot" aria-label="question awaiting you" />
                )}
                {n > 0 && (
                  <span className="badge" aria-label={`${n} draft comments`}>
                    {n}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
