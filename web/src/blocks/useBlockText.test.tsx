import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithCtx, makeCtx } from '../test/session'
import { useBlockText } from './useBlockText'

function Harness({ sha }: { sha: string }) {
  const { text, error } = useBlockText({ type: 'file', blobSha: sha })
  return <div>{error ?? text ?? 'loading'}</div>
}

describe('useBlockText', () => {
  it('resets to loading before fetching a new blobSha, instead of showing stale text', async () => {
    let resolveSecond: (v: string) => void = () => {}
    const loadBlob = vi.fn((sha: string) => {
      if (sha === 'sha1') return Promise.resolve('first text')
      return new Promise<string>((resolve) => {
        resolveSecond = resolve
      })
    })
    const ctx = makeCtx({ loadBlob })
    const { rerender } = renderWithCtx(<Harness sha="sha1" />, ctx)
    expect(await screen.findByText('first text')).toBeInTheDocument()

    rerender(<Harness sha="sha2" />)
    expect(await screen.findByText('loading')).toBeInTheDocument()
    expect(screen.queryByText('first text')).toBeNull()

    resolveSecond('second text')
    expect(await screen.findByText('second text')).toBeInTheDocument()
  })
})
