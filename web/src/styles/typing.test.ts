import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')
const rule = (selector: RegExp) => appCss.match(new RegExp(`(?:^|\\n)${selector.source}\\s*{([^}]*)}`))?.[1] ?? ''
const keyframes = (name: string) => appCss.match(new RegExp(`@keyframes ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1] ?? ''
const reduced = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join('\n')

describe('typing bubble (demo 7 follow-ups 4, UI polish 2)', () => {
  it('has no bouncing rally left', () => {
    expect(appCss).not.toContain('pong')
    expect(appCss).not.toContain('transform-box')
  })

  it('has no squiggle left', () => {
    expect(appCss).not.toContain('typing-ink')
    expect(appCss).not.toContain('tdm-ink-draw')
  })

  it('has no word, shimmer or caret left', () => {
    expect(appCss).not.toContain('.typing-caret')
    expect(appCss).not.toMatch(/@keyframes tdm-ink\s*{/)
    expect(appCss).not.toMatch(/background-clip:\s*text/)
    // The running process tail still blinks its caret.
    expect(keyframes('tdm-caret')).toMatch(/to\s*{\s*opacity:\s*0/)
  })

  it('has no dots left', () => {
    expect(appCss).not.toContain('.typing-dot')
    expect(appCss).not.toMatch(/@keyframes tdm-typing\s*{/)
  })

  it('draws the pixel diamond without a bubble background or pulse', () => {
    expect(appCss).not.toContain('tdm-typing-bubble')
    expect(rule(/\.typing-bubble/)).not.toMatch(/background/)
    expect(rule(/\.typing-diamond i/)).toMatch(/animation:\s*tdm-px 1\.5s/)
    expect(rule(/\.typing-diamond i:nth-child\(5\)/)).toMatch(/animation-delay:\s*-1\.5s/)
    expect(keyframes('tdm-px')).toMatch(/transform:\s*scale\(1\)/)
  })

  // The bubble's visually hidden label is position: absolute. The scroll container must be its
  // containing block, or the label lands at its scrolled offset relative to the viewport and the
  // whole document grows a second scrollbar while the AI is replying.
  it('contains the visually hidden label inside the scrolling main', () => {
    expect(rule(/\.main/)).toMatch(/position:\s*relative/)
    expect(rule(/\.visually-hidden/)).toMatch(/position:\s*absolute/)
  })

  it('holds the diamond still under reduced motion', () => {
    expect(reduced).toMatch(/\.typing-diamond i\s*{\s*animation-play-state:\s*paused/)
  })

  // Review polish: the muted has-text label sat under 4.5:1 on the pulse's accent-tinted peak, so
  // its text takes the main text color.
  it('keeps the has-text label at the main text color', () => {
    expect(rule(/\.typing-bubble\.has-text \.typing-text/)).toMatch(/color:\s*var\(--fg\)/)
  })
})
