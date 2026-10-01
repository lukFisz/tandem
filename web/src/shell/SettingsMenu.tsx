import { useEffect, useRef, useState } from 'react'
import { fetchSettings, saveSettings, type EditorInfo, type Settings } from '../api/client'
import { themeIcon, themeLabel, useTheme, type ThemeMode } from './theme'

const THEMES: ThemeMode[] = ['system', 'light', 'dark']

export function SettingsMenu() {
  const [mode, , setMode] = useTheme()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetchSettings()
      .then(setSettings)
      .catch(() => setSettings({ editor: '', editors: [] }))
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pickEditor = async (id: string) => {
    try {
      setSettings(await saveSettings(id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)) // keep the previous pick
    }
  }

  const editors = settings?.editors ?? []
  const current = settings?.editor ?? ''
  const installed = editors.filter((e) => e.installed)

  return (
    <div className="settings" ref={root}>
      <button
        type="button"
        className="btn theme-btn"
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!open) setError(null)
          setOpen((v) => !v)
        }}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open && (
        <div className="settings-menu" role="menu">
          <div className="settings-kicker">Theme</div>
          <div className="settings-seg" role="group" aria-label="Theme">
            {THEMES.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={m === mode}
                onClick={() => setMode(m)}
              >
                {themeIcon(m)} {themeLabel(m).replace('Theme: ', '')}
              </button>
            ))}
          </div>
          <div className="settings-kicker">Editor</div>
          {installed.length === 0 && (
            <>
              <div className="settings-empty">No editor detected</div>
              <div className="settings-hint">Supported: Cursor, VS Code, Zed, Sublime Text, JetBrains IDEs</div>
            </>
          )}
          {installed.map((e: EditorInfo) => (
            <button
              key={e.id}
              type="button"
              role="menuitemradio"
              aria-checked={e.id === current}
              className={e.id === current ? 'settings-row is-current' : 'settings-row'}
              onClick={() => void pickEditor(e.id)}
            >
              {e.name}
              {e.id === current && (
                <span className="settings-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
          {error && (
            <div className="settings-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
