import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ProposalCollapse {
  collapsed: boolean
  /** The AI proposed a newer version since the card was collapsed. Expanding clears it. */
  updated: boolean
  toggle(): void
  /** Collapses the card (after a sent message, part D). Never expands it. */
  collapse(): void
}

/** Each card's collapsedAt version (null: expanded), by card key (`conclusion:<threadId>`, `summary:<stageId>`). */
export type CollapseStore = Map<string, number | null>

const CollapseStoreContext = createContext<CollapseStore | null>(null)

// CollapseStoreProvider holds the collapse state of every card for the page session (demo 7
// follow-ups 3): LoadedSession owns one per session, so leaving an item and coming back restores its
// cards, and a reload starts over. `store` lets a test share one across renders.
export function CollapseStoreProvider({ store, children }: { store?: CollapseStore; children: ReactNode }) {
  const [own] = useState<CollapseStore>(() => new Map())
  return <CollapseStoreContext.Provider value={store ?? own}>{children}</CollapseStoreContext.Provider>
}

// useProposalCollapse is the collapse state of one proposal card (stage summary flow spec, part
// D), stored under `key` in the session's CollapseStore (demo 7 follow-ups 3), so it survives its
// caller remounting per thread or stage; without a provider it is component-local. A reload resets
// it. The card remembers the version it was collapsed at, so a newer proposal flags "Updated"
// without ever expanding the card (Review Focus 3).
export function useProposalCollapse(key: string, version: number): ProposalCollapse {
  const store = useContext(CollapseStoreContext)
  const [collapsedAt, setCollapsedAt] = useState<number | null>(() => store?.get(key) ?? null)
  useEffect(() => {
    store?.set(key, collapsedAt)
  }, [store, key, collapsedAt])
  const versionRef = useRef(version)
  versionRef.current = version
  const collapse = useCallback(() => setCollapsedAt((at) => at ?? versionRef.current), [])
  const toggle = useCallback(() => setCollapsedAt((at) => (at === null ? versionRef.current : null)), [])
  return { collapsed: collapsedAt !== null, updated: collapsedAt !== null && version > collapsedAt, toggle, collapse }
}
