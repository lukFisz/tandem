import { useEffect, useState } from 'react'
import type { BlockContent, LineRange } from '../api/types'
import { useSessionCtx } from '../session/context'

// useBlockText returns inline text right away, or loads the snapshot blob of file/markdown blocks.
export function useBlockText(content: BlockContent): { text?: string; error?: string } {
  const { loadBlob } = useSessionCtx()
  const [state, setState] = useState<{ text?: string; error?: string }>(() =>
    content.blobSha ? {} : { text: content.text ?? '' },
  )
  useEffect(() => {
    if (!content.blobSha) {
      setState({ text: content.text ?? '' })
      return
    }
    // Reset to loading first, so a block whose blobSha changes never shows the previous blob's
    // stale text (or error) under its new header while the new one is in flight.
    setState({})
    let live = true
    loadBlob(content.blobSha).then(
      (text) => live && setState({ text }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [content.blobSha, content.text, loadBlob])
  return state
}

export function rangeText(r: LineRange): string {
  return r.start === r.end ? `line ${r.start}` : `lines ${r.start}–${r.end}`
}
