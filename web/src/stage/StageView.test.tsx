import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeCtx, renderStateful, withStageQuestion } from '../test/session'
import type { SessionCtx } from '../session/context'
import type { Message } from '../api/types'
import { StageView } from './StageView'
import { CollapseStoreProvider, type CollapseStore } from '../proposal/useProposalCollapse'

describe('StageView', () => {
  it('lists threads and explains when the summary comes', () => {
    renderStateful(<StageView stageId="st_1" />)
    expect(screen.getByText('Stage 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Data model' })).toBeInTheDocument()
    expect(screen.getByText('Goal: Pick the storage layer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '◆ Cache strategy' })).toHaveAttribute('href', '#t_2')
    expect(screen.getByText('The AI proposes a stage summary once every thread is resolved (0/3).')).toBeInTheDocument()
  })

  it('accepts a proposed summary, and offers no Request changes (part E)', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveTextContent('We keep a JSONL log.')
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.accept', data: { stageId: 'st_1' } })
  })

  it('shows an accepted summary', () => {
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'Done: JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.getByText('Stage summary')).toBeInTheDocument()
    expect(screen.getByText('Done: JSONL log.')).toBeInTheDocument()
  })

  it('keeps the composer text per stage when switching stages', async () => {
    const user = userEvent.setup()
    const { rerender } = renderStateful(<StageView stageId="st_1" />)
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'About the data model')
    rerender(<StageView stageId="st_2" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
    rerender(<StageView stageId="st_1" />)
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('About the data model')
  })

  it('says all threads are resolved while a summary is not proposed yet', () => {
    const base = makeCtx()
    base.state.threads.t_1 = { ...base.state.threads.t_1, status: 'resolved' }
    base.state.threads.t_2 = { ...base.state.threads.t_2, status: 'resolved' }
    base.state.threads.t_3 = { ...base.state.threads.t_3, status: 'resolved' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.getByText("All threads resolved — waiting for the AI's stage summary.")).toBeInTheDocument()
  })

  // Stage summary flow, part C: Edit → Save replaces the proposal; Accept summary is a separate click.
  it('saves an edited summary without accepting it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.queryByText('edited by you')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit summary' })
    expect(box).toHaveValue('We keep a JSONL log.')
    expect(screen.queryByRole('button', { name: 'Accept summary' })).toBeNull()
    await user.clear(box)
    await user.type(box, 'We keep a JSONL log and content-addressed blobs.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenLastCalledWith({
      type: 'stage.revise',
      data: { stageId: 'st_1', text: 'We keep a JSONL log and content-addressed blobs.', baseVersion: 0 },
    })
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
  })

  it('marks a summary the user saved, and Accept summary accepts it as it stands', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'Mine.', editedByUser: true }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const region = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(region).getByText('edited by you')).toHaveClass('edited-by-you')
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.accept', data: { stageId: 'st_1' } })
  })

  it('closes the summary editor without sending when the text is unchanged', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), '\n')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
  })

  it('sends a single summary Save while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, run })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), ' And blobs.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish(true))
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
  })

  it('keeps the editor open when saving fails, and cancels back to the proposal', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, run: vi.fn(async () => false) })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), ' And blobs.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('textbox', { name: 'Edit summary' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveTextContent('We keep a JSONL log.')
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
  })

  it('offers no summary actions on a read-only session', () => {
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, readOnly: true })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept summary' })).toBeNull()
  })

  // Controller ruling: an accept must never record a stale original. If the AI re-proposes
  // while the Edit editor is open, the editor closes and the new proposal is shown.
  it('closes the Edit editor and shows the new proposal when the proposed summary changes underneath it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const { rerender } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Edit summary' })).toBeInTheDocument()

    // The AI re-proposes: the fixture's state object is mutated in place (as the real ctx does
    // on a new snapshot) and the component re-rendered with the same stageId, so `mode` state
    // would otherwise survive.
    base.state.stages[0] = { ...base.state.stages[0], proposedSummary: 'We keep a JSONL log and content-addressed blobs.' }
    rerender(<StageView stageId="st_1" />)

    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveTextContent(
      'We keep a JSONL log and content-addressed blobs.',
    )
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
  })

  it('closes the summary editor when the AI re-proposes the same text underneath it', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    const text = 'We keep a JSONL log.'
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: text, proposalVersion: 1, proposals: [{ text, seq: 30 }] }
    const { rerender } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // Same text, new version: a Save against v1 would be rejected, so the editor closes on v2.
    base.state.stages[0] = { ...base.state.stages[0], proposalVersion: 2, proposals: [{ text, seq: 30 }, { text, seq: 33 }] }
    rerender(<StageView stageId="st_1" />)
    expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
  })

  it('sends the proposal version the editor opened on, even when the AI re-proposes while Save is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx()
    const text = 'We keep a JSONL log.'
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: text, proposalVersion: 1, proposals: [{ text, seq: 30 }] }
    const { rerender } = renderStateful(<StageView stageId="st_1" />, { state: base.state, run })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit summary' }), ' Blobs by hash.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    base.state.stages[0] = { ...base.state.stages[0], proposedSummary: 'We keep a JSONL log, v2.', proposalVersion: 2 }
    rerender(<StageView stageId="st_1" />)
    await act(async () => finish(false))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith({
      type: 'stage.revise',
      data: { stageId: 'st_1', text: 'We keep a JSONL log. Blobs by hash.', baseVersion: 1 },
    })
  })

  it('shows ids in the goal, thread conclusions and the summary as chips (demo2 follow-up 4)', async () => {
    const user = userEvent.setup()
    const base = makeCtx()
    base.state.threads.t_1 = { ...base.state.threads.t_1, status: 'resolved', conclusion: 'Same as t_2.' }
    base.state.stages[0] = {
      ...base.state.stages[0],
      goal: 'Settle t_3 first',
      status: 'summary_proposed',
      proposedSummary: 'Covers t_1 and `t_2`.',
    }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const summary = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(summary).getByRole('link', { name: 'Repository layer' })).toHaveAttribute('title', 'id: t_1')
    expect(within(summary).queryByRole('link', { name: 'Cache strategy' })).toBeNull() // inside `code`
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '#t_3') // the goal
    await user.click(screen.getByRole('button', { name: /^Threads \(1\/3 resolved\)/ }))
    expect(screen.getByRole('link', { name: 'Cache strategy' })).toHaveAttribute('title', 'id: t_2') // t_1's conclusion
  })

  it('renders thread conclusions as markdown, keeping id chips', () => {
    const base = makeCtx()
    base.state.threads.t_1 = {
      ...base.state.threads.t_1,
      status: 'resolved',
      conclusion: 'Keep **v0** logs, see t_2.\n\n1. `tdm wait` first\n2. then export',
    }
    const { container } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const concl = container.querySelector('.stage-concl') as HTMLElement
    expect(within(concl).getByText('v0').tagName).toBe('STRONG')
    expect(within(concl).getAllByRole('listitem')).toHaveLength(2)
    expect(within(concl).getByText('tdm wait').tagName).toBe('CODE')
    expect(concl).not.toHaveTextContent('**')
    expect(within(concl).getByRole('link', { name: 'Cache strategy' })).toHaveAttribute('title', 'id: t_2')
  })

  it('puts the status icon in its own slot and the conclusion in the same row as its title', () => {
    const base = makeCtx()
    base.state.threads.t_1 = { ...base.state.threads.t_1, status: 'resolved', conclusion: 'Done.' }
    const { container } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const title = screen.getByRole('link', { name: '✓ Repository layer' })
    expect(title.querySelector('.stage-thread-icon')).toHaveTextContent('✓')
    const row = title.closest('li') as HTMLElement
    expect(row.querySelector('.stage-concl')).toHaveTextContent('Done.')
    expect(container.querySelectorAll('.stage-threads > li')).toHaveLength(base.state.stages[0].threadIds.length)
  })

  // Stage summary flow, part A: one stage.accept per click. The summary's buttons are disabled
  // while it is in flight, and a failure re-enables them.
  it('sends a single Accept summary while one is in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state, run })
    const accept = screen.getByRole('button', { name: 'Accept summary' })
    await user.click(accept)
    expect(accept).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    fireEvent.click(accept)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith({ type: 'stage.accept', data: { stageId: 'st_1' } })
    await act(async () => finish(false))
    expect(screen.getByRole('button', { name: 'Accept summary' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  })
})

