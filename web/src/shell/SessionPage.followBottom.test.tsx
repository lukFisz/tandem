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
    return new Response('{}')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const load = (snapshot: unknown = fixture) => act(() => FakeEventSource.instances.at(-1)!.emit('state', JSON.stringify(snapshot)))

// jsdom has no layout: stub the scroll geometry and scrollTo by hand, as useFollowBottom.test.tsx does.
function stubMain(opts: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = document.querySelector('.main') as HTMLElement
  let scrollTop = opts.scrollTop
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
    configurable: true,
  })
  el.scrollTo = vi.fn((arg: ScrollToOptions | number) => {
    if (typeof arg === 'object' && typeof arg.top === 'number') scrollTop = arg.top
  }) as typeof el.scrollTo
  // useFollowBottom tracks "near the bottom" continuously via scroll events (as a real browser
  // would fire while the user scrolls), so establish that baseline explicitly here too.
  el.dispatchEvent(new Event('scroll'))
  return el
}

function withExtraMessage() {
  return withExtraMessageOn('t_1')
}

function withExtraMessageOn(threadId: 't_1' | 't_2') {
  const next = structuredClone(fixture) as typeof fixture
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  next.state.threads[threadId].messages.push({ actor: 'ai', text: 'More detail.', seq: 20 } as any)
  return next
}

describe('SessionPage follows new content (F12b-2)', () => {
  it('scrolls to the bottom automatically when the user is near the bottom already', () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - 50 })
    load(withExtraMessage())
    expect(main.scrollTo).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /New below/ })).toBeNull()
  })

  it('shows a "New below" pill instead of scrolling when the user is scrolled up, and clears it on click', async () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    load(withExtraMessage())
    expect(main.scrollTo).not.toHaveBeenCalled()
    const pill = await screen.findByRole('button', { name: /New below/ })

    await userEvent.click(pill)
    expect(main.scrollTo).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /New below/ })).toBeNull()
  })

  it('does not show the pill just from switching to a different item', () => {
    render(<SessionPage sid="s_fixture" />)
    load()
    stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    act(() => {
      window.location.hash = '#t_1'
    })
    expect(screen.queryByRole('button', { name: /New below/ })).toBeNull()
  })

  it('scrolls to the bottom when the typing bubble appears while near the bottom (review round 3, Minor: the bubble must be reflected in contentKey)', () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - 50 })
    // t_1's latest user message (seq 15) has lastAiSeq 7: delivering it (delivered: 15) makes
    // the typing bubble appear at the end of the timeline, without any new timeline item or
    // conclusion/summary text — so only the bubble flag in contentKey can be what triggers this.
    const withBubble = structuredClone(fixture) as typeof fixture
    withBubble.state.delivered = 15
    load(withBubble)
    expect(main.scrollTo).toHaveBeenCalled()
  })

  it('does not recreate the global keydown listener more than once when a snapshot update also shows the "New below" pill (review round 3, Minor: ctx must not depend on the whole `follow` object)', async () => {
    // Loading a new snapshot with an extra message legitimately changes `state` (and so
    // `rawCtx`, and so `ctx`) once — that one teardown/recreate of the listener is expected and
    // fine. What must NOT happen is a *second* one just because useFollowBottom's own internal
    // re-render (setting showPill) used to hand `ctx` a new `follow` object on top of that.
    window.location.hash = '#t_1'
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    render(<SessionPage sid="s_fixture" />)
    load()
    stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    const keydownAdds = () => addSpy.mock.calls.filter(([type]) => type === 'keydown').length
    const keydownRemoves = () => removeSpy.mock.calls.filter(([type]) => type === 'keydown').length
    const addsBefore = keydownAdds()
    load(withExtraMessage()) // scrolled up, so this shows the pill rather than scrolling
    expect(await screen.findByRole('button', { name: /New below/ })).toBeInTheDocument()
    expect(keydownAdds()).toBe(addsBefore + 1)
    expect(keydownRemoves()).toBe(1)
  })

  it('scrolls to the bottom right after a successful send, even if scrolled up', async () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'Looks good{Meta>}{Enter}{/Meta}')
    expect(main.scrollTo).toHaveBeenCalled()
  })
})

