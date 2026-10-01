import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('nav resolve flash (resolve feedback 2)', () => {
  it('animates the row and the icon with keyframes', () => {
    expect(appCss).toMatch(/\.nav-thread\.is-just-resolved\s*{[^}]*animation:\s*tdm-resolved-flash/)
    expect(appCss).toMatch(/\.nav-thread\.is-just-resolved \.icon\s*{[^}]*animation:\s*tdm-resolved-pop/)
    expect(appCss).toContain('@keyframes tdm-resolved-flash')
    expect(appCss).toContain('@keyframes tdm-resolved-pop')
  })

  it('flashes a background clearly distinct from --ok-bg (invisible against dark --nav-bg) and eases the icon color back', () => {
    const flash = appCss.match(/@keyframes tdm-resolved-flash\s*{([\s\S]*?)\n}/)
    expect(flash).not.toBeNull()
    expect(flash![1]).not.toMatch(/background-color:\s*var\(--ok-bg\)/)
    expect(flash![1]).toMatch(/background-color:\s*color-mix\(in srgb, var\(--ok\)/)
    // The transition must live on the base icon rule (not .is-just-resolved .icon): that class is
    // dropped after JUST_RESOLVED_MS, and a transition only applies to the state transitioned to.
    expect(appCss).toMatch(/\.nav-thread \.icon\s*{[^}]*transition:\s*color/)
    expect(appCss).not.toMatch(/\.nav-thread\.is-just-resolved \.icon\s*{[^}]*transition:/)
  })

  it('switches both animations off under prefers-reduced-motion', () => {
    const blocks = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1])
    const reduced = blocks.join('\n')
    const rule = reduced.match(/\.nav-thread\.is-just-resolved,\s*\.nav-thread\.is-just-resolved \.icon\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('animation: none')
    expect(reduced).toMatch(/\.nav-thread \.icon\s*{\s*transition:\s*none;?\s*}/)
  })
})
