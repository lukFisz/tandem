import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')
const themeCss = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')

describe('id chips (demo2 follow-up 4)', () => {
  it('truncate long titles with an ellipsis, on their own background', () => {
    const rule = appCss.match(/\.id-chip\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    for (const decl of ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap', 'max-width:', 'background: var(--chip-bg)'])
      expect(rule![1]).toContain(decl)
  })

  it('define the chip colors for light and dark themes', () => {
    // 3: the base :root (light), the prefers-color-scheme dark block (System), and the mirrored
    // :root[data-theme="dark"] block the theme button uses for an explicit Dark under a light OS.
    expect(themeCss.match(/--chip-bg:/g)).toHaveLength(3)
    expect(themeCss.match(/--chip-fg:/g)).toHaveLength(3)
  })
})
