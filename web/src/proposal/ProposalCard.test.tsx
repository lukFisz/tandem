import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithCtx } from '../test/session'
import { EarlierProposal, ProposalCard } from './ProposalCard'

const TEXT = 'Use a lazy delegate. It is built on first use.'

function card(over: Partial<Parameters<typeof ProposalCard>[0]> = {}) {
  return (
    <ProposalCard
      label="Proposed conclusion"
      kicker="Proposed conclusion"
      text={TEXT}
      version={1}
      collapsed={false}
      updated={false}
      onToggle={() => {}}
      actions={<button type="button">Accept</button>}
      {...over}
    />
  )
}

describe('ProposalCard (stage summary flow spec, part D)', () => {
  it('shows the version from v2 on, the edited marker, and the actions and toggle in its header', () => {
    const { rerender } = renderWithCtx(card())
    const region = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(within(region).queryByText(/· v\d/)).toBeNull()
    expect(within(region).queryByText('edited by you')).toBeNull()
    expect(region).toHaveTextContent('It is built on first use.')

    rerender(card({ version: 3, editedByUser: true }))
    expect(within(region).getByText('· v3')).toBeInTheDocument()
    expect(within(region).getByText('edited by you')).toHaveClass('edited-by-you')
    const head = region.querySelector('.proposal-head') as HTMLElement
    expect(within(head).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(head).getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses to a one-line preview, keeps the actions, and shows Updated', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    renderWithCtx(card({ collapsed: true, updated: true, onToggle }))
    const region = screen.getByRole('region', { name: 'Proposed conclusion' })
    expect(region.querySelector('.proposal-preview-text')).toHaveTextContent(/^Use a lazy delegate\.$/)
    expect(region.querySelector('.prose')).toBeNull()
    expect(within(region).getByText('Updated')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    const toggle = within(region).getByRole('button', { name: 'Expand' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  // Demo 7 follow-ups 1: a preview that leaves text out ends with a muted, aria-hidden "(...)" of
  // its own, after the (clippable) sentence. The card's name is unchanged.
  it('ends a partial preview with "(...)", and a whole-text preview without it', () => {
    const { rerender } = renderWithCtx(card({ collapsed: true }))
    const region = screen.getByRole('region', { name: 'Proposed conclusion' })
    const preview = region.querySelector('.proposal-preview') as HTMLElement
    const more = preview.querySelector('.proposal-preview-more') as HTMLElement
    expect(more).toHaveTextContent('(...)')
    expect(more).toHaveAttribute('aria-hidden', 'true')
    expect(preview.lastElementChild).toBe(more)
    expect(preview.querySelector('.proposal-preview-text')).toHaveTextContent(/^Use a lazy delegate\.$/)

    rerender(card({ collapsed: true, text: 'Use a lazy delegate.' }))
    expect(region.querySelector('.proposal-preview-more')).toBeNull()
    expect(region.querySelector('.proposal-preview-text')).toHaveTextContent(/^Use a lazy delegate\.$/)
  })

  it('shows the editor instead of the text, even collapsed, and hides the toggle meanwhile', () => {
    renderWithCtx(card({ collapsed: true, actions: null, body: <textarea aria-label="Edit conclusion" /> }))
    expect(screen.getByRole('textbox', { name: 'Edit conclusion' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Expand|Collapse)$/ })).toBeNull()
    expect(document.querySelector('.proposal-preview')).toBeNull()
  })

  it('carries the landing target', () => {
    renderWithCtx(card({ land: 'proposed-summary' }))
    expect(screen.getByRole('region', { name: 'Proposed conclusion' })).toHaveAttribute('data-land', 'proposed-summary')
  })
})

// Demo 7 follow-ups 5: an accepted or resolved card keeps the toggle and preview, and nothing to act on.
describe('ProposalCard as a resolved card (demo 7 follow-ups 5)', () => {
  it('has the toggle and preview, but no actions, version, edited marker or Updated pill', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    renderWithCtx(
      card({ resolved: true, label: 'Conclusion', kicker: 'Conclusion', version: 3, editedByUser: true, updated: true, collapsed: true, onToggle }),
    )
    const region = screen.getByRole('region', { name: 'Conclusion' })
    expect(region).toHaveClass('conclusion', 'is-resolved', 'is-collapsed')
    expect(within(region).queryByText(/· v\d/)).toBeNull()
    expect(within(region).queryByText('edited by you')).toBeNull()
    expect(within(region).queryByText('Updated')).toBeNull()
    expect(within(region).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(region.querySelector('.proposal-preview-text')).toHaveTextContent(/^Use a lazy delegate\.$/)
    expect(region.querySelector('.proposal-preview-more')).toHaveTextContent('(...)')
    await user.click(within(region).getByRole('button', { name: 'Expand' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows its footer below the text, collapsed or not', () => {
    const footer = <p>Next: API</p>
    const { rerender } = renderWithCtx(card({ resolved: true, label: 'Stage summary', collapsed: true, footer }))
    const region = screen.getByRole('region', { name: 'Stage summary' })
    expect(within(region).getByText('Next: API')).toBeInTheDocument()
    rerender(card({ resolved: true, label: 'Stage summary', collapsed: false, footer }))
    expect(region).toHaveTextContent('It is built on first use.')
    expect(region.lastElementChild).toHaveTextContent('Next: API')
  })
})

describe('EarlierProposal', () => {
  it('is a closed "vN" entry, like a superseded block', () => {
    renderWithCtx(<EarlierProposal kicker="Proposed conclusion" version={1} text="Empty map." />)
    const entry = screen.getByText('Proposed conclusion · v1').closest('details') as HTMLElement
    expect(entry).toHaveClass('superseded')
    expect(entry).not.toHaveAttribute('open')
    expect(entry).toHaveTextContent('Empty map.')
  })
})
