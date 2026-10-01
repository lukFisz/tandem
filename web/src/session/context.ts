import { createContext, useContext } from 'react'
import { ApiError } from '../api/client'
import type { Action, LineRange, State } from '../api/types'
import type { Draft, NewDraftComment } from '../draft/draft'

export interface Selection {
  blockId: string
  lines: LineRange
  editing: boolean
}

export interface Notice {
  kind: 'error' | 'info'
  text: string
  hint?: string
}

export function noticeFromError(e: unknown): Notice {
  if (e instanceof ApiError) return { kind: 'error', text: `${e.code}: ${e.message}`, hint: e.hint }
  return { kind: 'error', text: e instanceof Error ? e.message : String(e), hint: 'Is the tdm daemon running? Try `tdm open`.' }
}

export interface SessionCtx {
  sid: string
  state: State
  waiting: boolean
  /** Process id -> last up-to-3 output lines (see Snapshot.processOutput). */
  processOutput: Record<string, string>
  /** Whole minutes the agent has been silent (no CLI call, no tdm wait), or null — see session/agent.ts. */
  quietMinutes: number | null
  readOnly: boolean
  draft: Draft
  addDraft(c: NewDraftComment): void
  updateDraft(id: string, text: string): void
  removeDraft(id: string): void
  selection: Selection | null
  setSelection(s: Selection | null): void
  /** The block shown in the large block modal (BlockModal), or null. */
  expandedBlock: string | null
  expandBlock(id: string | null): void
  /** Sends an action with the current draft attached; resolves true on success. */
  run(action: Action): Promise<boolean>
  /** Sends the draft (plus an optional thread message) as review.submit; resolves true on success. */
  sendReview(extra?: { threadId: string; message: string }): Promise<boolean>
  loadBlob(sha: string): Promise<string>
  openPath(path: string, line?: number): Promise<string | null>
}

export const SessionContext = createContext<SessionCtx | null>(null)

export function useSessionCtx(): SessionCtx {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSessionCtx must be used inside SessionContext')
  return ctx
}
