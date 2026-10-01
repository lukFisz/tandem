import { useEffect, useState } from 'react'
import { useSessionCtx } from '../session/context'
import { parseDiff, type ParsedDiff } from './diff'

// useBlockDiff loads and parses a file block's diff blob (diffSha). It returns undefined while it
// loads, when the block has none, or when it fails: the excerpt then renders without change marks.
export function useBlockDiff(diffSha: string | undefined): ParsedDiff | undefined {
  const { loadBlob } = useSessionCtx()
  const [diff, setDiff] = useState<{ sha: string; diff: ParsedDiff } | undefined>()
  useEffect(() => {
    if (!diffSha) return
    let live = true
    loadBlob(diffSha).then(
      (text) => live && setDiff({ sha: diffSha, diff: parseDiff(text) }),
      (e: unknown) => console.warn('tdm: could not load the diff', e),
    )
    return () => {
      live = false
    }
  }, [diffSha, loadBlob])
  return diff && diff.sha === diffSha ? diff.diff : undefined
}
