import { useSessionCtx } from '../session/context'

// ExpandButton opens a block in the large block modal (BlockModal), or, inside that modal, closes it.
export function ExpandButton({ blockId, expanded = false }: { blockId: string; expanded?: boolean }) {
  const { expandBlock } = useSessionCtx()
  const label = expanded ? 'Collapse' : 'Expand'
  return (
    <button type="button" className="block-expand" aria-label={label} title={label} onClick={() => expandBlock(expanded ? null : blockId)}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path
          d={expanded ? 'M1.5 10.5 5 7M5 7H2M5 7v3M10.5 1.5 7 5M7 5h3M7 5V2' : 'M7 5l3.5-3.5M10.5 1.5H7.5M10.5 1.5v3M5 7l-3.5 3.5M1.5 10.5h3M1.5 10.5v-3'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
