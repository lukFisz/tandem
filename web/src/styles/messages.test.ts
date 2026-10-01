import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('user message header links (demo 6 follow-ups 1)', () => {
  it('cut a long question with an ellipsis, like a chip', () => {
    const rule = appCss.match(/\.msg-ref\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    for (const decl of ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap', 'max-width: 16rem'])
      expect(rule![1]).toContain(decl)
  })
})

describe('undelivered user messages (demo 6 follow-ups 2)', () => {
  it('are muted with a dashed border, without shifting the layout when they switch', () => {
    const rule = appCss.match(/\.msg-user\.is-undelivered\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('border-style: dashed')
    expect(rule![1]).toContain('color: var(--muted)')
    // The normal bubble keeps a transparent 1px border, so the dashed one takes no extra room.
    expect(appCss).toMatch(/\.msg-user\s*{[^}]*border: 1px solid transparent/)
  })
})
