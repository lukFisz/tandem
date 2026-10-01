import { useEffect } from 'react'
import type { Notice } from '../session/context'

export function Toast({ notice, onClose }: { notice: Notice; onClose(): void }) {
  useEffect(() => {
    if (notice.kind !== 'info') return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [notice, onClose])
  return (
    <div className={`toast is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <div className="toast-text">{notice.text}</div>
      {notice.hint && <div className="toast-hint">{notice.hint}</div>}
      <button type="button" className="btn link" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
