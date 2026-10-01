import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { tdmIdeTheme } from './theme'

export interface Token {
  content: string
  color?: string
  italic?: boolean
}

export type Tokenize = (code: string, lang: string) => Token[][]

export const LANGS = ['java', 'kotlin', 'go', 'python', 'markdown', 'typescript', 'tsx', 'javascript', 'json', 'yaml', 'bash', 'sql'] as const

// splitLines drops one trailing newline so "a\n" is one line, like the daemon's CountLines.
export function splitLines(code: string): string[] {
  return (code.endsWith('\n') ? code.slice(0, -1) : code).split('\n')
}

export const plainTokenize: Tokenize = (code) => splitLines(code).map((line) => [{ content: line }])

let loading: Promise<Tokenize> | null = null

export function loadTokenizer(): Promise<Tokenize> {
  loading ??= createHighlighterCore({
    themes: [tdmIdeTheme],
    langs: [
      import('shiki/langs/java.mjs'),
      import('shiki/langs/kotlin.mjs'),
      import('shiki/langs/go.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/bash.mjs'),
      import('shiki/langs/sql.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  }).then((h) => {
    const loaded = new Set(h.getLoadedLanguages())
    return (code, lang) => {
      if (!loaded.has(lang)) return plainTokenize(code, lang)
      const src = splitLines(code).join('\n')
      return h.codeToTokens(src, { lang, theme: 'tdm-ide' }).tokens.map((line) =>
        line.map((t) => ({ content: t.content, color: t.color, italic: ((t.fontStyle ?? 0) & 1) === 1 })),
      )
    }
  })
  return loading
}
