import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CollapseStoreProvider, useProposalCollapse } from './useProposalCollapse'

// Review Focus 3: never auto-expands; "Updated" only for a version newer than the collapse; expanding clears it.
describe('useProposalCollapse (stage summary flow spec, part D)', () => {
  it('collapses on request, flags newer versions, and clears the flag on expand', () => {
    const { result, rerender } = renderHook(({ v }) => useProposalCollapse('conclusion:t_1', v), { initialProps: { v: 1 } })
    expect(result.current).toMatchObject({ collapsed: false, updated: false })

    act(() => result.current.collapse())
    expect(result.current).toMatchObject({ collapsed: true, updated: false })

    rerender({ v: 2 }) // the AI re-proposes: still collapsed, now "Updated"
    expect(result.current).toMatchObject({ collapsed: true, updated: true })
    act(() => result.current.collapse()) // a second send keeps the flag
    expect(result.current).toMatchObject({ collapsed: true, updated: true })

    act(() => result.current.toggle())
    expect(result.current).toMatchObject({ collapsed: false, updated: false })

    rerender({ v: 3 })
    act(() => result.current.toggle()) // collapsed by hand at v3: nothing newer yet
    expect(result.current).toMatchObject({ collapsed: true, updated: false })
  })
})

// Demo 7 follow-ups 3: the state lives in a session-level store keyed by card, so it survives the
// card's component unmounting (leaving the item) and mounting again (coming back).
describe('useProposalCollapse session store (demo 7 follow-ups 3)', () => {
  it('restores a collapsed card, and its collapsedAt version, after a remount with the same key', () => {
    const shared = new Map<string, number | null>()
    const wrapper = ({ children }: { children: ReactNode }) => <CollapseStoreProvider store={shared}>{children}</CollapseStoreProvider>
    const first = renderHook(({ v }) => useProposalCollapse('summary:st_1', v), { initialProps: { v: 1 }, wrapper })
    act(() => first.result.current.collapse())
    first.unmount() // the user leaves the stage

    // The AI re-proposes while the user is away; coming back shows it collapsed and "Updated".
    const second = renderHook(({ v }) => useProposalCollapse('summary:st_1', v), { initialProps: { v: 2 }, wrapper })
    expect(second.result.current).toMatchObject({ collapsed: true, updated: true })
    act(() => second.result.current.toggle())
    second.unmount()

    const third = renderHook(() => useProposalCollapse('summary:st_1', 2), { wrapper })
    expect(third.result.current).toMatchObject({ collapsed: false, updated: false })
  })

  it('keeps each key separate', () => {
    const shared = new Map<string, number | null>()
    const wrapper = ({ children }: { children: ReactNode }) => <CollapseStoreProvider store={shared}>{children}</CollapseStoreProvider>
    const a = renderHook(() => useProposalCollapse('conclusion:t_1', 1), { wrapper })
    act(() => a.result.current.collapse())
    const b = renderHook(() => useProposalCollapse('conclusion:t_2', 1), { wrapper })
    expect(b.result.current.collapsed).toBe(false)
  })

  it('starts expanded again after a remount without a store (no provider: component-local, as before)', () => {
    const first = renderHook(() => useProposalCollapse('conclusion:t_1', 1))
    act(() => first.result.current.collapse())
    first.unmount()
    const second = renderHook(() => useProposalCollapse('conclusion:t_1', 1))
    expect(second.result.current.collapsed).toBe(false)
  })
})
