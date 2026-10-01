import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { loadThreadText, saveThreadText, useThreadText } from './threadText'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('thread text (demo2 follow-up 2)', () => {
  it('keeps composer text and the Resolve note per session and thread', () => {
    saveThreadText('composer', 's_a', 't_1', 'reply 1')
    saveThreadText('note', 's_a', 't_1', 'note 1')
    saveThreadText('composer', 's_a', 't_2', 'reply 2')
    expect(loadThreadText('composer', 's_a', 't_1')).toBe('reply 1')
    expect(loadThreadText('note', 's_a', 't_1')).toBe('note 1')
    expect(loadThreadText('composer', 's_a', 't_2')).toBe('reply 2')
    expect(loadThreadText('composer', 's_b', 't_1')).toBe('')
    expect(loadThreadText('note', 's_a', 't_2')).toBe('')
    expect(localStorage.getItem('tdm:composer:s_a:t_1')).toBe('reply 1')
    expect(localStorage.getItem('tdm:note:s_a:t_1')).toBe('note 1')
  })

  it('removes the entry when the text is cleared or blank', () => {
    saveThreadText('composer', 's_a', 't_1', 'reply')
    saveThreadText('composer', 's_a', 't_1', '  \n')
    expect(localStorage.getItem('tdm:composer:s_a:t_1')).toBeNull()
    saveThreadText('note', 's_a', 't_1', 'note')
    saveThreadText('note', 's_a', 't_1', '')
    expect(localStorage.getItem('tdm:note:s_a:t_1')).toBeNull()
  })

  it('restores the text after a remount (a reload)', () => {
    const first = renderHook(() => useThreadText('composer', 's_a', 't_1'))
    act(() => first.result.current[1]('half a thought'))
    first.unmount()
    const second = renderHook(() => useThreadText('composer', 's_a', 't_1'))
    expect(second.result.current[0]).toBe('half a thought')
  })

  // Review Focus 1: storage that throws (private mode, blocked site data, quota) never breaks typing.
  it('falls back to memory when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadThreadText('composer', 's_a', 't_1')).toBe('')
    expect(() => saveThreadText('composer', 's_a', 't_1', 'x')).not.toThrow()
    expect(() => saveThreadText('composer', 's_a', 't_1', '')).not.toThrow()
    const { result } = renderHook(() => useThreadText('composer', 's_a', 't_1'))
    act(() => result.current[1]('still here'))
    expect(result.current[0]).toBe('still here')
  })
})