describe('StageView waiting for the stage summary (demo2 follow-up 5)', () => {
  const PENDING = "All threads resolved — waiting for the AI's stage summary."
  function allResolved(over: Partial<SessionCtx> = {}) {
    const base = makeCtx(over)
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    return base
  }

  it('animates like the typing bubble while the AI works on it', () => {
    const { container } = renderStateful(<StageView stageId="st_1" />, allResolved())
    expect(screen.getByRole('status', { name: PENDING })).toHaveTextContent(PENDING)
    // The same writing indicator as the thread's bubble, so the same reduced-motion rule applies.
    expect(container.querySelector('span.typing-diamond i')).toBeInTheDocument()
  })

  it('stays still while the agent is idle in tdm wait, and on a read-only session', () => {
    const first = renderStateful(<StageView stageId="st_1" />, allResolved({ waiting: true }))
    expect(screen.getByText(PENDING)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(first.container.querySelector('.typing-diamond')).toBeNull()
    first.unmount()

    const second = renderStateful(<StageView stageId="st_1" />, allResolved({ readOnly: true }))
    expect(screen.getByText(PENDING)).toBeInTheDocument()
    expect(second.container.querySelector('.typing-diamond')).toBeNull()
  })

  it('says the AI went quiet after 10 minutes, without animation', () => {
    const { container } = renderStateful(<StageView stageId="st_1" />, allResolved({ quietMinutes: 12 }))
    expect(screen.getByRole('status')).toHaveTextContent(`${PENDING} AI quiet for 12m, it may have stopped`)
    expect(container.querySelector('.typing-diamond')).toBeNull()
  })

  it('marks the proposed summary as the landing target (demo2 follow-up 6)', () => {
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    expect(screen.getByRole('region', { name: 'Proposed stage summary' })).toHaveAttribute('data-land', 'proposed-summary')
  })
})

describe('StageView after Accept summary (stage summary flow, part B)', () => {
  const NEXT_PENDING = "Summary accepted — waiting for the AI's next step…"
  const NOTHING_MORE = 'The AI has nothing more planned. Message it, or end the session.'
  // st_1 accepted. With last (the default), st_2 is dropped, so st_1 is the session's last stage.
  function accepted(over: Partial<SessionCtx> = {}, { last = true } = {}) {
    const base = makeCtx(over)
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.' }
    if (last) base.state.stages.pop()
    return base
  }

  it('waits for the AI with a typing bubble and offers End session on the last stage', async () => {
    const user = userEvent.setup()
    const onEnd = vi.fn()
    const { container } = renderStateful(<StageView stageId="st_1" onEnd={onEnd} />, accepted())
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByRole('status', { name: NEXT_PENDING })).toHaveTextContent(NEXT_PENDING)
    expect(container.querySelector('.typing-diamond')).toBeInTheDocument()
    await user.click(within(box).getByRole('button', { name: 'End session' }))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('goes still when the agent is back in tdm wait with nothing planned', () => {
    const { container } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, accepted({ waiting: true }))
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByText(NOTHING_MORE)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('.typing-diamond')).toBeNull()
    expect(within(box).getByRole('button', { name: 'End session' })).toBeInTheDocument()
  })

  // Demo 7 follow-ups 6: an open stage question is the AI's next step, so the page neither says
  // the AI has nothing more planned nor waits on it; End session stays.
  it('shows neither "nothing more planned" nor the waiting bubble while a stage question is open', () => {
    for (const waiting of [true, false]) {
      const base = accepted({ waiting })
      const { unmount } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, { ...base, state: withStageQuestion(base.state) })
      const box = screen.getByRole('region', { name: 'Stage summary' })
      expect(screen.queryByText(NOTHING_MORE)).toBeNull()
      expect(screen.queryByRole('status', { name: NEXT_PENDING })).toBeNull()
      expect(within(box).getByRole('button', { name: 'End session' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Question' })).toBeInTheDocument()
      unmount()
    }
    // Once answered, the stage is back to its usual end state.
    const base = accepted({ waiting: true })
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, { ...base, state: withStageQuestion(base.state, { answer: { optionId: 'o_7' } }) })
    expect(screen.getByText(NOTHING_MORE)).toBeInTheDocument()
  })

  it('says the AI went quiet after 10 minutes', () => {
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, accepted({ quietMinutes: 12 }))
    expect(screen.getByRole('status')).toHaveTextContent(`${NEXT_PENDING} AI quiet for 12m, it may have stopped`)
  })

  it('keeps the bubble moving after an accept until the agent has picked it up', async () => {
    const user = userEvent.setup()
    const base = accepted({ waiting: true })
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', summary: undefined, proposedSummary: 'We keep a JSONL log.' }
    // Explicit seqs, so the test does not depend on the fixture's lastSeq (Task 8 changes it).
    base.state.lastSeq = 40
    base.state.delivered = 40
    const { rerender } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    await user.click(screen.getByRole('button', { name: 'Accept summary' })) // state.lastSeq is 40 at the click
    // The accepted snapshot arrives while the agent's tdm wait is still delivering the accept.
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.', proposedSummary: undefined }
    rerender(<StageView stageId="st_1" onEnd={vi.fn()} />)
    expect(screen.getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    // tdm wait delivered the accept (seq 41) and the agent is back in tdm wait.
    base.state.delivered = 41
    rerender(<StageView stageId="st_1" onEnd={vi.fn()} />)
    expect(screen.getByText(NOTHING_MORE)).toBeInTheDocument()
  })

  // Accepted-stage follow-up: the accepted box keeps its place in time. Without acceptedSeq (older
  // snapshots) it falls back to the last proposal's seq: what came up to it above the box, messages since below it, then the reply bubble
  // and the composer. (It used to follow the whole conversation, so the reply bubble sat below the
  // box while the messages it answered sat above it.)
  it('keeps the accepted summary box in time order, later messages and the reply bubble below it', () => {
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    const base = accepted()
    base.state.stages[0] = {
      ...base.state.stages[0],
      proposalVersion: 2,
      proposals: [{ text: 'A JSONL log.', seq: 20 }, { text: 'We keep a JSONL log.', seq: 24 }],
      messages: [
        { actor: 'user', text: 'Before the accept.', seq: 22 },
        { actor: 'ai', text: 'Nothing more from me.', seq: 27 },
      ],
      lastAiSeq: 27,
    }
    const first = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    let box = screen.getByRole('region', { name: 'Stage summary' })
    const v1 = screen.getByText('Proposed stage summary · v1')
    for (const earlier of [v1, screen.getByText('Before the accept.')]) {
      expect(earlier.compareDocumentPosition(box) & FOLLOWING).toBeTruthy()
    }
    expect(box.compareDocumentPosition(screen.getByText('Nothing more from me.')) & FOLLOWING).toBeTruthy()
    expect(within(box).getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(box.compareDocumentPosition(within(box).getByRole('button', { name: 'End session' })) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy()
    expect(screen.getByText('Nothing more from me.').compareDocumentPosition(screen.getByRole('textbox', { name: 'Reply' })) & FOLLOWING).toBeTruthy()
    first.unmount()

    // The user asks something after the AI's wrap-up; the AI is replying.
    base.state.stages[0] = {
      ...base.state.stages[0],
      messages: [...(base.state.stages[0].messages ?? []), { actor: 'user', text: 'Anything else?', seq: 28 }],
      lastUserSeq: 28,
    }
    base.state.delivered = 28
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    box = screen.getByRole('region', { name: 'Stage summary' })
    const bubble = screen.getByRole('status', { name: 'AI is replying' })
    expect(screen.getByText('Before the accept.').compareDocumentPosition(box) & FOLLOWING).toBeTruthy()
    expect(box.compareDocumentPosition(screen.getByText('Nothing more from me.')) & FOLLOWING).toBeTruthy()
    expect(screen.getByText('Nothing more from me.').compareDocumentPosition(screen.getByText('Anything else?')) & FOLLOWING).toBeTruthy()
    expect(screen.getByText('Anything else?').compareDocumentPosition(bubble) & FOLLOWING).toBeTruthy()
    expect(bubble.compareDocumentPosition(screen.getByRole('textbox', { name: 'Reply' })) & FOLLOWING).toBeTruthy()
  })

  // Decided by the user in a live demo: the accepted card stays where it was when the user accepted
  // it, not where it was proposed. Messages exchanged between the (last) proposal and the accept stay
  // above the card; only messages after the accept follow it, then the reply bubble, then the composer.
  it('keeps the accepted summary where it was accepted: messages between the proposal and the accept stay above it', () => {
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    const base = accepted()
    base.state.stages[0] = {
      ...base.state.stages[0],
      proposalVersion: 2,
      proposals: [{ text: 'A JSONL log.', seq: 20 }, { text: 'We keep a JSONL log.', seq: 24 }],
      acceptedSeq: 28,
      messages: [
        { actor: 'user', text: 'Before the proposal.', seq: 22 },
        { actor: 'user', text: 'Between proposal and accept.', seq: 25 },
        { actor: 'ai', text: 'Answered before the accept.', seq: 26 },
        { actor: 'user', text: 'After the accept.', seq: 30 },
      ],
      lastAiSeq: 26,
      lastUserSeq: 30,
    }
    base.state.delivered = 30
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    const box = screen.getByRole('region', { name: 'Stage summary' })
    const v1 = screen.getByText('Proposed stage summary · v1')
    for (const earlier of [v1, screen.getByText('Before the proposal.'), screen.getByText('Between proposal and accept.'), screen.getByText('Answered before the accept.')]) {
      expect(earlier.compareDocumentPosition(box) & FOLLOWING).toBeTruthy()
    }
    const after = screen.getByText('After the accept.')
    const bubble = screen.getByRole('status', { name: 'AI is replying' })
    expect(box.compareDocumentPosition(after) & FOLLOWING).toBeTruthy()
    expect(after.compareDocumentPosition(bubble) & FOLLOWING).toBeTruthy()
    expect(bubble.compareDocumentPosition(screen.getByRole('textbox', { name: 'Reply' })) & FOLLOWING).toBeTruthy()
  })

  it("lists the AI's newest version above an edited accepted summary, later messages below it", () => {
    const base = accepted()
    base.state.stages[0] = {
      ...base.state.stages[0],
      summary: 'My edit.',
      proposalVersion: 2,
      proposals: [{ text: 'A JSONL log.', seq: 20 }, { text: 'We keep a JSONL log.', seq: 24 }],
      acceptedSeq: 25,
      messages: [{ actor: 'user', text: 'After the accept.', seq: 26 }],
    }
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    const box = screen.getByRole('region', { name: 'Stage summary' })
    const aiVersion = screen.getByText('Proposed stage summary · v2').closest('details') as HTMLElement
    expect(aiVersion).toHaveTextContent('We keep a JSONL log.')
    expect(aiVersion.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box.compareDocumentPosition(screen.getByText('After the accept.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('collapses the accepted summary after a stage message is sent, and keeps it collapsed across remounts', async () => {
    const user = userEvent.setup()
    const store: CollapseStore = new Map()
    const base = accepted()
    base.state.stages[0] = { ...base.state.stages[0], summary: 'We keep a JSONL log. Blobs by hash.' }
    const view = () => (
      <CollapseStoreProvider store={store}>
        <StageView stageId="st_1" onEnd={vi.fn()} />
      </CollapseStoreProvider>
    )
    const first = renderStateful(view(), { state: base.state })
    let box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Anything else?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(first.ctx.run).toHaveBeenLastCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Anything else?' } })
    expect(within(box).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(box).not.toHaveTextContent('Blobs by hash.')
    expect(within(box).getByRole('button', { name: 'End session' })).toBeInTheDocument()
    first.unmount()

    renderStateful(view(), { state: base.state })
    box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    // A second send never expands it.
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'And?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(within(box).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
  })

  // Demo 7 follow-ups 5: only the summary text collapses; what comes next stays in the box.
  it('lets the accepted summary collapse, keeping the waiting bubble and End session visible', async () => {
    const user = userEvent.setup()
    const base = accepted()
    base.state.stages[0] = { ...base.state.stages[0], summary: 'We keep a JSONL log. Blobs by hash.' }
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, base)
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).queryByRole('button', { name: /^(Accept summary|Edit)$/ })).toBeNull()
    await user.click(within(box).getByRole('button', { name: 'Collapse' }))
    expect(within(box).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(box.querySelector('.proposal-preview-text')).toHaveTextContent(/^We keep a JSONL log\.$/)
    expect(box).not.toHaveTextContent('Blobs by hash.')
    expect(within(box).getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: 'End session' })).toBeInTheDocument()
  })

  it('keeps a summary collapsed while proposed collapsed once it is accepted, with the Next link below', async () => {
    const user = userEvent.setup()
    const base = accepted({}, { last: false })
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', summary: undefined, proposedSummary: 'We keep a JSONL log.', proposalVersion: 1 }
    const { rerender } = renderStateful(<StageView stageId="st_1" />, base)
    await user.click(within(screen.getByRole('region', { name: 'Proposed stage summary' })).getByRole('button', { name: 'Collapse' }))
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.', proposedSummary: undefined }
    rerender(<StageView stageId="st_1" />)
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(box).getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    expect(within(box).queryByText('Updated')).toBeNull()
    expect(within(box).getByRole('link', { name: 'API' })).toHaveAttribute('href', '#st_2')
  })

  it('links the next stage, with no bubble and no End session, once one exists', () => {
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, accepted({}, { last: false }))
    const box = screen.getByRole('region', { name: 'Stage summary' })
    expect(box).toHaveTextContent('Next: API →')
    expect(within(box).getByRole('link', { name: 'API' })).toHaveAttribute('href', '#st_2')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })

  it('shows neither the bubble nor End session on a closed session, and no End session once the end is requested', () => {
    const closed = accepted({ readOnly: true })
    closed.state.session = { ...closed.state.session, status: 'closed' }
    const first = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, closed)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
    first.unmount()

    const ending = accepted()
    ending.state.endRequested = true
    renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, ending)
    expect(screen.getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })

  it('calls onAccepted once Accept summary succeeds, not when it fails', async () => {
    const user = userEvent.setup()
    const onAccepted = vi.fn()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    const ok = renderStateful(<StageView stageId="st_1" onAccepted={onAccepted} />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(onAccepted).toHaveBeenCalledTimes(1)
    ok.unmount()

    renderStateful(<StageView stageId="st_1" onAccepted={onAccepted} />, { state: base.state, run: vi.fn(async () => false) })
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })

  // Fix round 1 (Important): the server notifies its SSE subscribers before the POST handler
  // that made the change responds, so the 'accepted' snapshot can reach the browser before this
  // page's own `run` call resolves. acceptedAfter must therefore be recorded before the await,
  // not after, or the still text flashes during that window.
  it('keeps showing the bubble, not "nothing more planned", if the accepted snapshot arrives before the accept call resolves', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx({ waiting: true })
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    base.state.stages.pop() // st_1 is the last stage
    base.state.lastSeq = 40
    base.state.delivered = 40
    const { rerender } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, { ...base, run })
    await user.click(screen.getByRole('button', { name: 'Accept summary' })) // state.lastSeq is 40 at the click
    // The SSE snapshot with status 'accepted' arrives while the POST above is still pending.
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.', proposedSummary: undefined }
    rerender(<StageView stageId="st_1" onEnd={vi.fn()} />)
    expect(screen.getByRole('status', { name: NEXT_PENDING })).toBeInTheDocument()
    expect(screen.queryByText(NOTHING_MORE)).toBeNull()
    await act(async () => finish(true))
  })

  it('restores the previous gate when an accept fails, instead of leaving it stuck at the failed attempt', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const base = makeCtx({ waiting: true })
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    base.state.stages[0] = { ...base.state.stages[0], status: 'summary_proposed', proposedSummary: 'We keep a JSONL log.' }
    base.state.stages.pop() // st_1 is the last stage
    base.state.lastSeq = 40
    base.state.delivered = 40
    const { rerender } = renderStateful(<StageView stageId="st_1" onEnd={vi.fn()} />, { ...base, run })
    await user.click(screen.getByRole('button', { name: 'Accept summary' }))
    await act(async () => finish(false)) // the accept fails: acceptedAfter must revert to its previous value (null)
    // A later snapshot shows the stage accepted anyway (e.g. accepted from elsewhere). With
    // acceptedAfter correctly reverted to null, `still` depends only on `waiting`.
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'We keep a JSONL log.', proposedSummary: undefined }
    rerender(<StageView stageId="st_1" onEnd={vi.fn()} />)
    expect(screen.getByText(NOTHING_MORE)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('StageView conversation (stage summary flow spec, part E)', () => {
  function withMessages(over: Partial<SessionCtx> = {}) {
    const base = makeCtx(over)
    base.state.stages[0] = {
      ...base.state.stages[0],
      messages: [
        { actor: 'ai', text: 'Three threads cover it.', seq: 30 },
        { actor: 'user', text: 'Add one on auth.', seq: 31 },
      ],
      lastAiSeq: 30,
      lastUserSeq: 31,
    }
    return base
  }

  it('shows the messages in order, with the delivery status under the latest user message', () => {
    const { container } = renderStateful(<StageView stageId="st_1" />, withMessages())
    expect(container.querySelector('.msg-ai')).toHaveTextContent('Three threads cover it.')
    const mine = container.querySelector('.msg-user') as HTMLElement
    expect(mine).toHaveTextContent('Add one on auth.')
    expect(mine).toHaveClass('is-undelivered')
    expect(screen.getByText('Sent · waiting for the AI to pick it up')).toBeInTheDocument()
  })

  it('shows the typing bubble once the message was delivered, not while the agent waits', () => {
    const base = withMessages()
    base.state.delivered = 31
    const first = renderStateful(<StageView stageId="st_1" />, base)
    expect(screen.getByRole('status', { name: 'AI is replying' })).toBeInTheDocument()
    expect(screen.queryByText('Sent · waiting for the AI to pick it up')).toBeNull()
    first.unmount()
    renderStateful(<StageView stageId="st_1" />, { ...base, waiting: true })
    expect(screen.queryByRole('status', { name: 'AI is replying' })).toBeNull()
  })

  it('sends a stage message from the composer, also on an accepted stage', async () => {
    const user = userEvent.setup()
    const onSent = vi.fn()
    const base = makeCtx()
    base.state.stages[0] = { ...base.state.stages[0], status: 'accepted', summary: 'Done: JSONL log.' }
    const { ctx } = renderStateful(<StageView stageId="st_1" onSent={onSent} />, { state: base.state })
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Anything else?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Anything else?' } })
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('has no composer on a read-only session', () => {
    renderStateful(<StageView stageId="st_1" />, { readOnly: true })
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
  })
})

describe('StageView summary card (stage summary flow spec, parts D and E)', () => {
  const V1 = 'We keep a JSONL log. Blobs by hash.'
  function proposed() {
    const base = makeCtx()
    for (const id of ['t_1', 't_2', 't_3']) base.state.threads[id] = { ...base.state.threads[id], status: 'resolved' }
    base.state.stages[0] = {
      ...base.state.stages[0],
      status: 'summary_proposed',
      proposedSummary: V1,
      proposalVersion: 1,
      proposals: [{ text: V1, seq: 30 }],
    }
    return base
  }

  it('collapses the summary after a stage message is sent, keeping Accept summary and Edit', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: proposed().state })
    const card = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(card).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Mention the cache.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ctx.run).toHaveBeenLastCalledWith({ type: 'stage.message', data: { stageId: 'st_1', text: 'Mention the cache.' } })
    expect(within(card).getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    expect(card.querySelector('.proposal-preview-text')).toHaveTextContent(/^We keep a JSONL log\.$/)
    expect(within(card).getByRole('button', { name: 'Accept summary' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(card).toHaveAttribute('data-land', 'proposed-summary')
  })

  it('shows Updated when the AI re-proposes while collapsed, and the earlier summary as v1', async () => {
    const user = userEvent.setup()
    const base = proposed()
    const { rerender } = renderStateful(<StageView stageId="st_1" />, { state: base.state })
    await user.click(screen.getByRole('button', { name: 'Collapse' }))

    const v2 = 'We keep a JSONL log and a lazy cache. Blobs by hash.'
    base.state.stages[0] = { ...base.state.stages[0], proposedSummary: v2, proposalVersion: 2, proposals: [{ text: V1, seq: 30 }, { text: v2, seq: 33 }] }
    rerender(<StageView stageId="st_1" />)
    const card = screen.getByRole('region', { name: 'Proposed stage summary' })
    expect(within(card).getByText('Updated')).toBeInTheDocument()
    expect(within(card).getByText('· v2')).toBeInTheDocument()
    const earlier = screen.getByText('Proposed stage summary · v1').closest('details') as HTMLElement
    expect(earlier).not.toHaveAttribute('open')
    expect(earlier).toHaveTextContent(V1)

    await user.click(within(card).getByRole('button', { name: 'Expand' }))
    expect(within(card).queryByText('Updated')).toBeNull()
  })

  it('folds the thread list into one line once a summary is proposed', async () => {
    const user = userEvent.setup()
    renderStateful(<StageView stageId="st_1" />, { state: proposed().state })
    const toggle = screen.getByRole('button', { name: 'Threads (3/3 resolved) ▸' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '✓ Repository layer' })).toBeNull()
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Threads (3/3 resolved) ▾' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '✓ Repository layer' })).toHaveAttribute('href', '#t_1')
  })

  it('pins the live summary card above the composer, every message (before and after the proposal) and the typing bubble above the card', () => {
    const base = proposed()
    base.state.delivered = 31
    base.state.stages[0] = {
      ...base.state.stages[0],
      messages: [
        { actor: 'user', text: 'Before the summary.', seq: 25 },
        { actor: 'user', text: 'After the summary.', seq: 31 },
      ],
      lastAiSeq: 20,
      lastUserSeq: 31,
    }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Proposed stage summary' })
    const before = screen.getByText('Before the summary.')
    const after = screen.getByText('After the summary.')
    const bubble = screen.getByRole('status', { name: 'AI is replying' })
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(after.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bubble.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.compareDocumentPosition(screen.getByRole('textbox', { name: 'Reply' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("lists the AI's newest version above an edited summary card, later messages also above the pinned card", () => {
    const base = proposed()
    const v2 = 'We keep a JSONL log and a lazy cache. Blobs by hash.'
    base.state.stages[0] = {
      ...base.state.stages[0],
      proposedSummary: 'My edit.',
      editedByUser: true,
      proposalVersion: 2,
      proposals: [{ text: V1, seq: 30 }, { text: v2, seq: 33 }],
      messages: [{ actor: 'user', text: 'After the summary.', seq: 34 }],
    }
    renderStateful(<StageView stageId="st_1" />, { state: base.state })
    const card = screen.getByRole('region', { name: 'Proposed stage summary' })
    const aiVersion = screen.getByText('Proposed stage summary · v2').closest('details') as HTMLElement
    expect(aiVersion).toHaveTextContent(v2)
    expect(aiVersion.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('After the summary.').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the thread list open while the stage is open', () => {
    renderStateful(<StageView stageId="st_1" />)
    expect(screen.queryByRole('button', { name: /^Threads \(/ })).toBeNull()
    expect(screen.getByRole('link', { name: '◆ Cache strategy' })).toBeInTheDocument()
  })
})

describe('StageView questions (demo 7 follow-ups 6)', () => {
  const question = () => screen.getByRole('region', { name: 'Question' })

  it('shows a stage question with its buttons and Other…, and answers with a click', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: withStageQuestion(makeCtx().state) })
    const q = question()
    expect(q).toHaveAttribute('data-question', 'q_3')
    expect(q).toHaveTextContent('Anything else before the next stage?')
    expect(within(q).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yes', 'No', 'Other…'])
    await user.click(within(q).getByRole('button', { name: 'No' }))
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_3', optionId: 'o_8' } })
  })

  it('answers with Other… on an accepted stage too', async () => {
    const user = userEvent.setup()
    const state = withStageQuestion(makeCtx().state, {}, { status: 'accepted', summary: 'Done: JSONL log.' })
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state })
    await user.click(within(question()).getByRole('button', { name: 'Other…' }))
    await user.type(within(question()).getByRole('textbox', { name: 'Your answer' }), ' Stop here {Enter}')
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_3', other: 'Stop here' } })
  })

  it('answers the latest open stage question with keys 1–4 when focus is not in a text field', async () => {
    const user = userEvent.setup()
    const base = withStageQuestion(makeCtx().state)
    const later: Message = { actor: 'ai', text: 'Later?', seq: 41, question: { id: 'q_4', options: [{ id: 'o_9', title: 'A' }, { id: 'o_10', title: 'B' }] } }
    const state = withStageQuestion(makeCtx().state, {}, { messages: [...base.stages[0].messages!, later], lastAiSeq: 41 })
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state })
    expect(screen.getAllByRole('region', { name: 'Question' })).toHaveLength(2)
    await user.keyboard('3') // only two options
    expect(ctx.run).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '1')
    expect(ctx.run).not.toHaveBeenCalled()
    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('2')
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(ctx.run).toHaveBeenCalledWith({ type: 'question.answer', data: { questionId: 'q_4', optionId: 'o_10' } })
  })

  it('shows the answer, and heads the Answered message with a link to its question', () => {
    const base = withStageQuestion(makeCtx().state, { answer: { optionId: 'o_7' } })
    const answered: Message = { actor: 'user', text: 'Answered: Yes', seq: 41, answerTo: 'q_3' }
    const state = withStageQuestion(base, { answer: { optionId: 'o_7' } }, { messages: [...base.stages[0].messages!, answered], lastUserSeq: 41 })
    const { container } = renderStateful(<StageView stageId="st_1" />, { state })
    expect(within(question()).queryAllByRole('button')).toHaveLength(0)
    expect(question()).toHaveTextContent('Answer: Yes')
    const mine = container.querySelector('.msg-user') as HTMLElement
    expect(mine).toHaveTextContent('AnsweredYes')
    expect(within(mine).getByRole('link', { name: 'Anything else before the next stage?' })).toHaveAttribute('href', '#q_3')
  })

  it('shows Not answered and takes no keys in a read-only session', async () => {
    const user = userEvent.setup()
    const { ctx } = renderStateful(<StageView stageId="st_1" />, { state: withStageQuestion(makeCtx().state), readOnly: true })
    expect(question()).toHaveTextContent('Not answered')
    expect(within(question()).queryAllByRole('button')).toHaveLength(0)
    await user.keyboard('1')
    expect(ctx.run).not.toHaveBeenCalled()
  })
})
