import { useMemo } from 'react'
import { useTitleOf } from '../refs/IdChip'
import { useMarkdown, type MdEnv } from './markdown'

// Prose renders trusted-safe markdown (markdown-it with html disabled) in the reading typeface.
// It only ever renders agent text; thread and stage ids in it become chips (demo2 follow-up 4).
// `textAnchor` marks it as the text of a message that takes notes on selected text.
export function Prose({ text, className, textAnchor }: { text: string; className?: string; textAnchor?: boolean }) {
  const md = useMarkdown()
  const titleOf = useTitleOf()
  const html = useMemo(() => {
    const env: MdEnv = { titleOf }
    return md.render(text, env)
  }, [md, text, titleOf])
  return (
    <div
      className={className ? `prose ${className}` : 'prose'}
      data-tn-text={textAnchor ? '' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
