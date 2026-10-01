import { useMemo, useState, type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { normalizeSnapshot, type Message, type MessageQuestion, type Snapshot, type Stage, type State, type Thread } from '../api/types'
import { addComment, emptyDraft, removeComments, updateComment, type Draft } from '../draft/draft'
import { SessionContext, type Selection, type SessionCtx } from '../session/context'
import fixture from './fixtures/snapshot.json'

export const REPO_KT = 'class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n'

export function fixtureSnapshot(): Snapshot {
  return normalizeSnapshot(structuredClone(fixture))
}

export function makeCtx(over: Partial<SessionCtx> = {}): SessionCtx {
  const snap = fixtureSnapshot()
  return {
    sid: 's_fixture',
    state: snap.state,
    waiting: snap.waiting,
    processOutput: {},
    quietMinutes: null,
    readOnly: false,
    draft: emptyDraft,
    addDraft: vi.fn(),
    updateDraft: vi.fn(),
    removeDraft: vi.fn(),
    selection: null,
    setSelection: vi.fn(),
    expandedBlock: null,
    expandBlock: vi.fn(),
    run: vi.fn(async () => true),
    sendReview: vi.fn(async () => true),
    loadBlob: vi.fn(async () => REPO_KT),
    openPath: vi.fn(async () => 'cursor'),
    ...over,
  }
}

// Passed as `wrapper` (not wrapped inline) so that RTL's `rerender` re-applies
// the Provider around the new element instead of replacing it unwrapped.
export function renderWithCtx(ui: ReactNode, ctx: SessionCtx = makeCtx()) {
  const wrapper = ({ children }: { children: ReactNode }) => <SessionContext.Provider value={ctx}>{children}</SessionContext.Provider>
  return { ctx, ...render(ui, { wrapper }) }
}

function Harness({ base, children }: { base: SessionCtx; children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(base.draft)
  const [selection, setSelection] = useState<Selection | null>(base.selection)
  const ctx = useMemo<SessionCtx>(
    () => ({
      ...base,
      draft,
      selection,
      setSelection,
      // These three, and setSelection above, replace the base ctx's vi.fn mocks with real state transitions.
      addDraft: (c) => setDraft((d) => addComment(d, c)),
      updateDraft: (id, text) => setDraft((d) => updateComment(d, id, text)),
      removeDraft: (id) => setDraft((d) => removeComments(d, [id])),
    }),
    [base, draft, selection],
  )
  return <SessionContext.Provider value={ctx}>{children}</SessionContext.Provider>
}

// renderStateful keeps draft and selection in real React state; run/sendReview/loadBlob stay mocks.
// Uses `wrapper` too, so `rerender` keeps rendering inside the same Harness/Provider tree.
export function renderStateful(ui: ReactNode, over: Partial<SessionCtx> = {}) {
  const ctx = makeCtx(over)
  const wrapper = ({ children }: { children: ReactNode }) => <Harness base={ctx}>{children}</Harness>
  return { ctx, ...render(ui, { wrapper }) }
}

// withQuestion returns a copy of state whose t_3 question q_1 ("Should the docs cover the blob
// layout?", o_3 Yes / o_4 No; withdrawn in the fixture) is open again, then applies `over` (an
// answer, withdrawn) to the question and `thread` (status, extra messages) to t_3.
export function withQuestion(state: State, over: Partial<MessageQuestion> = {}, thread: Partial<Thread> = {}): State {
  const t3 = state.threads.t_3
  const [asked, ...rest] = t3.messages
  const question: MessageQuestion = { id: asked.question!.id, options: asked.question!.options, ...over }
  return { ...state, threads: { ...state.threads, t_3: { ...t3, messages: [{ ...asked, question }, ...rest], ...thread } } }
}

// withStageQuestion returns a copy of state whose stage st_1 carries the open question q_3
// ("Anything else before the next stage?", o_7 Yes / o_8 No) asked at seq 40 (demo 7 follow-ups
// 6), then applies `over` (an answer, withdrawn) to the question and `stage` (status, extra
// messages) to st_1.
export function withStageQuestion(state: State, over: Partial<MessageQuestion> = {}, stage: Partial<Stage> = {}): State {
  const question: MessageQuestion = { id: 'q_3', options: [{ id: 'o_7', title: 'Yes' }, { id: 'o_8', title: 'No' }], ...over }
  const asked: Message = { actor: 'ai', text: 'Anything else before the next stage?', seq: 40, question }
  const stages = state.stages.map((s, i) => (i === 0 ? { ...s, messages: [...(s.messages ?? []), asked], lastAiSeq: 40, ...stage } : s))
  return { ...state, stages }
}
