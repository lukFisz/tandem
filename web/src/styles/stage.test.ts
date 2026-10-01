import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('stage thread list', () => {
  // Thread conclusions render as markdown inside the list, so the list's own row styling must
  // target only its direct children: a descendant `li` / `a` rule would put row borders between a
  // conclusion's list items and strip underlines from its links.
  it('styles only its own rows and title links, not the markdown inside a conclusion', () => {
    expect(appCss).toMatch(/\.stage-threads\s*>\s*li\s*{[^}]*border-bottom/)
    expect(appCss).toMatch(/\.stage-threads\s*>\s*li\s*>\s*a\s*{/)
    expect(appCss).not.toMatch(/\.stage-threads\s+li\s*{/)
    expect(appCss).not.toMatch(/\.stage-threads\s+a[\s:{]/)
  })
})

describe('stage thread with its conclusion', () => {
  // The conclusion hangs under the thread title's text, not under its status icon, so a thread and
  // its conclusion read as one block. Both widths come from one variable so they cannot drift.
  it('indents the conclusion by the width of the status icon slot', () => {
    expect(appCss).toMatch(/\.stage-thread-icon\s*{[^}]*width:\s*var\(--stage-icon-w\)/)
    expect(appCss).toMatch(/\.stage-concl\s*{[^}]*margin-left:\s*var\(--stage-icon-w\)/)
  })

  it('keeps list numbers inside the conclusion column', () => {
    expect(appCss).toMatch(/\.stage-concl ul, \.stage-concl ol\s*{[^}]*padding-left:\s*2em/)
  })
})

describe('stage page with a composer (stage summary flow spec, part E)', () => {
  // The composer is sticky with margin-top: auto, like the thread's: the page must fill the column.
  it('fills the scroll area so the composer sits at the bottom', () => {
    expect(appCss).toMatch(/\.stage\s*{[^}]*min-height:\s*100%/)
  })
})

describe('folded stage thread list (stage summary flow spec, part E)', () => {
  it('styles the one-line toggle as quiet UI text', () => {
    expect(appCss).toMatch(/\.stage-threads-toggle\s*{[^}]*font:[^;]*var\(--font-ui\)/)
  })
})
