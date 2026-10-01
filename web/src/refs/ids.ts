import type { Block, Message, State } from '../api/types'

// Demo2 follow-up 4: the agent refers to threads, stages and blocks by short id (t_3, st_1, b_7); the page shows
// each known id as a chip with the item's title. The question message spec (part A) adds variant
// options (o_2). splitIds is the one tokenizer for that: it cuts text into plain runs and known
// ids. An id is a whole word (st_1x, xt_1 and t_1_2 are not ids), ids inside `code spans` stay
// text, and ids the session does not know stay text.
export type IdSegment = { kind: 'text'; text: string } | { kind: 'ref'; id: string; title: string }

export type TitleOf = (id: string) => string | undefined

// A code span or a URL (matched first, so ids inside them are skipped), or a thread/stage/block/option id.
// An id is a whole word that is not part of a path, file name or hyphenated word: no word char,
// '/', '.' or '-' right before it, and no word char or a '.', '/', '-' plus a word char right
// after it. Sentence punctuation still works: "see t_1." and "(t_1)" match.
const CODE_OR_ID = /(`+)[\s\S]*?\1|([a-zA-Z][\w+.-]*:\/\/\S+)|(?<![\w/.-])(?:st|t|b|o|q|p)_\d+(?![\w]|[./-]\w)/g

export function splitIds(text: string, titleOf: TitleOf): IdSegment[] {
  const out: IdSegment[] = []
  const pushText = (s: string) => {
    if (!s) return
    const prev = out.at(-1)
    if (prev?.kind === 'text') prev.text += s
    else out.push({ kind: 'text', text: s })
  }
  let last = 0
  for (const m of text.matchAll(CODE_OR_ID)) {
    if (m[1] !== undefined || m[2] !== undefined) continue // a code span or URL: stays in the text run
    const title = titleOf(m[0])
    if (title === undefined) continue // an unknown id: stays in the text run
    pushText(text.slice(last, m.index!))
    out.push({ kind: 'ref', id: m[0], title })
    last = m.index! + m[0].length
  }
  pushText(text.slice(last))
  return out
}

// questionTitle is how a question is named in its q_N chip and in its answer's header (demo 6
// follow-ups 1): its first line. CSS truncates it.
export function questionTitle(text: string): string {
  return text.trim().split('\n', 1)[0]
}

// blockTitle names a block in its b_N chip by what it shows: a file or a document read from a file by
// name:lines (the file name without its directory), a note or a document from stdin by its first line,
// code by its number and language (`code 4 (go)`, so code blocks tell apart), variants by their title. CSS truncates it, as for questions.
export function blockTitle(b: Block): string {
  const firstLine = (text?: string) => (text ?? '').trim().split('\n', 1)[0].trim()
  switch (b.type) {
    case 'file':
    case 'markdown': {
      if (!b.path) return firstLine(b.text) || 'Document'
      const name = b.path.split('/').pop() || b.path
      if (!b.lineCount) return name
      const first = b.firstLine ?? 1
      return `${name}:${first}-${first + b.lineCount - 1}`
    }
    case 'code':
      return `code ${b.id.slice(2)}` + (b.lang ? ` (${b.lang})` : '')
    case 'variants':
      return b.variants?.title || 'Variants'
    default:
      return firstLine(b.text) || 'Note'
  }
}

// idTitles lists every id a chip can show with its title: stages, threads, blocks, variant options,
// questions in threads and on stage pages (by the question's first line; CSS truncates it) and
// their options.
// useTitleOf keys its memo on this list, so it must stay cheap and deterministic.
export function idTitles(state: State): [string, string][] {
  const pairs: [string, string][] = state.stages.map((s) => [s.id, s.title])
  const questions = (messages: Message[]) => {
    for (const m of messages) {
      if (!m.question) continue
      pairs.push([m.question.id, questionTitle(m.text)])
      for (const o of m.question.options) pairs.push([o.id, o.title])
    }
  }
  for (const t of Object.values(state.threads)) {
    pairs.push([t.id, t.title])
    questions(t.messages)
  }
  // Questions on stage pages too (demo 7 follow-ups 6).
  for (const s of state.stages) questions(s.messages ?? [])
  for (const b of Object.values(state.blocks)) {
    pairs.push([b.id, blockTitle(b)])
    for (const o of b.variants?.options ?? []) pairs.push([o.id, o.title])
  }
  for (const p of Object.values(state.processes ?? {})) pairs.push([p.id, p.cmd])
  return pairs
}

// titlesOf looks ids up in the session state.
export function titlesOf(state: State): TitleOf {
  const titles = new Map(idTitles(state))
  return (id) => titles.get(id)
}
