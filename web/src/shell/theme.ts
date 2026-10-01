import { useCallback, useState } from 'react'

// Theme button (Demo 7 "Style button"): a single cycling control in the top bar and on the
// all-sessions page. Default is System, which follows prefers-color-scheme exactly as before;
// Light and Dark persist per browser under STORAGE_KEY. Every storage access is wrapped in
// try/catch — a blocked or unreadable store just falls back to System.
export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'tdm.theme'

// nextTheme is the click order: System -> Light -> Dark -> System.
export function nextTheme(mode: ThemeMode): ThemeMode {
  if (mode === 'system') return 'light'
  if (mode === 'light') return 'dark'
  return 'system'
}

// readTheme reads the persisted choice. Anything other than exactly "light" or "dark" — no key,
// an unrecognized value, or a store that throws — means System.
export function readTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

// applyTheme sets the document attribute the CSS keys off (index.html's inline script sets the
// same attribute before first paint) and persists the choice. System removes both.
export function applyTheme(mode: ThemeMode): void {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode
  else delete document.documentElement.dataset.theme
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage blocked: the mode still applies for this page load via the dataset attribute above.
  }
}

// themeLabel is the button's accessible name and tooltip; themeIcon is what it shows. The icons
// are monochrome text glyphs (not colour emoji) so they take the button's colour in both themes;
// U+FE0E asks for the text form of ☀, which some fonts would otherwise draw as an emoji.
export function themeLabel(mode: ThemeMode): string {
  return `Theme: ${mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}`
}

export function themeIcon(mode: ThemeMode): string {
  return mode === 'system' ? '◐' : mode === 'light' ? '☀︎' : '☾'
}

// useTheme reads the persisted mode once (index.html's inline script already applied it before
// React mounted, so no effect is needed to sync first paint) and exposes a cycle callback that
// both updates state and calls applyTheme. No useLayoutEffect: the inline script owns first
// paint, and every later change is a plain user click.
export function useTheme(): [ThemeMode, () => void, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(readTheme)
  const cycle = useCallback(() => {
    setMode((m) => {
      const next = nextTheme(m)
      applyTheme(next)
      return next
    })
  }, [])
  const set = useCallback((m: ThemeMode) => {
    applyTheme(m)
    setMode(m)
  }, [])
  return [mode, cycle, set]
}
