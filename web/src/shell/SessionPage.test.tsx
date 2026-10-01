import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fixture from '../test/fixtures/snapshot.json'
import { FakeEventSource } from '../test/fakeEventSource'
import { REPO_KT } from '../test/session'
import { SessionPage } from './SessionPage'

const fetchMock = vi.fn()

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/blobs/')) return new Response(REPO_KT)
    if (url.endsWith('/render/export')) return new Response('# Implement idea ABC\n')
    if (url.includes('/api/settings')) {
      return new Response(JSON.stringify({ editor: 'cursor', editors: [{ id: 'cursor', name: 'Cursor', installed: true }] }))
    }
    return new Response('{}')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const load = () => act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(fixture)))
const emit = (json: string) => act(() => FakeEventSource.instances.at(-1)!.emit('state', json))
// Every thread of st_1 resolved, st_1's summary proposed or accepted. Without `later`, st_2 is
// dropped, so st_1 is the last stage.
function stageSnap(status: 'summary_proposed' | 'accepted', later: boolean): string {
  const snap = structuredClone(fixture) as typeof fixture
  for (const id of ['t_1', 't_2', 't_3'] as const) snap.state.threads[id].status = 'resolved'
  Object.assign(
    snap.state.stages[0],
    status === 'accepted' ? { status, summary: 'We keep a JSONL log.' } : { status, proposedSummary: 'We keep a JSONL log.' },
  )
  if (!later) snap.state.stages.pop()
  return JSON.stringify(snap)
}

