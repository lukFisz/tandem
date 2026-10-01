import { useEffect, useRef, type MouseEvent } from 'react'
import { useSessionCtx } from '../session/context'
import { BlockView } from './BlockView'
import { blockLabel } from './blockLabel'

// BlockModal shows the expanded block (ctx.expandedBlock) large, in a native modal dialog: Escape,
// the ✕ and a click on the backdrop close it. Line comments and annotations work inside it as in the
// thread (same ctx); the copy here carries no element id, so jump and scroll targets stay the thread's.
export function BlockModal() {
  const { state, expandedBlock, expandBlock } = useSessionCtx()
  const block = expandedBlock ? state.blocks[expandedBlock] : undefined
  if (!block) return null
  return <BlockDialog key={block.id} blockId={block.id} onClose={() => expandBlock(null)} />
}

function BlockDialog({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const { state } = useSessionCtx()
  const block = state.blocks[blockId]
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // showModal gives the backdrop, focus trapping and Escape; jsdom lacks it, so fall back to `open`.
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    } else dialog.setAttribute('open', '')
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
    }
  }, [])
  // A click on the dialog element itself (not its content) lands on the backdrop.
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose()
  }
  const path = block.path && !blockLabel(block).endsWith(block.path) ? block.path : undefined
  return (
    <dialog
      ref={ref}
      className="block-modal"
      aria-label={blockLabel(block)}
      onClick={onClick}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <header className="block-modal-head">
        <span className="block-modal-label">{blockLabel(block)}</span>
        {path && <span className="block-modal-path">{path}</span>}
        <button type="button" className="block-modal-close" aria-label="Close" title="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="block-modal-body">
        <BlockView block={block} expanded />
      </div>
    </dialog>
  )
}
