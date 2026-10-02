import { afterEach, describe, expect, it } from 'vitest'
import { authHeaders, authToken, captureToken, withToken } from './auth'

afterEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('page token', () => {
  it('takes the token from the URL, stores it and strips it from the address bar', () => {
    window.history.replaceState(null, '', '/s/s_1?token=abc&x=1#t_2')
    captureToken()
    expect(authToken()).toBe('abc')
    expect(localStorage.getItem('tdm.token')).toBe('abc')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/s/s_1?x=1#t_2')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer abc' })
    expect(withToken('/api/sessions/s_1/stream')).toBe('/api/sessions/s_1/stream?token=abc')
  })

  it('falls back to the stored token on a link without one', () => {
    localStorage.setItem('tdm.token', 'stored')
    window.history.replaceState(null, '', '/s/s_1')
    captureToken()
    expect(authToken()).toBe('stored')
  })

  it('sends no Authorization header without a token (the dev proxy adds one)', () => {
    window.history.replaceState(null, '', '/')
    captureToken()
    expect(authHeaders()).toEqual({})
    expect(withToken('/api/x')).toBe('/api/x')
  })
})