describe('SessionPage follows the reply after any user action (fix round 2, user report)', () => {
  it('scrolls to the bottom once the AI replies after the user chooses a variant, even if scrolled up', async () => {
    window.location.hash = '#t_2' // t_2 holds the variants block
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Send choice' }))
    load(withExtraMessageOn('t_2'))
    expect(main.scrollTo).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /New below/ })).toBeNull()
  })

  it('does not arm on a failed action', async () => {
    window.location.hash = '#t_2'
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions') ? new Response('{"error":{"code":"boom","message":"boom"}}', { status: 400 }) : new Response(REPO_KT),
    )
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Send choice' }))
    await screen.findByRole('alert')
    load(withExtraMessageOn('t_2'))
    expect(main.scrollTo).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /New below/ })).toBeInTheDocument()
  })

  it('does not fire on the item switch that follows an action, and does not carry over to the new item', async () => {
    window.location.hash = '#t_2'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Send choice' }))
    // The user switches to a different thread themselves before any reply grows t_2.
    await userEvent.keyboard('j') // t_2 -> t_3
    expect(screen.getByRole('heading', { level: 1, name: 'Docs' })).toBeInTheDocument()
    expect(main.scrollTo).not.toHaveBeenCalled()
    load(withExtraMessageOn('t_2')) // growth happens on the thread the user left, not the one shown
    expect(main.scrollTo).not.toHaveBeenCalled()
  })

  it('a manual scroll after the action disarms it', async () => {
    window.location.hash = '#t_2'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Send choice' }))
    main.scrollTop = 5 // still far from the bottom, but a manual scroll happened
    main.dispatchEvent(new Event('scroll'))
    load(withExtraMessageOn('t_2'))
    expect(main.scrollTo).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /New below/ })).toBeInTheDocument()
  })
})

describe('SessionPage lands on a new stage summary (demo2 follow-up 6)', () => {
  function withStage(over: Record<string, unknown>) {
    const next = structuredClone(fixture) as typeof fixture
    Object.assign(next.state.stages[0], over)
    return next
  }

  it('scrolls to the start of a proposed (and re-proposed) summary, not to the bottom', () => {
    const scrolled: { el: Element; arg: unknown }[] = []
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg })
    }
    try {
      window.location.hash = '#st_1'
      render(<SessionPage sid="s_fixture" />)
      load()
      const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 }) // near the bottom
      load(withStage({ status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }))
      const first = screen.getByRole('region', { name: 'Proposed stage summary' })
      expect(scrolled).toEqual([{ el: first, arg: { block: 'start', behavior: 'smooth' } }])
      expect(main.scrollTo).not.toHaveBeenCalled()

      load(withStage({ status: 'open' })) // changes requested
      load(withStage({ status: 'summary_proposed', proposedSummary: 'We keep a JSONL log and blobs.' }))
      const second = screen.getByRole('region', { name: 'Proposed stage summary' })
      expect(scrolled.at(-1)).toEqual({ el: second, arg: { block: 'start', behavior: 'smooth' } })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // Stage summary flow spec, part E, Review Focus 3: a stage message under a proposed summary is
  // followed like a thread message; only a new proposal lands on the summary's start.
  it('follows the bottom, not the summary start, when a stage message arrives', () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.location.hash = '#st_1'
      render(<SessionPage sid="s_fixture" />)
      const proposed = { status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
      load(withStage(proposed))
      const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 450 }) // near the bottom
      load(withStage({ ...proposed, messages: [{ actor: 'ai', text: 'Happy to change it.', seq: 30 }], lastAiSeq: 30 }))
      expect(screen.getByText('Happy to change it.')).toBeInTheDocument()
      expect(scrolled).toEqual([])
      expect(main.scrollTo).toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})