describe('SessionPage', () => {
  it('connects, then opens the first unresolved thread', async () => {
    render(<SessionPage sid="s_fixture" />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
    load()
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    expect(document.title).toBe('Implement idea ABC · Tandem')
  })

  it('follows the hash and j/k', async () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    await userEvent.keyboard('j')
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#t_2')
  })

  it('explains a session that cannot be loaded', () => {
    render(<SessionPage sid="s_nope00" />)
    act(() => FakeEventSource.instances.at(-1)!.fail(true))
    expect(screen.getByText(/Cannot load session s_nope00/)).toBeInTheDocument()
  })

  it('exports to the clipboard and ends the session', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(writeText).toHaveBeenCalledWith('# Implement idea ABC\n')
    expect(await screen.findByText('Decision document copied to the clipboard.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/actions'))!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ type: 'session.end', data: {} })
    expect(await screen.findByText('✓ Session ended')).toBeInTheDocument()
    expect(screen.getByText('✓ Session ended').closest('.toast')).toHaveClass('is-info')
  })

  // F10: a clipboard failure gets its own message, separate from noticeFromError's
  // generic "Is the tdm daemon running?" hint, which fits only a fetch failure.
  it('shows a clipboard-specific error when the copy itself fails (F10)', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not copy to the clipboard.')
    expect(alert).toHaveTextContent('Your browser blocked clipboard access.')
  })

  it('shows the daemon hint when the export fetch itself fails (F10)', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/render/export')
        ? new Response('{"error":{"code":"export_failed","message":"boom"}}', { status: 500 })
        : url.includes('/blobs/')
          ? new Response(REPO_KT)
          : new Response('{}'),
    )
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('export_failed: boom')
  })

  it('advances to the next open thread once accepting a proposed conclusion succeeds (F12b-4)', async () => {
    window.location.hash = '#t_2'
    render(<SessionPage sid="s_fixture" />)
    load()
    // Opened on t_2 (conclusion proposed). Accepting it should move on to t_3, the
    // remaining open thread in the stage.
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Docs' })).toBeInTheDocument()
  })

  it('advances to the stage once the last open thread is accepted (F12b-4)', async () => {
    const allButT2Resolved = structuredClone(fixture) as typeof fixture
    allButT2Resolved.state.threads.t_1.status = 'resolved'
    allButT2Resolved.state.threads.t_3.status = 'resolved'
    render(<SessionPage sid="s_fixture" />)
    act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(allButT2Resolved)))
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Data model' })).toBeInTheDocument()
  })

  it('does not advance when the accept fails (F12b-4)', async () => {
    window.location.hash = '#t_2'
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions')
        ? new Response('{"error":{"code":"thread_resolved","message":"boom"}}', { status: 400 })
        : new Response(REPO_KT),
    )
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
  })

  it('does not advance after Accept resolves if the user already navigated elsewhere (fix round 1, Important)', async () => {
    window.location.hash = '#t_2'
    let resolveActions: ((r: Response) => void) | undefined
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/actions')) return new Promise<Response>((resolve) => (resolveActions = resolve))
      if (url.includes('/blobs/')) return new Response(REPO_KT)
      return new Response('{}')
    })
    render(<SessionPage sid="s_fixture" />)
    load()
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Accept/ }))
    // The user navigates to t_1 (via k) while the accept is still in flight; nextAfterResolve
    // for t_2 would be t_3, so landing on t_3 afterwards would show the guard did nothing.
    await userEvent.keyboard('k')
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    await act(async () => {
      resolveActions!(new Response('{}'))
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
  })

  // Stage summary flow, part B: Accept summary moves on to the next stage, at once when it exists.
  it('advances to the next stage once Accept summary succeeds', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('summary_proposed', true))
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    // st_2 has no threads yet, so its stage page opens.
    expect(await screen.findByRole('heading', { level: 1, name: 'API' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#st_2')
  })

  it('waits on the last stage after Accept summary, then advances when the AI adds a stage', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('summary_proposed', false))
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    emit(stageSnap('accepted', false))
    expect(screen.getByRole('heading', { level: 1, name: 'Data model' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: "Summary accepted — waiting for the AI's next step…" })).toBeInTheDocument()
    emit(stageSnap('accepted', true))
    expect(await screen.findByRole('heading', { level: 1, name: 'API' })).toBeInTheDocument()
  })

  it('does not advance to a new stage once the user has left the accepted stage', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('summary_proposed', false))
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    emit(stageSnap('accepted', false))
    await userEvent.keyboard('j')
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    emit(stageSnap('accepted', true))
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
  })

  it("ends the session from the accepted last stage through the top bar's path", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    emit(stageSnap('accepted', false))
    const box = screen.getByRole('region', { name: 'Stage summary' })
    await userEvent.click(within(box).getByRole('button', { name: 'End session' }))
    expect(window.confirm).toHaveBeenCalledWith('End this session? The AI will wrap up and export.')
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/actions'))!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ type: 'session.end', data: {} })
    expect(await screen.findByText('✓ Session ended')).toBeInTheDocument()
  })

  it('keeps the global keydown listener stable across an unrelated rerender (regression: ctx stability)', async () => {
    // Round 2's fix (931ca30) put `follow` — a fresh object literal on every useFollowBottom
    // call — into ctx's useMemo deps, so ctx (and run/sendReview) got new identities on every
    // LoadedSession render, tearing down and reinstalling useShortcuts' document keydown
    // listener each time. Exporting triggers an unrelated re-render (setNotice) without
    // changing the snapshot, current item or select — the listener must not be touched.
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    render(<SessionPage sid="s_fixture" />)
    load()
    const keydownAdds = () => addSpy.mock.calls.filter(([type]) => type === 'keydown').length
    const keydownRemoves = () => removeSpy.mock.calls.filter(([type]) => type === 'keydown').length
    const addsAfterLoad = keydownAdds()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await screen.findByText('Decision document copied to the clipboard.')
    expect(keydownAdds()).toBe(addsAfterLoad)
    expect(keydownRemoves()).toBe(0)
  })

  it('clears the line selection when the current item changes (M4)', async () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()

    // Select line 14 of b_2 in t_1.
    await userEvent.click(await screen.findByRole('button', { name: 'Line 14' }))
    expect(screen.getByRole('button', { name: /^Comment on/ })).toBeInTheDocument()

    // Navigate away to t_2 without resolving the selection...
    await userEvent.keyboard('j')
    expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()

    // ...then open the (stale) selection's editor while on t_2 — the shortcut does not check
    // that the selection still belongs to the current item.
    await userEvent.keyboard('c')

    // Navigating back to t_1 must not find that editor already open there: the selection
    // should have been cleared the moment the item changed.
    await userEvent.keyboard('k')
    expect(screen.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()
  })

  it('shows daemon errors with their hint', async () => {
    window.location.hash = '#t_2'
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions')
        ? new Response('{"error":{"code":"thread_resolved","message":"thread t_2 is resolved","hint":"add a new thread"}}', { status: 400 })
        : new Response(REPO_KT),
    )
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: /^Accept/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('thread_resolved: thread t_2 is resolved')
    expect(screen.getByRole('alert')).toHaveTextContent('add a new thread')
  })

  it('flips to "AI not connected" after 10 quiet minutes without a new snapshot (feature review t_6)', () => {
    vi.useFakeTimers()
    try {
      window.location.hash = '#st_2'
      render(<SessionPage sid="s_fixture" />)
      const snap = { ...structuredClone(fixture), agentSeenAt: Date.now() - 9 * 60_000 - 50_000 }
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      expect(screen.getByText('AI is working…')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(30_000))
      expect(screen.getByText('AI not connected')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // Demo2 follow-up 4: a chip opens the thread it names through the hash routing.
  it('opens the thread an id chip names', async () => {
    const snap = structuredClone(fixture)
    snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache is t_2.'
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
    const chip = screen.getByRole('link', { name: 'Cache strategy' })
    expect(chip).toHaveAttribute('title', 'id: t_2')
    await userEvent.click(chip)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
  })

  // Question message spec, part A: an option chip opens the option's thread and scrolls to it.
  it('opens the thread of an option chip and scrolls to the option', async () => {
    const scrolled: { el: Element; arg: unknown }[] = []
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg })
    }
    try {
      const snap = structuredClone(fixture)
      snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache uses o_2.'
      window.location.hash = '#t_1'
      render(<SessionPage sid="s_fixture" />)
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      const chip = screen.getByRole('link', { name: 'Lazy delegate' })
      expect(chip).toHaveAttribute('title', 'id: o_2')
      await userEvent.click(chip)
      // The chip is a real anchor: the hash change it makes arrives via a native `hashchange`
      // event, outside any act() userEvent controls, so the heading, the pinned hash and the
      // scroll each settle on their own tick — wait for all three instead of asserting right
      // after the first one appears.
      expect(await screen.findByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()
      await waitFor(() => expect(window.location.hash).toBe('#t_2'))
      await waitFor(() =>
        expect(scrolled).toContainEqual({ el: document.querySelector('[data-option="o_2"]'), arg: { block: 'center', behavior: 'smooth' } }),
      )
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Question message spec: a question chip opens the question's thread and scrolls to the question.
  it('opens the thread of a question chip and scrolls to the question (question message spec)', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const snap = structuredClone(fixture)
      snap.state.threads.t_1.messages[0].text = 'See q_1; I would answer o_4.'
      window.location.hash = '#t_1'
      render(<SessionPage sid="s_fixture" />)
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      expect(screen.getByRole('link', { name: 'No' })).toHaveAttribute('title', 'id: o_4')
      const chip = screen.getByRole('link', { name: 'Should the docs cover the blob layout?' })
      expect(chip).toHaveAttribute('title', 'id: q_1')
      await userEvent.click(chip)
      expect(await screen.findByRole('heading', { level: 1, name: 'Docs' })).toBeInTheDocument()
      await waitFor(() => expect(window.location.hash).toBe('#t_3'))
      await waitFor(() => expect(scrolled).toContain(document.querySelector('[data-question="q_1"]')))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Demo 6 follow-ups 1: a header link jumps like a chip: to the question an answer answers, and to
  // the option a choice chose.
  it('jumps from an answer header to its question, and from a choice header to its option', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.location.hash = '#t_2'
      render(<SessionPage sid="s_fixture" />)
      load()
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      await waitFor(() => expect(scrolled).toContain(document.querySelector('[data-question="q_2"]')))
      await waitFor(() => expect(window.location.hash).toBe('#t_2'))
      expect(screen.getByRole('heading', { level: 1, name: 'Cache strategy' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('link', { name: /Chose .*Lazy delegate/ }))
      await waitFor(() => expect(scrolled).toContain(document.querySelector('[data-option="o_2"]')))
      await waitFor(() => expect(window.location.hash).toBe('#t_2'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Demo 6 follow-ups 3: the option or question a jump lands on is highlighted.
  it('highlights the option an option chip jumps to', async () => {
    Element.prototype.scrollIntoView = function () {}
    try {
      const snap = structuredClone(fixture)
      snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache uses o_2.'
      window.location.hash = '#t_1'
      render(<SessionPage sid="s_fixture" />)
      act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snap)))
      await userEvent.click(screen.getByRole('link', { name: 'Lazy delegate' }))
      await waitFor(() => expect(document.querySelector('[data-option="o_2"]')).toHaveClass('is-jump-target'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Review Focus 1: a repeated click on the same header plays the highlight again.
  it('highlights the question an answer header jumps to, again on a repeated click', async () => {
    Element.prototype.scrollIntoView = function () {}
    try {
      window.location.hash = '#t_2'
      render(<SessionPage sid="s_fixture" />)
      load()
      const question = () => document.querySelector('[data-question="q_2"]')!
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      await waitFor(() => expect(question()).toHaveClass('is-jump-target'))
      // Stand in for the timer that clears the tint, then click the same header again.
      question().classList.remove('is-jump-target')
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      await waitFor(() => expect(question()).toHaveClass('is-jump-target'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Fix round 1: unmounting while a highlight is pending must clear it (the controller ruling), not
  // just leave its timer running against a component that is gone.
  it('clears a pending highlight on unmount', async () => {
    Element.prototype.scrollIntoView = function () {}
    try {
      window.location.hash = '#t_2'
      const { unmount } = render(<SessionPage sid="s_fixture" />)
      load()
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      const question = document.querySelector('[data-question="q_2"]') as HTMLElement
      await waitFor(() => expect(question).toHaveClass('is-jump-target'))
      unmount()
      expect(question).not.toHaveClass('is-jump-target')
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Fix round 1: jumping from one target to another must clear the earlier target, not leave it
  // tinted forever once the effect moves on to the new one.
  it('jumping from one target to another clears the earlier target and highlights the new one', async () => {
    Element.prototype.scrollIntoView = function () {}
    try {
      window.location.hash = '#t_2'
      render(<SessionPage sid="s_fixture" />)
      load()
      await userEvent.click(screen.getByRole('link', { name: /Chose .*Lazy delegate/ }))
      const option = () => document.querySelector('[data-option="o_2"]')!
      await waitFor(() => expect(option()).toHaveClass('is-jump-target'))
      await userEvent.click(screen.getByRole('link', { name: 'Cache user lookups too?' }))
      const question = () => document.querySelector('[data-question="q_2"]')!
      await waitFor(() => expect(question()).toHaveClass('is-jump-target'))
      expect(option()).not.toHaveClass('is-jump-target')
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Resolve feedback 2, end to end through useSession: the reconnect path is the real one.
  it('flashes a thread resolved over the live stream, but not threads resolved while reconnecting', () => {
    const resolved = (ids: string[]) => {
      const snap = structuredClone(fixture) as typeof fixture
      for (const id of ids) snap.state.threads[id as 't_1'].status = 'resolved'
      return JSON.stringify(snap)
    }
    render(<SessionPage sid="s_fixture" />)
    const es = FakeEventSource.instances.at(-1)!
    act(() => es.emit('state', resolved(['t_3'])))
    expect(screen.getByRole('button', { name: 'Docs' })).not.toHaveClass('is-just-resolved')

    act(() => es.emit('state', resolved(['t_3', 't_1'])))
    expect(screen.getByRole('button', { name: 'Repository layer' })).toHaveClass('is-just-resolved')

    act(() => es.fail(false))
    act(() => es.emit('state', resolved(['t_3', 't_1', 't_2'])))
    expect(screen.getByRole('button', { name: 'Cache strategy' })).toHaveClass('is-resolved')
    expect(screen.getByRole('button', { name: 'Cache strategy' })).not.toHaveClass('is-just-resolved')
  })

  // Resolve feedback 3: the toast confirms only a request that succeeded.
  it('shows no End session toast when the confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/actions'))).toBe(false)
    expect(screen.queryByText('✓ Session ended')).toBeNull()
  })

  it('shows the error, not the End session toast, when ending fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions')
        ? new Response('{"error":{"code":"end_failed","message":"boom"}}', { status: 500 })
        : url.includes('/blobs/')
          ? new Response(REPO_KT)
          : new Response('{}'),
    )
    render(<SessionPage sid="s_fixture" />)
    load()
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('end_failed: boom')
    expect(screen.queryByText('✓ Session ended')).toBeNull()
  })

  describe('settings gear', () => {
    afterEach(() => {
      delete document.documentElement.dataset.theme
    })

    it('opens a menu that sets the theme and lists editors', async () => {
      render(<SessionPage sid="s_fixture" />)
      load()
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
      expect(await screen.findByRole('menuitemradio', { name: /System/ })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('menuitemradio', { name: 'Cursor' })).toHaveAttribute('aria-checked', 'true')
      await userEvent.click(screen.getByRole('menuitemradio', { name: /Light/ }))
      expect(document.documentElement.dataset.theme).toBe('light')
    })
  })
})
