import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, nextTheme, readTheme, themeIcon, themeLabel } from './theme'

afterEach(() => {
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
})

describe('nextTheme', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })
})

describe('readTheme', () => {
  it('returns system with empty storage', () => {
    expect(readTheme()).toBe('system')
  })

  it('returns light or dark from storage', () => {
    localStorage.setItem('tdm.theme', 'light')
    expect(readTheme()).toBe('light')
    localStorage.setItem('tdm.theme', 'dark')
    expect(readTheme()).toBe('dark')
  })

  it('returns system for an unknown stored value', () => {
    localStorage.setItem('tdm.theme', 'sepia')
    expect(readTheme()).toBe('system')
  })

  it('returns system when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readTheme()).toBe('system')
  })
})

describe('applyTheme', () => {
  it('sets data-theme and storage for light and dark', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('tdm.theme')).toBe('light')

    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('tdm.theme')).toBe('dark')
  })

  it('removes data-theme and the storage key for system', () => {
    applyTheme('dark')
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('tdm.theme')).toBeNull()
  })

  it('does not throw when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => applyTheme('light')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('does not throw when removeItem throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => applyTheme('system')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})

describe('themeIcon', () => {
  it('gives each mode its own monochrome glyph', () => {
    expect(themeIcon('system')).toBe('◐')
    expect(themeIcon('light')).toBe('☀︎')
    expect(themeIcon('dark')).toBe('☾')
  })

  it('keeps the spoken label separate from the icon', () => {
    expect(themeLabel('light')).toBe('Theme: Light')
  })
})
