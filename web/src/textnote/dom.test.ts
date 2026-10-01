import { afterEach, describe, expect, it } from 'vitest'
import { anchorRoots, capture, findQuote } from './dom'

function mount(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

// Code rows as CodeLines renders them: a line-number button, the text in .src, an empty line as a
// zero-width space, and a line note between rows.
const CODE = `
<figure data-tn-block="b_2"><div class="code-lines">
  <div class="code-row" data-ls="12" data-le="12"><button class="ln">12</button><code class="src"><span>class </span><span>Repo(</span></code></div>
  <div class="code-row" data-ls="13" data-le="13"><button class="ln">13</button><code class="src">​</code></div>
  <div class="line-note">AI · a note</div>
  <div class="code-row" data-ls="14" data-le="14"><button class="ln">14</button><code class="src"><span>    val db: </span><span>Db</span></code></div>
</div></figure>`

const MD = `
<section data-tn-block="b_4"><div class="md-sections">
  <div class="md-section" data-ls="1" data-le="1"><button class="md-gutter">1</button><div class="prose"><h1>Storage</h1></div><div class="md-notes"></div></div>
  <div class="md-section" data-ls="3" data-le="4"><button class="md-gutter">3–4</button><div class="prose"><p>We keep an <strong>event</strong>
  log.</p></div><div class="md-notes"></div></div>
</div></section>`

const MSG = `<div class="msg-ai-wrap" data-tn-msg="7" data-tn-thread="t_1"><div class="prose msg-ai" data-tn-text=""><p>Here is the <em>repository</em> layer.</p></div></div>`

function select(start: Node, so: number, end: Node, eo: number): Selection {
  const r = document.createRange()
  r.setStart(start, so)
  r.setEnd(end, eo)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(r)
  return sel
}

const textIn = (root: ParentNode, selector: string) => root.querySelector(selector)!.firstChild!

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('capture', () => {
  it('reads a code selection across lines as the source text, with its line range', () => {
    const root = mount(CODE)
    const repo = root.querySelectorAll('.src')[0].childNodes[1].firstChild!
    const db = root.querySelectorAll('.src')[2].childNodes[0].firstChild!
    const c = capture(select(repo, 0, db, 8))!
    expect(c.quote).toBe('Repo(\n\n    val')
    expect(c.anchor).toEqual({ kind: 'block', threadId: '', blockId: 'b_2', lines: { start: 12, end: 14 } })
  })

  it('drops rows the selection only touches at an edge', () => {
    const root = mount(CODE)
    const src12 = root.querySelectorAll('.src')[0]
    const c = capture(select(src12.childNodes[1].firstChild!, 0, root.querySelectorAll('.src')[1], 0))!
    expect(c.quote).toBe('Repo(')
    expect(c.anchor).toMatchObject({ lines: { start: 12, end: 12 } })
  })

  it('reads a markdown selection by section lines', () => {
    const root = mount(MD)
    const c = capture(select(textIn(root, 'h1'), 2, root.querySelector('strong')!.firstChild!, 3))!
    expect(c.quote).toBe('orage\nWe keep an eve')
    expect(c.anchor).toMatchObject({ kind: 'block', blockId: 'b_4', lines: { start: 1, end: 4 } })
  })

  it('reads a message selection', () => {
    const root = mount(MSG)
    const c = capture(select(textIn(root, 'p'), 8, root.querySelector('em')!.firstChild!, 4))!
    expect(c.quote).toBe('the repo')
    expect(c.anchor).toEqual({ kind: 'message', threadId: 't_1', messageSeq: 7 })
  })

  it('ignores selections outside one surface, collapsed or blank ones', () => {
    const a = mount(CODE)
    const b = mount(MSG)
    expect(capture(select(textIn(a, '.src span'), 0, textIn(b, 'p'), 3))).toBeNull()
    expect(capture(select(textIn(a, '.src span'), 1, textIn(a, '.src span'), 1))).toBeNull()
    expect(capture(select(textIn(a, '.line-note'), 0, textIn(a, '.line-note'), 4))).toBeNull()
    const blank = a.querySelectorAll('.src')[1].firstChild!
    expect(capture(select(blank, 0, blank, 1))).toBeNull()
    const outside = mount('<p>plain</p>')
    expect(capture(select(textIn(outside, 'p'), 0, textIn(outside, 'p'), 3))).toBeNull()
  })
})

describe('findQuote', () => {
  it('finds the first occurrence within the anchored lines, ignoring whitespace', () => {
    const root = mount(MD)
    const anchor = { kind: 'block' as const, threadId: 't_3', blockId: 'b_4', lines: { start: 3, end: 4 } }
    const r = findQuote(root.querySelector('[data-tn-block]')!, anchor, 'an  event\nlog')!
    expect(r.toString()).toBe('an event\n  log')
    expect(findQuote(root.querySelector('[data-tn-block]')!, { ...anchor, lines: { start: 1, end: 1 } }, 'event')).toBeNull()
    expect(findQuote(root.querySelector('[data-tn-block]')!, anchor, '  ')).toBeNull()
  })

  it('finds a quote in a message and the roots of an anchor', () => {
    mount(MSG)
    const anchor = { kind: 'message' as const, threadId: 't_1', messageSeq: 7 }
    const [root] = anchorRoots(anchor)
    expect(findQuote(root, anchor, 'the repository')!.toString()).toBe('the repository')
    expect(anchorRoots({ ...anchor, messageSeq: 8 })).toEqual([])
  })
})
