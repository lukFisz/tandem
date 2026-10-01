import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

describe('index.html inline theme script (no flash on load)', () => {
  it('reads tdm.theme from localStorage before any stylesheet or module script, in <head>', () => {
    const headMatch = indexHtml.match(/<head>([\s\S]*?)<\/head>/)
    expect(headMatch).not.toBeNull()
    const head = headMatch![1]
    const scriptMatch = head.match(/<script>([\s\S]*?)<\/script>/)
    expect(scriptMatch).not.toBeNull()
    expect(scriptMatch![1]).toContain('tdm.theme')

    // It must come before any stylesheet <link> or module <script src>.
    const scriptPos = head.indexOf(scriptMatch![0])
    const laterHead = head.slice(scriptPos + scriptMatch![0].length)
    expect(laterHead).not.toMatch(/<link[^>]*stylesheet/)
    expect(laterHead).not.toMatch(/<script[^>]*src/)
  })
})
