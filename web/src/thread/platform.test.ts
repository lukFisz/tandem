import { afterEach, describe, expect, it, vi } from 'vitest'
import { modKeyLabel } from './platform'

afterEach(() => vi.unstubAllGlobals())

describe('modKeyLabel', () => {
  it('shows ⌘↵ on macOS', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' })
    expect(modKeyLabel()).toBe('⌘↵')
  })

  it('shows Ctrl↵ on Windows', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT 10.0' })
    expect(modKeyLabel()).toBe('Ctrl↵')
  })

  it('shows Ctrl↵ on Linux', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' })
    expect(modKeyLabel()).toBe('Ctrl↵')
  })
})
