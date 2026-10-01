import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('proposal card (stage summary flow spec, part D)', () => {
  it('pulses the Updated pill once, and keeps it still under reduced motion', () => {
    expect(appCss).toMatch(/\.proposal-updated\s*{[^}]*animation:\s*tdm-updated-pulse\s[^;]*\s1;/)
    expect(appCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.proposal-updated\s*{\s*animation:\s*none;?\s*}/)
  })

  // Demo 7 follow-ups 1: the preview is a flex row; only its sentence is clipped, and the "(...)"
  // marker after it never shrinks.
  it('clips the collapsed preview sentence to one line and keeps the "(...)" marker visible', () => {
    expect(appCss).toMatch(/\.proposal-preview\s*{[^}]*display:\s*flex/)
    const text = appCss.match(/\.proposal-preview-text\s*{([^}]*)}/)
    expect(text).not.toBeNull()
    for (const decl of [/min-width:\s*0/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) expect(text![1]).toMatch(decl)
    expect(appCss).toMatch(/\.proposal-preview-more\s*{[^}]*flex:\s*none/)
  })
})
