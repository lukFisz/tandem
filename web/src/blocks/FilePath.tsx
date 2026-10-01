import { useEffect, useRef, useState } from 'react'
import { useSessionCtx } from '../session/context'

const EDITOR_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  zed: 'Zed',
  sublime: 'Sublime Text',
  idea: 'IntelliJ IDEA',
  goland: 'GoLand',
  webstorm: 'WebStorm',
}

export function FilePath({ path, line, className }: { path: string; line?: number; className?: string }) {
  const { openPath } = useSessionCtx()
  const [status, setStatus] = useState<'idle' | 'opening' | 'opened'>('idle')
  const [editor, setEditor] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  const busy = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(timer.current)
    }
  }, [])

  const click = async () => {
    if (busy.current) return
    busy.current = true
    setStatus('opening')
    let id: string | null = null
    try {
      id = await openPath(path, line)
    } catch {
      id = null
    }
    busy.current = false
    if (!alive.current) return
    if (id === null) {
      setStatus('idle')
      return
    }
    setEditor(EDITOR_NAMES[id] ?? id)
    setStatus('opened')
    timer.current = setTimeout(() => setStatus('idle'), 1500)
  }

  return (
    <button
      type="button"
      className={className ? `file-path ${className}` : 'file-path'}
      title={`Open ${path} in editor`}
      aria-busy={status === 'opening' || undefined}
      onClick={() => void click()}
    >
      {path}
      <span className={status === 'opened' ? 'file-path-status is-opened' : 'file-path-status'} aria-live="polite">
        {status === 'opening' && (
          <>
            <span className="tdm-spinner" aria-hidden="true" />
            <span className="visually-hidden">Opening…</span>
          </>
        )}
        {status === 'opened' && `✓ opened in ${editor}`}
      </span>
    </button>
  )
}