// Demo 7 follow-ups 4: an Accept summary that does not move on (no later stage) scrolls the page
// to the bottom, so the accepted box and its waiting or end state are in view.
describe('SessionPage scrolls to the accepted box after Accept summary (demo 7 follow-ups 4)', () => {
  // Every thread of st_1 resolved, st_1's summary proposed or accepted. Without `later`, st_2 is
  // dropped, so st_1 is the last stage.
  function stageSnap(status: 'summary_proposed' | 'accepted', later: boolean) {
    const snap = structuredClone(fixture) as typeof fixture
    for (const id of ['t_1', 't_2', 't_3'] as const) snap.state.threads[id].status = 'resolved'
    Object.assign(
      snap.state.stages[0],
      status === 'accepted' ? { status, summary: 'We keep a JSONL log.' } : { status, proposedSummary: 'We keep a JSONL log.' },
    )
    if (!later) snap.state.stages.pop()
    return snap
  }
  const bottom = (behavior: ScrollBehavior) => ({ top: 1000, behavior })

  it('scrolls smoothly to the bottom once the last stage is accepted', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    load(stageSnap('summary_proposed', false))
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    load(stageSnap('accepted', false))
    expect(screen.getByRole('region', { name: 'Stage summary' })).toBeInTheDocument()
    expect(main.scrollTo).toHaveBeenCalledWith(bottom('smooth'))
  })

  it('scrolls once the accept succeeds when the accepted snapshot arrived first', async () => {
    let respond: (r: Response) => void = () => {}
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions') ? new Promise<Response>((r) => (respond = r)) : new Response(REPO_KT),
    )
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    load(stageSnap('summary_proposed', false))
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    load(stageSnap('accepted', false))
    expect(main.scrollTo).not.toHaveBeenCalled()
    await act(async () => {
      respond(new Response('{}'))
      await Promise.resolve()
    })
    expect(main.scrollTo).toHaveBeenCalledWith(bottom('smooth'))
  })

  it('jumps without smooth scrolling under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    load(stageSnap('summary_proposed', false))
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    load(stageSnap('accepted', false))
    expect(main.scrollTo).toHaveBeenCalledWith(bottom('auto'))
  })

  it('does not scroll when the accept moves on to the next stage', async () => {
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    load(stageSnap('summary_proposed', true))
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'API' })).toBeInTheDocument()
    expect(main.scrollTo).not.toHaveBeenCalled()
  })

  it('does not scroll after a failed accept', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/actions') ? new Response('{"error":{"code":"boom","message":"boom"}}', { status: 400 }) : new Response(REPO_KT),
    )
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    load(stageSnap('summary_proposed', false))
    const main = stubMain({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Accept summary' }))
    await screen.findByRole('alert')
    expect(main.scrollTo).not.toHaveBeenCalled()
  })
})

