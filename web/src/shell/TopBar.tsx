import { useEffect, useState, type ReactNode } from 'react'
import type { Connection } from '../api/useSession'
import { countDraft } from '../draft/draft'
import { useSessionCtx } from '../session/context'
import { SettingsMenu } from './SettingsMenu'

// F4 (Review Focus 3, amended): a restarted daemon listens on a new port with a new token, so
// the page cannot reconnect on its own. When the connection stays 'connecting' for more than
// ~10s (whether it was open before or is still loading for the first time), the top bar adds a
// hint pointing at `tdm open`. The timer resets whenever the connection leaves 'connecting'.
const RECONNECT_HINT_MS = 10000

// StatusDot is the top bar's activity dot: a 16px box with three <i>, of which each state's CSS
// shows the ones it needs (heartbeat + halo, three wave dots, or one blinking dot).
function StatusDot({ kind }: { kind: 'waiting' | 'working' | 'reconnecting' | 'quiet' | 'lost' }) {
  return (
    <span className={`dot is-${kind}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

export function TopBar({ connection, onExport, onEnd }: { connection: Connection; onExport(): void; onEnd(): void }) {
  const { state, waiting, quietMinutes, readOnly, draft, sendReview } = useSessionCtx()
  const pending = countDraft(draft)
  const [openedWith] = useState(pending)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (connection !== 'connecting') {
      setStuck(false)
      return
    }
    const t = setTimeout(() => setStuck(true), RECONNECT_HINT_MS)
    return () => clearTimeout(t)
  }, [connection])
  let status: ReactNode
  if (readOnly) status = 'Session closed'
  else if (connection === 'lost')
    status = (
      <>
        <StatusDot kind="lost" />
        Disconnected — run tdm open
      </>
    )
  else if (connection === 'connecting')
    status = (
      <>
        <StatusDot kind="reconnecting" />
        Reconnecting…
      </>
    )
  else if (waiting)
    status = (
      <>
        <StatusDot kind="waiting" />
        AI is waiting for you
      </>
    )
  else if (quietMinutes !== null)
    status = (
      <>
        <StatusDot kind="quiet" />
        AI not connected
      </>
    )
  else
    status = (
      <>
        <StatusDot kind="working" />
        AI is working…
      </>
    )
  return (
    <header className="topbar">
      <a className="home" href="/">
        Tandem
      </a>
      <span className="title">{state.session.title}</span>
      <span className={waiting && !readOnly && connection === 'open' ? 'ai-status is-waiting' : 'ai-status'} aria-live="polite">
        {status}
        {!readOnly && connection === 'connecting' && stuck && (
          <span className="ai-status-hint"> If the daemon restarted, run tdm open.</span>
        )}
      </span>
      <div className="top-actions">
        {!readOnly && (
          <button type="button" className="btn primary" disabled={pending === 0} onClick={() => void sendReview()}>
            Send to AI ·{' '}
            {/* Keyed on the count: a change remounts the span and replays its one-shot pop. The
                count the bar opened with stays still, so a page load does not pop. */}
            <span key={pending} className={pending === openedWith ? undefined : 'count-pop'}>
              {pending}
            </span>
          </button>
        )}
        <SettingsMenu />
        <button type="button" className="btn" onClick={onExport}>
          Export
        </button>
        {!readOnly && !state.endRequested && (
          <button type="button" className="btn" onClick={onEnd}>
            End session
          </button>
        )}
      </div>
    </header>
  )
}
