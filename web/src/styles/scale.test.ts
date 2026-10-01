import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom can't evaluate media queries or layout, so this test reads the CSS source directly and
// checks the two things that make type (and the measures tied to it) scale with the viewport:
// no px font size left to freeze the type at the ≤1280px size, and the breakpoints that grow
// the root font size (and everything in rem with it) on wider screens exist.
const dir = join(process.cwd(), 'src/styles')
const appCss = readFileSync(join(dir, 'app.css'), 'utf8')
const themeCss = readFileSync(join(dir, 'theme.css'), 'utf8')
const css = appCss + '\n' + themeCss

// Declarations that set a font size: `font-size: ...` and the font shorthand `font: ... <size>[/<line-height>] <family>`.
// The only exceptions are `html { font-size: ... }` itself (the base, and its breakpoints) —
// that IS the rem root, so it has to be set in px; every other font size in the app is in rem.
const EXCEPTIONS: string[] = [
  'font-size: 16px',
  'font-size: 17px',
  'font-size: 18px',
  'font-size: 19px',
  'font-size: 20px',
  'font-size: 22px',
]

function pxFontSizeMatches(source: string): string[] {
  const hits: string[] = []
  for (const m of source.matchAll(/font-size\s*:\s*[^;]*?(\d*\.?\d+)px/g)) hits.push(m[0])
  for (const m of source.matchAll(/font\s*:\s*[^;]*?(\d*\.?\d+)px[^;]*;/g)) hits.push(m[0])
  return hits.filter((h) => !EXCEPTIONS.some((e) => h.includes(e)))
}

describe('type scales with the viewport (fix round 1)', () => {
  it('has no px font size left in app.css or theme.css', () => {
    expect(pxFontSizeMatches(css)).toEqual([])
  })

  it('sets the 16px rem base on html', () => {
    expect(themeCss).toMatch(/html\s*{\s*font-size:\s*16px\s*;?\s*}/)
  })

  it('defines the three wide-screen breakpoints that grow the root font size', () => {
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*1440px\)\s*{\s*html\s*{\s*font-size:\s*17px\s*;?\s*}\s*}/)
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*1728px\)\s*{\s*html\s*{\s*font-size:\s*18px\s*;?\s*}\s*}/)
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*2200px\)\s*{\s*html\s*{\s*font-size:\s*19px\s*;?\s*}\s*}/)
  })

  it('sizes the reading width and the chrome measures tied to it in rem', () => {
    expect(themeCss).toMatch(/--prose-width:\s*37\.5rem/)
    expect(appCss).toMatch(/\.nav\s*{[^}]*width:\s*14\.375rem/)
    expect(appCss).toMatch(/\.topbar\s*{[^}]*padding:\s*[\d.]+rem\s+[\d.]+rem/)
    expect(appCss).toMatch(/\.code-row \.ln\s*{[^}]*width:\s*2\.75rem/)
  })
})

// Wide-screen layout: the middle section (the thread timeline / stage view) was left-aligned
// and capped at 61.25rem, so it covered under half the screen on a very wide window. It now
// centers in `.main` and widens (up to 110rem) as the window grows, while staying pixel-identical
// to before at ≤1280px (--col-width's clamp floor is 61.25rem, above 70vw of any ≤1280px window).
describe('centers and widens the main column on wide screens', () => {
  it('defines --col-width as a clamp that keeps the ≤1280px floor and grows up to 110rem', () => {
    expect(themeCss).toMatch(/--col-width:\s*clamp\(61\.25rem,\s*70vw,\s*110rem\)/)
  })

  it('centers and widens .thread and .stage using --col-width', () => {
    expect(appCss).toMatch(/\.thread\s*{[^}]*margin-inline:\s*auto/)
    expect(appCss).toMatch(/\.thread\s*{[^}]*max-width:\s*var\(--col-width\)/)
    expect(appCss).toMatch(/\.stage\s*{[^}]*margin-inline:\s*auto/)
    expect(appCss).toMatch(/\.stage\s*{[^}]*max-width:\s*var\(--col-width\)/)
  })

  it('defines two more wide-screen root font-size breakpoints beyond 2200px', () => {
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*2560px\)\s*{\s*html\s*{\s*font-size:\s*20px\s*;?\s*}\s*}/)
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*3200px\)\s*{\s*html\s*{\s*font-size:\s*22px\s*;?\s*}\s*}/)
  })

  it('caps the stage view\'s own text content at reading width, so it is unaffected by the wider .stage column (review round 3, Important)', () => {
    expect(appCss).toMatch(/\.stage\s*>\s*header,\s*\.stage-threads,\s*\.stage \.muted\s*{[^}]*max-width:\s*var\(--prose-width\)/)
  })

  it('steps --prose-width up on wide screens, capped at 48rem', () => {
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*1728px\)\s*{\s*:root\s*{\s*--prose-width:\s*40rem/)
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*2200px\)\s*{\s*:root\s*{\s*--prose-width:\s*44rem/)
    expect(themeCss).toMatch(/@media\s*\(min-width:\s*2560px\)\s*{\s*:root\s*{\s*--prose-width:\s*48rem/)
    // Never beyond 48rem: no other --prose-width declaration in the file exceeds it.
    const widths = [...themeCss.matchAll(/--prose-width:\s*([\d.]+)rem/g)].map((m) => Number(m[1]))
    expect(Math.max(...widths)).toBe(48)
  })
})
