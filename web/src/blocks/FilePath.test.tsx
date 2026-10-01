import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithCtx, makeCtx } from '../test/session'
import { FilePath } from './FilePath'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('FilePath', () => {
  it('shows a spinner while opening, then the editor name, then nothing', async () => {
    vi.useFakeTimers()
    const d = deferred<string | null>()
    const { container } = renderWithCtx(<FilePath path="a.kt" line={3} />, makeCtx({ openPath: vi.fn(() => d.promise) }))
    fireEvent.click(screen.getByRole('button', { name: 'a.kt' }))
    expect(container.querySelector('.tdm-spinner')).not.toBeNull()
    expect(screen.getByText('Opening…')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    await act(async () => d.resolve('cursor'))
    expect(container.querySelector('.tdm-spinner')).toBeNull()
    expect(screen.getByText('✓ opened in Cursor')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(1500))
    expect(screen.queryByText(/opened in/)).toBeNull()
  })

  it('goes back to idle when the open fails', async () => {
    const { container } = renderWithCtx(<FilePath path="a.kt" />, makeCtx({ openPath: vi.fn(async () => null) }))
    fireEvent.click(screen.getByRole('button', { name: 'a.kt' }))
    await act(async () => {})
    expect(screen.queryByText(/opened in/)).toBeNull()
    expect(container.querySelector('.tdm-spinner')).toBeNull()
  })

  it('ignores a second click while opening', async () => {
    const d = deferred<string | null>()
    const openPath = vi.fn(() => d.promise)
    renderWithCtx(<FilePath path="a.kt" />, makeCtx({ openPath }))
    fireEvent.click(screen.getByRole('button', { name: 'a.kt' }))
    fireEvent.click(screen.getByRole('button'))
    expect(openPath).toHaveBeenCalledTimes(1)
    await act(async () => d.resolve(null))
  })
})
