import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

describe('bottom padding under the page content (demo 7 follow-ups 2)', () => {
  // A resolved thread (or a read-only page) has no composer, so its last card would sit on the
  // page's bottom edge.
  it('pads the bottom of the thread and stage articles', () => {
    expect(appCss).toMatch(/\.thread,\s*\.stage\s*{[^}]*padding-bottom:\s*48px/)
  })

  // The sticky composer is the article's last child: under the padding it would stop 48px above
  // the scroll area's bottom, leaving a gap under it. With a composer, the article has none.
  it('drops the padding when the article ends with the sticky composer', () => {
    expect(appCss).toMatch(/\.thread:has\(>\s*\.composer\),\s*\.stage:has\(>\s*\.composer\)\s*{[^}]*padding-bottom:\s*0/)
  })
})
