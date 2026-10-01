import type { Process } from '../api/types'
import { useNow } from '../session/clock'

const TICK_MS = 1000

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s === 0) return '<1s'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

// tailLines splits the output tail into lines keyed by their text plus how often that text came
// before, so a line that stays in the tail as it scrolls keeps its key (and DOM node): only a line
// that newly arrives mounts and plays its entrance.
export function tailLines(tail: string): { key: string; text: string }[] {
  const lines = tail.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const seen = new Map<string, number>()
  return lines.map((text) => {
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    return { key: `${text}#${n}`, text }
  })
}

export function ProcessCard({ process: p, tail }: { process: Process; tail?: string }) {
  const now = useNow(TICK_MS)
  const running = p.status === 'running'
  const end = running ? now : (p.exitedAt ?? now)
  const elapsed = formatElapsed(end - p.startedAt)
  const code = p.exitCode ?? -1
  let cls = 'is-running'
  let mark = '●'
  let status = `running · ${elapsed}`
  if (!running) {
    if (code === 0) [cls, mark, status] = ['is-ok', '✓', `exit 0 · ${elapsed}`]
    else if (code > 0) [cls, mark, status] = ['is-fail', '✕', `exit ${code} · ${elapsed}`]
    else [cls, mark, status] = ['is-unknown', '○', `exited · code unknown · ${elapsed}`]
  }
  return (
    <div className={`process-card ${cls}`} id={p.id} title={`pid ${p.pid}`}>
      <div className="process-row">
        <span className="process-mark" aria-hidden="true">
          {mark}
        </span>
        <code className="process-cmd" title={p.cmd}>
          {p.cmd}
        </code>
        <span className="process-status">{status}</span>
      </div>
      {tail ? (
        <pre className="process-tail">
          {tailLines(tail).map((l) => (
            <span key={l.key} className="process-tail-line">
              {l.text}
            </span>
          ))}
        </pre>
      ) : null}
    </div>
  )
}
