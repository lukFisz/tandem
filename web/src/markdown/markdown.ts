import MarkdownIt, { type Env, type MarkdownIt as Md } from 'markdown-it'
import { useMemo } from 'react'
import type { LineRange } from '../api/types'
import { useTokenize } from '../highlight/context'
import type { Token, Tokenize } from '../highlight/tokenize'
import { splitIds, type TitleOf } from '../refs/ids'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// MdEnv is the env Prose passes to md.render: titleOf turns agent-written thread and stage ids into
// chips (demo2 follow-up 4). Markdown blocks pass none to splitSections, so they render as written.
export interface MdEnv extends Env {
  titleOf?: TitleOf
}

type MdToken = Parameters<NonNullable<Md['renderer']['rules']['text']>>[0][number]

// idChipHtml is the HTML twin of the IdChip component (refs/IdChip.tsx); keep the two in sync.
export function idChipHtml(id: string, title: string): string {
  return `<a class="id-chip" href="#${id}" title="id: ${id}">${escapeHtml(title)}</a>`
}

// insideLink reports whether an inline text token sits between link_open and link_close: a chip
// there would nest a link in a link.
function insideLink(tokens: MdToken[], idx: number): boolean {
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].type === 'link_close') return false
    if (tokens[i].type === 'link_open') return true
  }
  return false
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

export function renderTokensHtml(lines: Token[][]): string {
  const body = lines
    .map((line) =>
      line
        .map((t) => {
          const text = escapeHtml(t.content)
          if (!t.color || !HEX_COLOR.test(t.color)) return text
          return `<span style="color:${t.color}${t.italic ? ';font-style:italic' : ''}">${text}</span>`
        })
        .join(''),
    )
    .join('\n')
  return `<pre class="md-code"><code>${body}</code></pre>`
}

// createMarkdown: raw HTML disabled (AI/user text is never trusted), fences highlighted by Shiki.
export function createMarkdown(tokenize: Tokenize): Md {
  const md: Md = new MarkdownIt({
    html: false,
    linkify: true,
    highlight: (code, lang) => renderTokensHtml(tokenize(code, lang || 'text')),
  })
  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noreferrer')
    return self.renderToken(tokens, idx, options)
  }
  // Plain text runs only: code spans and fences have their own rules, so ids there stay as written.
  md.renderer.rules.text = (tokens, idx, _options, env) => {
    const content = tokens[idx].content
    const titleOf = (env as MdEnv | undefined)?.titleOf
    if (!titleOf || insideLink(tokens, idx)) return escapeHtml(content)
    return splitIds(content, titleOf)
      .map((s) => (s.kind === 'text' ? escapeHtml(s.text) : idChipHtml(s.id, s.title)))
      .join('')
  }
  return md
}

export interface MdSection {
  html: string
  lines: LineRange
  // Set on a section holding one top-level list item: the list is split per item so each item
  // gets its own gutter, and the flags let the view keep the items visually one list.
  listItem?: boolean
  firstInList?: boolean
  lastInList?: boolean
}

// matchingClose returns the index of the token closing the one opened at `open` (itself for a
// self-contained token).
function matchingClose(tokens: MdToken[], open: number): number {
  if (tokens[open].nesting !== 1) return open
  let depth = 0
  for (let j = open; j < tokens.length; j++) {
    depth += tokens[j].nesting
    if (depth === 0) return j
  }
  return tokens.length - 1
}

// cloneToken copies a token (with its own attrs array) so a per-item wrapper can change it
// without touching the parsed token shared by the other items.
function cloneToken(t: MdToken): MdToken {
  const c = Object.assign(Object.create(Object.getPrototypeOf(t)), t) as MdToken
  c.attrs = t.attrs ? t.attrs.map(([k, v]) => [k, v] as [string, string]) : null
  return c
}

// splitSections renders each top-level block separately, keeping its source line range
// (markdown-it token.map is 0-based, end-exclusive) so comments can anchor to lines. A top-level
// list is split further, one section per item, each wrapped in its own copy of the list tag (an
// ordered list's copies carry start= so the numbering reads as in the whole list); nested lists
// stay inside their parent item. `env` is passed to the renderer (a note block's id chips).
export function splitSections(md: Md, text: string, firstLine = 1, env: MdEnv = {}): MdSection[] {
  const tokens = md.parse(text, {})
  const source = text.split('\n')
  const render = (slice: MdToken[]) => md.renderer.render(slice, md.options, env)
  const sections: MdSection[] = []
  let i = 0
  while (i < tokens.length) {
    const j = matchingClose(tokens, i)
    const open = tokens[i]
    if (open.type === 'bullet_list_open' || open.type === 'ordered_list_open') {
      sections.push(...splitList(tokens, i, j, source, firstLine, render))
    } else {
      const map = open.map ?? [0, 1]
      sections.push({
        html: render(tokens.slice(i, j + 1)),
        lines: { start: firstLine + map[0], end: firstLine + Math.max(map[0], map[1] - 1) },
      })
    }
    i = j + 1
  }
  return sections
}

function splitList(
  tokens: MdToken[],
  open: number,
  close: number,
  source: string[],
  firstLine: number,
  render: (slice: MdToken[]) => string,
): MdSection[] {
  const listOpen = tokens[open]
  const ordered = listOpen.type === 'ordered_list_open'
  const listStart = ordered ? Number(listOpen.attrGet('start') ?? 1) : 1
  const items: MdSection[] = []
  let k = open + 1
  while (k < close) {
    const end = matchingClose(tokens, k)
    const wrapOpen = cloneToken(listOpen)
    if (ordered) {
      const n = listStart + items.length
      wrapOpen.attrs = (wrapOpen.attrs ?? []).filter(([name]) => name !== 'start')
      if (n !== 1) wrapOpen.attrs.unshift(['start', String(n)])
      if (wrapOpen.attrs.length === 0) wrapOpen.attrs = null
    }
    const wrapClose = cloneToken(tokens[close])
    const map = tokens[k].map ?? listOpen.map ?? [0, 1]
    // An item's map runs to the next item, so it takes in the blank line of a loose list: trim it.
    let last = Math.max(map[0], map[1] - 1)
    while (last > map[0] && (source[last] ?? '').trim() === '') last--
    items.push({
      html: render([wrapOpen, ...tokens.slice(k, end + 1), wrapClose]),
      lines: { start: firstLine + map[0], end: firstLine + last },
      listItem: true,
      firstInList: items.length === 0,
      lastInList: false,
    })
    k = end + 1
  }
  if (items.length > 0) items[items.length - 1].lastInList = true
  return items
}

export function useMarkdown(): Md {
  const tokenize = useTokenize()
  return useMemo(() => createMarkdown(tokenize), [tokenize])
}
