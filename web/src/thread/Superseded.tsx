import type { MouseEvent } from 'react'
import type { Block } from '../api/types'
import { BlockView } from '../blocks/BlockView'
import { blockLabel } from '../blocks/blockLabel'
import { useSessionCtx } from '../session/context'
import { highlightJumpTarget, prefersReducedMotion } from '../shell/motion'

export function Superseded({ block }: { block: Block }) {
  const { state } = useSessionCtx()
  const target = block.supersededBy
  const newer = target ? state.blocks[target] : undefined

  function jump(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation() // the summary would otherwise toggle the <details>
    if (!target) return
    const el = document.getElementById(target)
    if (!el) return
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
    highlightJumpTarget(el)
  }

  return (
    <details className="superseded" data-superseded={block.id}>
      <summary>
        {blockLabel(block)} superseded by{' '}
        <button type="button" className="btn link superseded-link" onClick={jump}>
          {newer ? blockLabel(newer) : target}
        </button>
      </summary>
      <BlockView block={block} />
    </details>
  )
}
