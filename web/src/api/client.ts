import type { Action, SessionSummary, SubmitReview } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (res.ok) return res
  let body: { code?: string; message?: string; hint?: string } | undefined
  try {
    body = ((await res.json()) as { error?: typeof body }).error
  } catch {
    body = undefined
  }
  throw new ApiError(res.status, body?.code ?? 'http_error', body?.message ?? `HTTP ${res.status}`, body?.hint)
}

export async function postAction(sid: string, action: Action, draft?: SubmitReview): Promise<void> {
  await request(`/api/sessions/${sid}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft ? { ...action, draft } : action),
  })
}

export async function fetchBlob(sid: string, sha: string): Promise<string> {
  return (await request(`/api/sessions/${sid}/blobs/${sha}`)).text()
}

export async function fetchExport(sid: string): Promise<string> {
  return (await request(`/api/sessions/${sid}/render/export`)).text()
}

export async function listSessions(): Promise<SessionSummary[]> {
  return (await request('/api/sessions')).json() as Promise<SessionSummary[]>
}

export interface EditorInfo {
  id: string
  name: string
  installed: boolean
}

export interface Settings {
  editor: string
  editors: EditorInfo[]
}

export async function fetchSettings(): Promise<Settings> {
  return (await request('/api/settings')).json() as Promise<Settings>
}

export async function saveSettings(editor: string): Promise<Settings> {
  return (await request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editor }),
  })).json() as Promise<Settings>
}

export async function openFile(sid: string, path: string, line?: number): Promise<string> {
  const res = await request(`/api/sessions/${sid}/open-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, line: line ?? 0 }),
  })
  return (await res.json()).editor as string
}
