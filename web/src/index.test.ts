import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
const themeInit = readFileSync(join(process.cwd(), 'public/theme-init.js'), 'utf8')

describe('index.html theme script (no flash on load)', () => {
  it('loads a classic (blocking) script reading tdm.theme before any stylesheet or module script, in <head>', () => {
    const headMatch = indexHtml.match(/<head>([\s\S]*?)<\/head>/)
    expect(headMatch).not.toBeNull()
    const head = headMatch![1]
    const scriptMatch = head.match(/<script src="\/theme-init\.js"><\/script>/)
    expect(scriptMatch).not.toBeNull()
    expect(themeInit).toContain('tdm.theme')

    // It must come before any stylesheet <link> or module <script src>.
    const scriptPos = head.indexOf(scriptMatch![0])
    const laterHead = head.slice(scriptPos + scriptMatch![0].length)
    expect(laterHead).not.toMatch(/<link[^>]*stylesheet/)
    expect(laterHead).not.toMatch(/<script[^>]*src/)
  })

  it('has no inline script: the daemon CSP allows scripts from self only', () => {
    expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })
})
