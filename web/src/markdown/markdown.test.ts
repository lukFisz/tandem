import { describe, expect, it } from 'vitest'
import { plainTokenize, type Tokenize } from '../highlight/tokenize'
import { createMarkdown, renderTokensHtml, splitSections } from './markdown'

const doc = '# Storage\n\nWe keep an event log.\n\n- JSONL\n- blobs\n'

describe('markdown', () => {
  it('splits top-level blocks with their source lines', () => {
    const sections = splitSections(createMarkdown(plainTokenize), doc)
    expect(sections.map((s) => s.lines)).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 5 },
      { start: 6, end: 6 },
    ])
    expect(sections[0].html).toContain('<h1>Storage</h1>')
    expect(sections[1].html).toContain('<p>We keep an event log.</p>')
    expect(sections[2].html).toBe('<ul>\n<li>JSONL</li>\n</ul>\n')
    expect(sections[3].html).toBe('<ul>\n<li>blobs</li>\n</ul>\n')
  })

  it('offsets lines for excerpts of a file', () => {
    const sections = splitSections(createMarkdown(plainTokenize), 'para\n', 40)
    expect(sections[0].lines).toEqual({ start: 40, end: 40 })
  })

  it('never renders raw HTML or javascript: links (Review Focus 4)', () => {
    const html = createMarkdown(plainTokenize).render('<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
  })

  it('opens links in a new tab', () => {
    const html = createMarkdown(plainTokenize).render('[docs](https://example.com)')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>')
  })

  it('highlights fenced code with the tokenizer and escapes it', () => {
    const tokenize: Tokenize = (code) => code.split('\n').map((l) => [{ content: l, color: '#cf8e6d' }])
    const html = createMarkdown(tokenize).render('```kotlin\nval x = "<b>"\n```\n')
    expect(html).toContain('<pre class="md-code"><code>')
    expect(html).toContain('<span style="color:#cf8e6d">val x = &quot;&lt;b&gt;&quot;</span>')
  })

  it('never interpolates a hostile token color into the style attribute', () => {
    const html = renderTokensHtml([[{ content: 'x', color: 'red" onmouseover="alert(1)' }]])
    expect(html).not.toContain('onmouseover')
    const html2 = renderTokensHtml([[{ content: 'y', color: '#fff;background:url(x)' }]])
    expect(html2).not.toContain('background:url')
  })
})

describe('list item sections', () => {
  const md = createMarkdown(plainTokenize)

  it('splits a bullet list into one section per item', () => {
    const text = Array.from({ length: 12 }, (_, i) => `- item ${i + 1}`).join('\n') + '\n'
    const sections = splitSections(md, text)
    expect(sections).toHaveLength(12)
    expect(sections.map((s) => s.lines)).toEqual(Array.from({ length: 12 }, (_, i) => ({ start: i + 1, end: i + 1 })))
    expect(sections[11].html).toBe('<ul>\n<li>item 12</li>\n</ul>\n')
    expect(sections.map((s) => [s.listItem, s.firstInList, s.lastInList])).toEqual(
      Array.from({ length: 12 }, (_, i) => [true, i === 0, i === 11]),
    )
  })

  it('keeps the numbering of an ordered list starting at 3', () => {
    const sections = splitSections(md, '3. three\n7. four\n1. five\n')
    expect(sections.map((s) => s.html)).toEqual([
      '<ol start="3">\n<li>three</li>\n</ol>\n',
      '<ol start="4">\n<li>four</li>\n</ol>\n',
      '<ol start="5">\n<li>five</li>\n</ol>\n',
    ])
  })

  it('numbers items of an ordered list starting at 1', () => {
    const sections = splitSections(md, '1. a\n2. b\n')
    expect(sections.map((s) => s.html)).toEqual(['<ol>\n<li>a</li>\n</ol>\n', '<ol start="2">\n<li>b</li>\n</ol>\n'])
  })

  it('keeps a nested list inside its parent item', () => {
    const sections = splitSections(md, '- a\n  - a1\n  - a2\n- b\n')
    expect(sections.map((s) => s.lines)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 4 },
    ])
    expect(sections[0].html).toBe('<ul>\n<li>a\n<ul>\n<li>a1</li>\n<li>a2</li>\n</ul>\n</li>\n</ul>\n')
  })

  it('renders loose list items with paragraphs and trims trailing blank lines', () => {
    const sections = splitSections(md, '- a\n\n- b\n\npara\n')
    expect(sections.map((s) => s.lines)).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 5 },
    ])
    expect(sections[0].html).toBe('<ul>\n<li>\n<p>a</p>\n</li>\n</ul>\n')
    expect(sections[1].html).toBe('<ul>\n<li>\n<p>b</p>\n</li>\n</ul>\n')
    expect(sections[2].listItem).toBeFalsy()
  })

  it('covers every line of a multi-line item', () => {
    const sections = splitSections(md, '- first\n  continues\n  here\n- second\n')
    expect(sections.map((s) => s.lines)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 4 },
    ])
  })

  it('offsets item lines for excerpts of a file', () => {
    const sections = splitSections(md, '- a\n- b\n', 40)
    expect(sections.map((s) => s.lines)).toEqual([
      { start: 40, end: 40 },
      { start: 41, end: 41 },
    ])
  })

  it('does not mutate tokens shared with the parse', () => {
    const sections = splitSections(md, '2. a\n3. b\n')
    const again = splitSections(md, '2. a\n3. b\n')
    expect(again.map((s) => s.html)).toEqual(sections.map((s) => s.html))
  })
})

describe('id chips in markdown (demo2 follow-up 4)', () => {
  const md = createMarkdown(plainTokenize)
  const titles: Record<string, string> = { t_1: 'Repository <layer>', st_1: 'Data model' }
  const titleOf = (id: string) => titles[id]

  it('renders known ids in text as chips with the escaped title', () => {
    const html = md.render('See t_1 in **st_1**.', { titleOf })
    expect(html).toContain('<a class="id-chip" href="#t_1" title="id: t_1">Repository &lt;layer&gt;</a>')
    expect(html).toContain('<strong><a class="id-chip" href="#st_1" title="id: st_1">Data model</a></strong>')
  })

  // Review Focus 2
  it('leaves ids in code, in links, inside words and unknown ids alone', () => {
    const html = md.render('`t_1` and st_1x and t_9 and [t_1](https://example.com/t_1)\n\n```\nt_1\n```\n', { titleOf })
    expect(html).not.toContain('id-chip')
    expect(html).toContain('<code>t_1</code>')
  })

  it('leaves ids in a bare linkified URL alone', () => {
    const html = md.render('see https://example.com/t_1', { titleOf })
    expect(html).not.toContain('id-chip')
    expect(html).toContain('href="https://example.com/t_1"')
  })

  it('renders no chips without titles (markdown documents)', () => {
    expect(md.render('See t_1.')).toBe('<p>See t_1.</p>\n')
  })

  it('renders option ids as chips (question message spec, part A)', () => {
    const html = md.render('Chose o_1.', { titleOf: (id: string) => (id === 'o_1' ? 'Empty map' : undefined) })
    expect(html).toContain('<a class="id-chip" href="#o_1" title="id: o_1">Empty map</a>')
  })
})
