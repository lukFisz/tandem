import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('jump highlight (demo 6 follow-ups 3)', () => {
  it('fades a soft accent tint out over a second', () => {
    expect(appCss).toMatch(/\.is-jump-target\s*{[^}]*animation:\s*tdm-jump 1s ease-out/)
    const frames = appCss.match(/@keyframes tdm-jump\s*{([\s\S]*?)\n}/)
    expect(frames).not.toBeNull()
    expect(frames![1]).toMatch(/background-color:\s*color-mix\(in srgb, var\(--accent\)/)
  })

  it('shows a static tint under prefers-reduced-motion', () => {
    const reduced = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join('\n')
    const rule = reduced.match(/\.is-jump-target\s*{([^}]*)}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('animation: none')
    expect(rule![1]).toMatch(/background-color:\s*color-mix\(in srgb, var\(--accent\)/)
  })
})
