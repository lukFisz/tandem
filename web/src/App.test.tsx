import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FakeEventSource } from './test/fakeEventSource'
import { App } from './App'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it('routes /s/<id> to the session page', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    window.history.pushState({}, '', '/s/s_abc123')
    render(<App />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
    expect(FakeEventSource.instances.at(-1)?.url).toBe('/api/sessions/s_abc123/stream')
  })

  it('routes everything else to the session list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')))
    render(<App />)
    expect(await screen.findByText('No sessions yet. Ask your agent to run tdm session new.')).toBeInTheDocument()
  })
})
