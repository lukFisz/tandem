import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')
const themeCss = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')
const rule = (selector: RegExp) => appCss.match(new RegExp(`(?:^|\\n)${selector.source}\\s*{([^}]*)}`))?.[1] ?? ''
const keyframes = (name: string) => appCss.match(new RegExp(`@keyframes ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1] ?? ''
const reduced = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join('\n')

const themeBlocks = {
  light: themeCss.match(/(?:^|\n):root\s*{([^}]*)}/)?.[1] ?? '',
  system: themeCss.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme="light"\]\)\s*{([^}]*)}/)?.[1] ?? '',
  dark: themeCss.match(/:root\[data-theme="dark"\]\s*{([^}]*)}/)?.[1] ?? '',
}

describe('UI polish: tokens', () => {
  it.each(['--accent-soft', '--ring', '--shadow-1', '--ease-out', '--dur-1', '--dur-2'])('defines %s in the light and both dark blocks', (token) => {
    for (const block of Object.values(themeBlocks)) expect(block).toContain(`${token}:`)
  })

  it('keeps the motion tokens short and eased', () => {
    expect(themeBlocks.light).toMatch(/--ease-out:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
    expect(themeBlocks.light).toMatch(/--dur-1:\s*140ms/)
    expect(themeBlocks.light).toMatch(/--dur-2:\s*220ms/)
  })
})

describe('UI polish: transitions and focus', () => {
  it('eases button state changes', () => {
    expect(appCss).toMatch(/\.btn,[^{]*{[^}]*transition:[^;]*background-color var\(--dur-1\)/)
  })

  it('draws one accent focus ring for keyboard focus', () => {
    const focus = appCss.match(/:is\(button, a, input, textarea, select, \[tabindex\]\):focus-visible\s*{([^}]*)}/)
    expect(focus).not.toBeNull()
    expect(focus![1]).toContain('var(--ring)')
    expect(focus![1]).toContain('outline: none')
  })

  it('slides an accent bar in on the active nav row', () => {
    expect(appCss).toMatch(/\.nav-thread::before\s*{[^}]*transform:\s*scaleY\(0\)/)
    expect(appCss).toMatch(/\.nav-thread\.is-active::before\s*{[^}]*transform:\s*scaleY\(1\)/)
  })
})

describe('UI polish: entrances', () => {
  it('defines the entrance keyframes', () => {
    expect(keyframes('tdm-enter')).toMatch(/opacity:\s*0/)
    expect(keyframes('tdm-enter')).toMatch(/translateY\(6px\)/)
    expect(keyframes('tdm-fade')).toMatch(/opacity:\s*0/)
    expect(keyframes('tdm-pop')).toMatch(/scale\(1\.18\)/)
  })

  it('eases new timeline items in once', () => {
    expect(rule(/\.tl-enter/)).toMatch(/animation:\s*tdm-enter var\(--dur-2\) var\(--ease-out\)/)
  })

  it('switches the entrances off under prefers-reduced-motion', () => {
    const off = reduced.match(/((?:[^{}]*,)?\s*\.tl-enter,[^{]*){\s*animation:\s*none;?\s*}/)
    expect(off).not.toBeNull()
    for (const sel of ['.thread', '.stage', '.toast', '.settings-menu', '.count-pop', '.new-below']) expect(off![1]).toContain(sel)
    expect(reduced).toMatch(/\.nav-thread::before,[^{]*{\s*transition:\s*none/)
  })
})

describe('UI polish 3: input cards', () => {
  it('draws every text input as one soft card that lights up while focused', () => {
    const card = rule(/\.input-card/)
    expect(card).toMatch(/background:\s*var\(--nav-bg\)/)
    expect(card).toMatch(/border:\s*1px solid transparent/)
    expect(card).toMatch(/border-radius:\s*12px/)
    expect(card).toMatch(/padding:\s*8px 10px/)
    expect(card).toMatch(/transition:\s*border-color var\(--dur-1\), box-shadow var\(--dur-1\), background-color var\(--dur-1\)/)
    const focus = rule(/\.input-card:focus-within/)
    expect(focus).toMatch(/border-color:\s*color-mix\(in srgb, var\(--accent\) 45%, transparent\)/)
    expect(focus).toMatch(/box-shadow:\s*0 0 0 3px var\(--accent-soft\), var\(--shadow-1\)/)
    expect(focus).toMatch(/background:\s*var\(--bg\)/)
  })

  it('keeps the field bare inside the card', () => {
    const field = appCss.match(/\.input-card textarea,\s*\.input-card input\s*{([^}]*)}/)?.[1] ?? ''
    expect(field).toMatch(/border:\s*none/)
    expect(field).toMatch(/resize:\s*none/)
    expect(field).toMatch(/font:\s*0\.9rem\/1\.5 var\(--font-ui\)/)
    expect(appCss).toMatch(/\.input-card textarea::placeholder,\s*\.input-card input::placeholder\s*{\s*color:\s*var\(--muted\)/)
    expect(appCss).toMatch(/\.input-card input:focus-visible\s*{[^}]*box-shadow:\s*none/)
  })

  it('compacts the single-line Other input into a pill', () => {
    const inline = rule(/\.input-card\.is-inline/)
    expect(inline).toMatch(/padding:\s*4px 10px/)
    expect(inline).toMatch(/border-radius:\s*999px/)
    expect(inline).toMatch(/min-width:\s*12rem/)
  })

  it('recolors the card inside the dark code panel', () => {
    expect(rule(/\.code-panel \.input-card/)).toMatch(/background:\s*var\(--code-head\)/)
    expect(rule(/\.code-panel \.input-card:focus-within/)).toMatch(/background:\s*var\(--code-bg\)/)
    expect(appCss).toMatch(/\.code-panel \.input-card textarea::placeholder,[^{]*{\s*color:\s*#8c8f96/)
  })

  it('leaves no notebook look behind', () => {
    expect(appCss).not.toMatch(/notebook/)
    expect(appCss).not.toMatch(/border-bottom:\s*1px solid var\(--line\);\n\s*border-radius:\s*0/)
    expect(appCss).not.toMatch(/repeating-linear-gradient\(to bottom/)
  })
})

describe('UI polish 2: composer card', () => {
  it('shares the input card rules and sizes its own textarea', () => {
    expect(rule(/\.composer-card\.input-card/)).toMatch(/padding:\s*10px 12px 8px/)
    const input = rule(/\.composer-card\.input-card textarea/)
    expect(input).toMatch(/font-size:\s*0\.9375rem/)
    expect(input).toMatch(/max-height:\s*40vh/)
  })

  it('sends with a round accent button that lifts on hover', () => {
    const send = rule(/\.composer-send/)
    expect(send).toMatch(/border-radius:\s*50%/)
    expect(send).toMatch(/background:\s*var\(--accent\)/)
    expect(send).toMatch(/color:\s*var\(--accent-fg\)/)
    expect(rule(/\.composer-send:hover:not\(:disabled\)/)).toMatch(/transform:\s*translateY\(-1px\)/)
    expect(rule(/\.composer-send:disabled/)).toMatch(/opacity:\s*0\.35/)
    expect(rule(/\.composer-hint/)).toMatch(/color:\s*var\(--faint\)/)
    expect(reduced).toMatch(/\.input-card, \.composer-send\s*{\s*transition:\s*none/)
  })

  it('keeps the composer sticky with its fade above', () => {
    expect(rule(/\.composer/)).toMatch(/position:\s*sticky/)
    expect(rule(/\.composer::before/)).toMatch(/linear-gradient/)
  })
})

describe('UI polish: process tail', () => {
  it('lets each new tail line enter and shows a caret while running', () => {
    expect(rule(/\.process-tail-line/)).toMatch(/animation:\s*tdm-enter var\(--dur-2\) var\(--ease-out\) backwards/)
    const caret = rule(/\.process-card\.is-running \.process-tail-line:last-child::after/)
    expect(caret).toMatch(/animation:\s*tdm-caret 1s steps\(2, start\) infinite/)
    expect(caret).toMatch(/background:\s*var\(--accent\)/)
  })

  it('holds the tail still under reduced motion', () => {
    expect(reduced).toMatch(/\.process-tail-line,[^{]*{\s*animation:\s*none/)
    expect(reduced).toMatch(/\.process-card\.is-running \.process-tail-line:last-child::after\s*{\s*animation:\s*none;\s*opacity:\s*0\.7/)
  })
})

describe('UI polish: file path status', () => {
  it('spins the pending indicator and stills it under reduced motion', () => {
    expect(rule(/\.tdm-spinner/)).toMatch(/animation:\s*tdm-spin 0\.8s linear infinite/)
    expect(rule(/\.tdm-spinner/)).toMatch(/border-top-color:\s*var\(--accent\)/)
    expect(appCss).toMatch(/@keyframes tdm-spin\s*{\s*to\s*{\s*transform:\s*rotate\(360deg\)/)
    expect(reduced).toMatch(/\.tdm-spinner\s*{\s*animation:\s*none/)
  })
})

describe('UI polish 2: block modal', () => {
  it('draws the modal as a large rounded sheet that rises in', () => {
    const modal = rule(/\.block-modal/)
    expect(modal).toMatch(/width:\s*min\(94vw, 110rem\)/)
    expect(modal).toMatch(/max-height:\s*92vh/)
    expect(modal).toMatch(/border:\s*1px solid var\(--line\)/)
    expect(modal).toMatch(/border-radius:\s*12px/)
    expect(modal).toMatch(/background:\s*var\(--bg\)/)
    expect(modal).toMatch(/box-shadow:\s*0 24px 80px rgb\(0 0 0 \/ 0\.35\)/)
    expect(modal).toMatch(/animation:\s*tdm-modal-in var\(--dur-2\) var\(--ease-out\) backwards/)
    const frames = keyframes('tdm-modal-in')
    expect(frames).toMatch(/opacity:\s*0/)
    expect(frames).toMatch(/translateY\(8px\) scale\(0\.985\)/)
  })

  it('dims and blurs the page behind it', () => {
    const backdrop = rule(/\.block-modal::backdrop/)
    expect(backdrop).toMatch(/background:\s*color-mix\(in srgb, var\(--fg\) 35%, transparent\)/)
    expect(backdrop).toMatch(/backdrop-filter:\s*blur\(6px\)/)
    expect(backdrop).toMatch(/animation:\s*tdm-fade var\(--dur-2\) var\(--ease-out\) backwards/)
  })

  it('scrolls the body under a fixed header and reads code a size up', () => {
    expect(rule(/\.block-modal-head/)).toMatch(/border-bottom:\s*1px solid var\(--line\)/)
    expect(rule(/\.block-modal-body/)).toMatch(/overflow:\s*auto/)
    expect(rule(/\.block-modal-body/)).toMatch(/max-height:\s*calc\(92vh - 44px\)/)
    expect(rule(/\.code-panel\.is-expanded \.code-lines/)).toMatch(/font-size:\s*0\.875rem/)
  })

  it('shows a quiet expand control that turns accent on hover', () => {
    expect(rule(/\.block-expand/)).toMatch(/opacity:\s*0\.7/)
    expect(rule(/\.block-expand/)).toMatch(/transition:\s*opacity var\(--dur-1\), color var\(--dur-1\)/)
    expect(rule(/\.block-expand:hover/)).toMatch(/color:\s*var\(--accent\)/)
  })

  it('holds the modal still under reduced motion', () => {
    expect(reduced).toMatch(/\.block-modal, \.block-modal::backdrop\s*{\s*animation:\s*none/)
  })
})
