import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ThreadStatus } from '../api/types'
import { addComment, emptyDraft } from '../draft/draft'
import { SessionContext, type SessionCtx } from '../session/context'
import { makeCtx, renderWithCtx, withQuestion, withStageQuestion } from '../test/session'
import { Nav } from './Nav'
import { SessionList } from './SessionList'
import { TopBar } from './TopBar'
import { JUST_RESOLVED_MS } from './useJustResolved'

const draft2 = addComment(
  addComment(emptyDraft, { threadId: 't_1', blockId: 'b_2', lines: { start: 13, end: 13 }, text: 'a' }),
  { threadId: 't_1', blockId: 'b_2', lines: { start: 14, end: 14 }, text: 'b' },
)

afterEach(() => vi.unstubAllGlobals())

describe('Nav', () => {
  it('shows stages, threads, status icons and draft badges', async () => {
    const onSelect = vi.fn()
    renderWithCtx(<Nav current="t_2" onSelect={onSelect} />, makeCtx({ draft: draft2 }))
    expect(screen.getByRole('button', { name: '1 · Data model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 · API' })).toBeInTheDocument()
    const t1 = screen.getByRole('button', { name: /Repository layer/ })
    expect(t1).toHaveTextContent('○')
    expect(screen.getByLabelText('2 draft comments')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cache strategy/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(t1)
    expect(onSelect).toHaveBeenCalledWith('t_1')
  })

  // Question message spec: an open question gets the "awaiting you" dot; nothing else does.
  it('marks a thread with an open question as awaiting you', () => {
    const ctx = makeCtx()
    renderWithCtx(<Nav current="t_1" onSelect={vi.fn()} />, { ...ctx, state: withQuestion(ctx.state) })
    const dot = within(screen.getByRole('button', { name: /Docs/ })).getByLabelText('question awaiting you')
    expect(dot).toHaveClass('badge', 'is-dot')
    expect(screen.getAllByLabelText('question awaiting you')).toHaveLength(1)
  })

  it('shows no question dot for a withdrawn or answered question, or on a resolved thread', () => {
    const base = makeCtx().state
    for (const state of [
      base, // the fixture's q_1 is withdrawn
      withQuestion(base, { answer: { optionId: 'o_3' } }),
      withQuestion(base, {}, { status: 'resolved', conclusion: 'Done.' }),
    ]) {
      const { unmount } = renderWithCtx(<Nav current="t_1" onSelect={vi.fn()} />, makeCtx({ state }))
      expect(screen.queryByLabelText('question awaiting you')).toBeNull()
      unmount()
    }
  })

  // Demo 7 follow-ups 6: a stage with an open question gets the same dot on its stage button.
  it('marks a stage with an open question as awaiting you', () => {
    const base = makeCtx().state
    renderWithCtx(<Nav current="t_1" onSelect={vi.fn()} />, makeCtx({ state: withStageQuestion(base) }))
    const dot = within(screen.getByRole('button', { name: /1 · Data model/ })).getByLabelText('question awaiting you')
    expect(dot).toHaveClass('badge', 'is-dot')
    expect(screen.getAllByLabelText('question awaiting you')).toHaveLength(1)
  })

  it('shows no stage question dot once the stage question is answered or withdrawn', () => {
    const base = makeCtx().state
    for (const state of [withStageQuestion(base, { answer: { optionId: 'o_7' } }), withStageQuestion(base, { withdrawn: true })]) {
      const { unmount } = renderWithCtx(<Nav current="t_1" onSelect={vi.fn()} />, makeCtx({ state }))
      expect(screen.queryByLabelText('question awaiting you')).toBeNull()
      unmount()
    }
  })

  // Resolve feedback 2: the nav confirms a resolve with a ✓ pop and a green flash, once.
  describe('resolve flash', () => {
    // A fresh ctx (new state object, like a new SSE snapshot) with the given thread statuses.
    const snap = (over: Record<string, ThreadStatus> = {}, ctxOver: Partial<SessionCtx> = {}) => {
      const ctx = makeCtx(ctxOver)
      for (const [id, status] of Object.entries(over)) ctx.state.threads[id] = { ...ctx.state.threads[id], status }
      return ctx
    }
    const renderNav = (ctx: SessionCtx, current = 't_1', live = true) => {
      const ui = (c: SessionCtx, cur: string, l: boolean) => (
        <SessionContext.Provider value={c}>
          <Nav current={cur} onSelect={vi.fn()} live={l} />
        </SessionContext.Provider>
      )
      const r = render(ui(ctx, current, live))
      return { update: (c: SessionCtx, cur = current, l = live) => r.rerender(ui(c, cur, l)) }
    }
    const row = (name: string) => screen.getByRole('button', { name })

    afterEach(() => vi.useRealTimers())

    it('does not flash on the first render, even for resolved threads', () => {
      renderNav(snap({ t_1: 'resolved' }))
      expect(row('Repository layer')).toHaveClass('is-resolved')
      expect(row('Repository layer')).toHaveTextContent('✓')
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
    })

    it('flashes a thread that becomes resolved while live, from open or from a proposed conclusion', () => {
      const { update } = renderNav(snap())
      update(snap({ t_1: 'resolved', t_2: 'resolved' }))
      expect(row('Repository layer')).toHaveClass('is-resolved', 'is-just-resolved')
      expect(row('Cache strategy')).toHaveClass('is-resolved', 'is-just-resolved')
      expect(row('Docs')).not.toHaveClass('is-just-resolved')
    })

    it('drops the flash after it played, and never replays it', () => {
      vi.useFakeTimers()
      const { update } = renderNav(snap())
      update(snap({ t_1: 'resolved' }))
      expect(row('Repository layer')).toHaveClass('is-just-resolved')
      act(() => vi.advanceTimersByTime(JUST_RESOLVED_MS))
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
      // A new snapshot with the same statuses, a draft change, and navigating to the thread.
      update(snap({ t_1: 'resolved' }))
      update(snap({ t_1: 'resolved' }, { draft: draft2 }))
      update(snap({ t_1: 'resolved' }), 't_2')
      expect(row('Repository layer')).toHaveClass('is-resolved')
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
    })

    it('does not flash a snapshot that arrives on reconnect', () => {
      const { update } = renderNav(snap())
      update(snap(), 't_1', false) // the stream dropped
      update(snap({ t_1: 'resolved' }), 't_1', true) // the reconnect snapshot and 'open' arrive together
      expect(row('Repository layer')).toHaveClass('is-resolved')
      expect(row('Repository layer')).not.toHaveClass('is-just-resolved')
      update(snap({ t_1: 'resolved', t_2: 'resolved' })) // live again: the next resolve flashes
      expect(row('Cache strategy')).toHaveClass('is-just-resolved')
    })
  })
})

describe('TopBar', () => {
  const bar = (over = {}, connection: 'open' | 'connecting' | 'lost' = 'open') =>
    renderWithCtx(<TopBar connection={connection} onExport={vi.fn()} onEnd={vi.fn()} />, makeCtx(over))

  it('shows the AI status (Review Focus 3)', () => {
    bar({ waiting: true })
    expect(screen.getByText('AI is waiting for you')).toBeInTheDocument()
    bar({ waiting: false })
    expect(screen.getByText('AI is working…')).toBeInTheDocument()
    bar({}, 'connecting')
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    bar({}, 'lost')
    expect(screen.getByText('Disconnected — run tdm open')).toBeInTheDocument()
  })

  it('gives each AI status its own dot styling (F12b-3)', () => {
    const { container: waiting } = bar({ waiting: true })
    expect(waiting.querySelector('.dot.is-waiting')).toBeInTheDocument()

    const { container: working } = bar({ waiting: false })
    expect(working.querySelector('.dot.is-working')).toBeInTheDocument()
    expect(working.querySelectorAll('.dot.is-working i')).toHaveLength(3)

    const { container: reconnecting } = bar({}, 'connecting')
    expect(reconnecting.querySelector('.dot.is-reconnecting')).toBeInTheDocument()

    const { container: lost } = bar({}, 'lost')
    expect(lost.querySelector('.dot.is-lost')).toBeInTheDocument()

    const closedCtx = makeCtx({ readOnly: true })
    const { container: closed } = renderWithCtx(<TopBar connection="open" onExport={vi.fn()} onEnd={vi.fn()} />, closedCtx)
    expect(closed.querySelector('.dot')).toBeNull()
  })

  it('shows "AI not connected" once the agent has been quiet (feature review t_6)', () => {
    const { container } = bar({ waiting: false, quietMinutes: 12 })
    expect(screen.getByText('AI not connected')).toBeInTheDocument()
    expect(screen.queryByText('AI is working…')).toBeNull()
    expect(container.querySelector('.dot.is-quiet')).toBeInTheDocument()
  })

  it('sends the draft with Send to AI', async () => {
    const { ctx } = bar({ draft: draft2 })
    await userEvent.click(screen.getByRole('button', { name: 'Send to AI · 2' }))
    expect(ctx.sendReview).toHaveBeenCalledWith()
  })

  it('disables sending without a draft and hides actions when closed', () => {
    bar()
    expect(screen.getByRole('button', { name: 'Send to AI · 0' })).toBeDisabled()
    const closed = makeCtx({ readOnly: true })
    renderWithCtx(<TopBar connection="open" onExport={vi.fn()} onEnd={vi.fn()} />, closed)
    expect(screen.getByText('Session closed')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /End session/ })).toHaveLength(1) // only the first render has it
  })

  it('pops the Send to AI count when it changes, not on load (UI polish)', () => {
    const ctx = makeCtx()
    const top = (c: SessionCtx) => (
      <SessionContext.Provider value={c}>
        <TopBar connection="open" onExport={vi.fn()} onEnd={vi.fn()} />
      </SessionContext.Provider>
    )
    const { rerender } = render(top(ctx))
    const button = () => screen.getByRole('button', { name: /^Send to AI/ })
    expect(button().querySelector('.count-pop')).toBeNull()
    rerender(top({ ...ctx, draft: draft2 }))
    expect(button()).toHaveAccessibleName('Send to AI · 2')
    const count = button().querySelector('.count-pop')
    expect(count).toHaveTextContent('2')
  })

  // F4 (Review Focus 3, amended): a restarted daemon listens on a new port with a new token, so
  // the page cannot reconnect on its own. After ~10s stuck 'connecting', add a hint to run `tdm open`.
  it('suggests tdm open once reconnecting is stuck for a while (F4)', () => {
    vi.useFakeTimers()
    try {
      bar({}, 'connecting')
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
      expect(screen.queryByText(/If the daemon restarted/)).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(10000))
      expect(screen.getByText(/If the daemon restarted, run tdm open\./)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SessionList', () => {
  it('groups sessions by project', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 's_1', title: 'Idea', status: 'active', projectName: 'demo', active: true },
      { id: 's_2', title: 'Old', status: 'closed', projectName: 'demo', active: false },
    ]), { status: 200 })))
    render(<SessionList />)
    expect(await screen.findByRole('heading', { name: 'demo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Idea' })).toHaveAttribute('href', '/s/s_1')
    expect(screen.getByText('closed')).toBeInTheDocument()
    // F11: the active session's row shows only the "active" chip — not the status text too.
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.queryByText('active', { selector: '.muted' })).not.toBeInTheDocument()
  })

  it('explains a missing token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"unauthorized","message":"missing"}}', { status: 401 })))
    render(<SessionList />)
    expect(await screen.findByText('Open a session with tdm open first — this page needs its token.')).toBeInTheDocument()
  })

  it('shows the theme button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    render(<SessionList />)
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })
})