// Demo 7 follow-ups 3: leaving an item and coming back restores its scroll position and its
// cards' collapse state, for the page session.
describe('SessionPage keeps scroll and collapse across navigation (demo 7 follow-ups 3)', () => {
  const heading = (name: string) => screen.findByRole('heading', { level: 1, name })
  function scrollMain(main: HTMLElement, top: number) {
    main.scrollTop = top
    main.dispatchEvent(new Event('scroll'))
  }

  it('restores the scroll position on return; a never-visited item starts at the top', async () => {
    window.location.hash = '#t_1'
    render(<SessionPage sid="s_fixture" />)
    load()
    const main = stubMain({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
    scrollMain(main, 700)
    await userEvent.keyboard('j') // t_1 -> t_2, never visited
    await heading('Cache strategy')
    expect(main.scrollTop).toBe(0)
    scrollMain(main, 300)
    await userEvent.keyboard('k')
    await heading('Repository layer')
    expect(main.scrollTop).toBe(700)
    await userEvent.keyboard('j')
    await heading('Cache strategy')
    expect(main.scrollTop).toBe(300)
  })

  it('a jump target still wins over the restored position', async () => {
    const snap = structuredClone(fixture)
    snap.state.threads.t_1.messages[0].text = 'Here is the repository layer. The cache uses o_2.'
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
      ;(document.querySelector('.main') as HTMLElement).scrollTop = 42
    }
    try {
      window.location.hash = '#t_2'
      render(<SessionPage sid="s_fixture" />)
      load(snap)
      const main = stubMain({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
      scrollMain(main, 700) // t_2 is remembered at 700
      await userEvent.keyboard('k')
      await heading('Repository layer')
      await userEvent.click(screen.getByRole('link', { name: 'Lazy delegate' }))
      await heading('Cache strategy')
      await waitFor(() => expect(scrolled).toContain(document.querySelector('[data-option="o_2"]')))
      expect(main.scrollTop).toBe(42)
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('lands on a summary proposed while the user was away, instead of restoring', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.location.hash = '#st_1'
      render(<SessionPage sid="s_fixture" />)
      load()
      const main = stubMain({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
      scrollMain(main, 700)
      await userEvent.keyboard('j') // st_1 -> t_1
      await heading('Repository layer')
      const proposed = structuredClone(fixture) as typeof fixture
      Object.assign(proposed.state.stages[0], { status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' })
      load(proposed)
      expect(scrolled).toEqual([]) // proposed on another item: nothing to land on here
      await userEvent.keyboard('k')
      await heading('Data model')
      expect(scrolled).toEqual([screen.getByRole('region', { name: 'Proposed stage summary' })])
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('restores, without landing, a stage whose proposed summary did not change while away', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const proposed = structuredClone(fixture) as typeof fixture
      Object.assign(proposed.state.stages[0], { status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' })
      window.location.hash = '#st_1'
      render(<SessionPage sid="s_fixture" />)
      load(proposed)
      const main = stubMain({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
      scrollMain(main, 700)
      await userEvent.keyboard('j')
      await heading('Repository layer')
      await userEvent.keyboard('k')
      await heading('Data model')
      expect(scrolled).toEqual([])
      expect(main.scrollTop).toBe(700)
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('keeps a collapsed conclusion collapsed, with "Updated", after leaving and coming back', async () => {
    window.location.hash = '#t_2'
    render(<SessionPage sid="s_fixture" />)
    load()
    const card = () => screen.getByRole('region', { name: 'Proposed conclusion' })
    await userEvent.click(within(card()).getByRole('button', { name: 'Collapse' }))
    await userEvent.keyboard('j') // t_2 -> t_3
    await heading('Docs')
    const reproposed = structuredClone(fixture) as typeof fixture
    Object.assign(reproposed.state.threads.t_2, { proposedConclusion: 'Use a lazy delegate and a TTL.', proposalVersion: 2 })
    load(reproposed)
    await userEvent.keyboard('k')
    await heading('Cache strategy')
    expect(within(card()).getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    expect(within(card()).getByText('Updated')).toBeInTheDocument()
  })

  it('keeps a collapsed stage summary collapsed after leaving and coming back', async () => {
    const proposed = structuredClone(fixture) as typeof fixture
    Object.assign(proposed.state.stages[0], { status: 'summary_proposed', proposedSummary: 'We keep a JSONL log. And blobs.' })
    window.location.hash = '#st_1'
    render(<SessionPage sid="s_fixture" />)
    load(proposed)
    const card = () => screen.getByRole('region', { name: 'Proposed stage summary' })
    await userEvent.click(within(card()).getByRole('button', { name: 'Collapse' }))
    await userEvent.keyboard('j')
    await heading('Repository layer')
    await userEvent.keyboard('k')
    await heading('Data model')
    expect(within(card()).getByRole('button', { name: 'Expand' })).toBeInTheDocument()
  })
})
