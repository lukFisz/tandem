import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommentEditor } from './CommentEditor'

describe('CommentEditor', () => {
  it('renders its field inside an input card (also used by the proposal, summary and conclusion editors)', () => {
    render(<CommentEditor label="Edit summary" onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Edit summary').closest('.input-card')).not.toBeNull()
    expect(screen.getByLabelText('Edit summary').closest('.comment-editor')).not.toBeNull()
  })

  it('grows to fit prefilled content on mount when autoGrow is set (scrollHeight stubbed)', () => {
    const proto = window.HTMLTextAreaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 400 })
    try {
      render(<CommentEditor label="Edit summary" initial="long text" autoGrow onSave={vi.fn()} onCancel={vi.fn()} />)
      const textarea = screen.getByLabelText('Edit summary') as HTMLTextAreaElement
      expect(textarea.style.height).toBe('400px')
    } finally {
      if (desc) Object.defineProperty(proto, 'scrollHeight', desc)
      else delete (proto as unknown as Record<string, unknown>).scrollHeight
    }
  })

  it('caps the height at ~60vh when content is taller than the viewport allows', () => {
    const proto = window.HTMLTextAreaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 10000 })
    try {
      render(<CommentEditor label="Edit summary" initial="very long text" autoGrow onSave={vi.fn()} onCancel={vi.fn()} />)
      const textarea = screen.getByLabelText('Edit summary') as HTMLTextAreaElement
      const maxPx = Math.round((window.innerHeight * 60) / 100)
      expect(textarea.style.height).toBe(`${maxPx}px`)
      expect(textarea.style.overflowY).toBe('auto')
    } finally {
      if (desc) Object.defineProperty(proto, 'scrollHeight', desc)
      else delete (proto as unknown as Record<string, unknown>).scrollHeight
    }
  })

  it('leaves non-autoGrow editors at the default fixed size (no inline height set)', () => {
    const proto = window.HTMLTextAreaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 400 })
    try {
      render(<CommentEditor label="Comment" initial="long text" onSave={vi.fn()} onCancel={vi.fn()} />)
      const textarea = screen.getByLabelText('Comment') as HTMLTextAreaElement
      expect(textarea.style.height).toBe('')
      expect(textarea.getAttribute('rows')).toBe('3')
    } finally {
      if (desc) Object.defineProperty(proto, 'scrollHeight', desc)
      else delete (proto as unknown as Record<string, unknown>).scrollHeight
    }
  })
})
