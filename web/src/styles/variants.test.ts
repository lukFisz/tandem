import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('variant choice comment box (feature review t_8)', () => {
  it('has no border', () => {
    const rule = appCss.match(/\.variant-confirm\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).not.toMatch(/border/)
  })
})

describe('chosen variant (quiet choice)', () => {
  const rule = (selector: string) => appCss.match(new RegExp(`(?:^|\\n)${selector}\\s*{([^}]*)}`))?.[1] ?? ''

  it('labels the choice with a small accent check, not a filled pill', () => {
    const label = rule('\\.variant-chosen')
    expect(label).toMatch(/color:\s*var\(--accent\)/)
    expect(label).not.toMatch(/background/)
    expect(label).not.toMatch(/border/)
    expect(appCss).not.toMatch(/\.chip\.is-chosen/)
  })

  it('draws no 1px ring around a chosen card, only the selected one', () => {
    const chosenRules = [...appCss.matchAll(/(?:^|\n)([^{}\n]*\.variant\.is-chosen[^{}]*){([^}]*)}/g)]
    expect(chosenRules.length).toBeGreaterThan(0)
    for (const [, , body] of chosenRules) expect(body).not.toMatch(/box-shadow:\s*0 0 0 1px/)
    expect(rule('\\.variant\\.is-selected')).toMatch(/box-shadow:\s*0 0 0 1px var\(--accent\)/)
    expect(rule('\\.variant\\.is-chosen')).toMatch(/border-left:\s*3px solid var\(--accent\)/)
  })

  it('dims the options that were not chosen', () => {
    const dim = appCss.match(/\.variants:has\(\.variant\.is-chosen\) \.variant:not\(\.is-chosen\)\s*{([^}]*)}/)?.[1] ?? ''
    expect(dim).toMatch(/opacity:\s*0\.72/)
    expect(appCss).toMatch(/\.variants:has\(\.variant\.is-chosen\) \.variant:not\(\.is-chosen\):hover\s*{[^}]*transform:\s*none/)
  })

  it('writes the choice comment in an input card, with no legacy box rules', () => {
    expect(appCss).not.toMatch(/\.variant-confirm textarea/)
    expect(appCss).toMatch(/\.input-card\s*{[^}]*background:\s*var\(--nav-bg\)[^}]*border:\s*1px solid transparent/)
    expect(appCss).toMatch(/\.input-card:focus-within\s*{[^}]*var\(--accent-soft\)/)
  })
})
