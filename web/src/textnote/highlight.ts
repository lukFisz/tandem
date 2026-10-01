// Highlights paint ranges through the CSS Custom Highlight API, which leaves the DOM (React's)
// untouched. Where it is missing they are a no-op: the gutter badges still mark the notes.
type Registry = { set(name: string, h: unknown): void; delete(name: string): void }

function registry(): Registry | null {
  const css = (globalThis as { CSS?: { highlights?: Registry } }).CSS
  return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function' ? css.highlights : null
}

export function paint(name: string, ranges: Range[]): void {
  const reg = registry()
  if (!reg) return
  if (!ranges.length) {
    reg.delete(name)
    return
  }
  const H = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight
  reg.set(name, new H(...ranges))
}
