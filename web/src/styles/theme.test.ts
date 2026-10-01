import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const themeCss = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')

// A declaration set as `--token: value` lines, ignoring whitespace and ordering, so the two
// blocks below can be compared without caring about declaration order.
function declLines(block: string): Set<string> {
  return new Set(
    block
      .split(';')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/\s+/g, ' ')),
  )
}

describe('dark theme tokens (theme button)', () => {
  it('the data-theme="dark" block matches the prefers-color-scheme block exactly', () => {
    const mediaMatch = themeCss.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme="light"\]\)\s*{([^}]*)}/)
    expect(mediaMatch).not.toBeNull()
    const attrMatch = themeCss.match(/:root\[data-theme="dark"\]\s*{([^}]*)}/)
    expect(attrMatch).not.toBeNull()
    expect(declLines(attrMatch![1])).toEqual(declLines(mediaMatch![1]))
    // Sanity: both are non-trivial, so this isn't vacuously true.
    expect(declLines(mediaMatch![1]).size).toBeGreaterThan(5)
  })

  it('sets color-scheme for both explicit themes', () => {
    expect(themeCss).toMatch(/:root\[data-theme="light"\]\s*{[^}]*color-scheme:\s*light/)
    expect(themeCss).toMatch(/:root\[data-theme="dark"\]\s*{[^}]*color-scheme:\s*dark/)
  })
})
