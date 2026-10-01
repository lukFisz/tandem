import { useEffect, useState } from 'react'
import { ApiError, listSessions } from '../api/client'
import type { SessionSummary } from '../api/types'
import { SettingsMenu } from './SettingsMenu'

export function SessionList() {
  const [list, setList] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    listSessions().then(setList, (e: unknown) =>
      setError(
        e instanceof ApiError && e.status === 401
          ? 'Open a session with tdm open first — this page needs its token.'
          : e instanceof Error
            ? e.message
            : String(e),
      ),
    )
  }, [])
  const groups = new Map<string, SessionSummary[]>()
  for (const s of list ?? []) groups.set(s.projectName, [...(groups.get(s.projectName) ?? []), s])
  return (
    <main className="session-list">
      <div className="kicker">Tandem</div>
      <div className="session-list-header">
        <h1>Sessions</h1>
        <SettingsMenu />
      </div>
      {error && <p className="muted">{error}</p>}
      {list && list.length === 0 && <p className="muted">No sessions yet. Ask your agent to run tdm session new.</p>}
      {[...groups].map(([project, sessions]) => (
        <section key={project}>
          <h2>{project}</h2>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <a href={`/s/${s.id}`}>{s.title}</a>
                {s.status === 'closed' && <span className="muted">{s.status}</span>}
                {s.active && <span className="chip">active</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
