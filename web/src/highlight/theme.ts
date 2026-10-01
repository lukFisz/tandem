import type { ThemeRegistration } from 'shiki/core'

// tdm-ide: a JetBrains "New UI dark"-like palette, used in both light and dark page themes.
export const tdmIdeTheme: ThemeRegistration = {
  name: 'tdm-ide',
  type: 'dark',
  colors: { 'editor.background': '#1e1f22', 'editor.foreground': '#bcbec4' },
  tokenColors: [
    { settings: { foreground: '#bcbec4' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#7a7e85', fontStyle: 'italic' } },
    {
      scope: ['keyword', 'keyword.control', 'keyword.other', 'storage.type', 'storage.modifier', 'constant.language', 'keyword.operator.new', 'variable.language'],
      settings: { foreground: '#cf8e6d' },
    },
    { scope: ['string', 'string.quoted', 'punctuation.definition.string'], settings: { foreground: '#6aab73' } },
    { scope: ['constant.numeric', 'constant.character.escape'], settings: { foreground: '#2aacb8' } },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.class', 'support.type', 'entity.other.inherited-class', 'storage.type.java', 'entity.name.type.class'],
      settings: { foreground: '#c77dbb' },
    },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: '#56a8f5' } },
    { scope: ['entity.name.tag', 'meta.annotation', 'storage.type.annotation', 'punctuation.definition.annotation'], settings: { foreground: '#b3ae60' } },
    { scope: ['markup.heading', 'entity.name.section'], settings: { foreground: '#cf8e6d', fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
  ],
}
