import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchBlob, fetchExport, listSessions, postAction } from './client'

function mockFetch(status: number, body: string, contentType = 'application/json') {
  const fn = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': contentType } }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('client', () => {
  it('posts an action with the draft', async () => {
    const fetch = mockFetch(200, '{"id":"t_1"}')
    await postAction('s_1', { type: 'conclusion.accept', data: { threadId: 't_1' } }, { threads: [{ threadId: 't_2', message: 'hi' }] })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions/s_1/actions')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'conclusion.accept',
      data: { threadId: 't_1' },
      draft: { threads: [{ threadId: 't_2', message: 'hi' }] },
    })
  })

  it('turns daemon errors into ApiError with the hint', async () => {
    mockFetch(400, '{"error":{"code":"thread_resolved","message":"thread t_1 is resolved","hint":"add a new thread"}}')
    const err = await postAction('s_1', { type: 'session.end', data: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'thread_resolved', message: 'thread t_1 is resolved', hint: 'add a new thread' })
  })

  it('reports non-JSON failures', async () => {
    mockFetch(502, 'bad gateway', 'text/plain')
    await expect(fetchExport('s_1')).rejects.toMatchObject({ status: 502, code: 'http_error' })
  })

  it('reads blobs, exports and the session list', async () => {
    mockFetch(200, 'class Repo', 'text/plain')
    expect(await fetchBlob('s_1', 'abc')).toBe('class Repo')
    mockFetch(200, '# Idea\n', 'text/markdown')
    expect(await fetchExport('s_1')).toBe('# Idea\n')
    mockFetch(200, '[{"id":"s_1","title":"Idea","status":"active","projectName":"demo","active":true}]')
    expect(await listSessions()).toEqual([{ id: 's_1', title: 'Idea', status: 'active', projectName: 'demo', active: true }])
  })
})
