import { useState } from 'react'

interface Props {
  label?: string
  initial?: string
  submitLabel?: string
  allowEmpty?: boolean
  /** Focus the textarea on mount (default). ResolveThread turns it off for a restored note. */
  autoFocus?: boolean
  /**
   * Grow the textarea to fit its (usually prefilled) content on mount and as it's edited,
   * capped at ~60vh beyond which it scrolls. Off by default; used by editors that open
   * prefilled with text that may be much longer than the default 3 rows.
   */
  autoGrow?: boolean
  /** Called with every edit, e.g. to keep an unsent note (demo2 follow-up 2). */
  onChange?(text: string): void
  onSave(text: string): void
  onCancel(): void
}

const AUTO_GROW_MAX_VH = 60

function resizeToFit(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  const max = Math.round((window.innerHeight * AUTO_GROW_MAX_VH) / 100)
  const next = Math.min(el.scrollHeight, max)
  el.style.height = `${next}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

export function CommentEditor({
  label = 'Comment',
  initial = '',
  submitLabel = 'Save to draft',
  allowEmpty = false,
  autoFocus = true,
  autoGrow = false,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const [text, setText] = useState(initial)
  const submit = () => {
    const t = text.trim()
    if (t || allowEmpty) onSave(t)
  }
  return (
    <div className="comment-editor">
      <div className="input-card">
        <textarea
          aria-label={label}
          placeholder={label}
          autoFocus={autoFocus}
          rows={3}
          value={text}
          ref={(el) => {
            if (autoGrow && el) resizeToFit(el)
          }}
          onChange={(e) => {
            setText(e.target.value)
            onChange?.(e.target.value)
            if (autoGrow) resizeToFit(e.target)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      </div>
      <div className="actions">
        <button type="button" className="btn primary small" disabled={!allowEmpty && !text.trim()} onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
