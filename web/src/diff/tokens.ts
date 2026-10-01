import type { Token, Tokenize } from '../highlight/tokenize'
import type { ParsedDiff } from './diff'

// diffTokens highlights each hunk as two whole texts, the old side (context and deleted rows) and
// the new side (context and added rows), so multi-line constructs keep their colors, and returns
// per hunk the tokens of each row in row order.
export function diffTokens(diff: ParsedDiff, tokenize: Tokenize, lang: string): Token[][][] {
  return diff.hunks.map((h) => {
    const olds = h.rows.filter((r) => r.type !== 'add')
    const news = h.rows.filter((r) => r.type !== 'del')
    const oldTok = olds.length ? tokenize(olds.map((r) => r.text).join('\n') + '\n', lang) : []
    const newTok = news.length ? tokenize(news.map((r) => r.text).join('\n') + '\n', lang) : []
    let o = 0
    let n = 0
    return h.rows.map((r) => {
      if (r.type === 'del') return oldTok[o++] ?? [{ content: r.text }]
      if (r.type === 'ctx') o++
      return newTok[n++] ?? [{ content: r.text }]
    })
  })
}
