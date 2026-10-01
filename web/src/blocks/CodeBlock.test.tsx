import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent, within } from '@testing-library/react'
import { REPO_KT, fixtureSnapshot, renderStateful } from '../test/session'
import { CodeBlock } from './CodeBlock'
import { NoteBlock } from './NoteBlock'

const blocks = () => fixtureSnapshot().state.blocks

describe('CodeBlock', () => {
  it('shows a file snapshot with real line numbers, AI annotations and sent comments', async () => {
    const b2 = blocks().b_2
    const { ctx } = renderStateful(<CodeBlock block={b2} />)
    expect(await screen.findByText('Nullable because the cache is built lazily.')).toBeInTheDocument()
    expect(ctx.loadBlob).toHaveBeenCalledWith(b2.blobSha)
    expect(screen.getByRole('button', { name: 'src/Repo.kt' })).toBeInTheDocument()
    expect(screen.getByText('12–15 · kotlin')).toBeInTheDocument()
    expect(screen.getByText('AI · line 14')).toBeInTheDocument()
    expect(screen.getByText('Why not an empty map?')).toBeInTheDocument()
    expect(screen.getByText('You · line 14')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line 12' })).toBeInTheDocument()
  })

  it('highlights the hot line that carries a note', async () => {
    renderStateful(<CodeBlock block={blocks().b_2} />)
    await screen.findByText('Nullable because the cache is built lazily.')
    const line14 = screen.getByRole('button', { name: 'Line 14' }).closest('.code-row')
    const line12 = screen.getByRole('button', { name: 'Line 12' }).closest('.code-row')
    expect(line14).toHaveClass('has-note')
    expect(line12).not.toHaveClass('has-note')
  })

  it('selects a range, saves a draft comment, edits and removes it', async () => {
    const user = userEvent.setup()
    renderStateful(<CodeBlock block={blocks().b_2} />)
    await user.click(await screen.findByRole('button', { name: 'Line 13' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Line 14' }))
    await user.keyboard('{/Shift}')
    await user.click(screen.getByRole('button', { name: /Comment on lines 13–14/ }))
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Split this?')
    await user.click(screen.getByRole('button', { name: 'Save to draft' }))
    expect(screen.getByText('Split this?')).toBeInTheDocument()
    expect(screen.getByText('You · draft · lines 13–14')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit draft comment' }))
    const box = screen.getByRole('textbox', { name: 'Comment' })
    await user.clear(box)
    await user.type(box, 'Split it{Meta>}{Enter}{/Meta}')
    expect(screen.getByText('Split it')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove draft comment' }))
    expect(screen.queryByText('Split it')).toBeNull()
  })

  it('cancels the editor with Escape', async () => {
    const user = userEvent.setup()
    renderStateful(<CodeBlock block={blocks().b_2} />)
    await user.click(await screen.findByRole('button', { name: 'Line 12' }))
    await user.click(screen.getByRole('button', { name: /Comment on line 12/ }))
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'nope{Escape}')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('is not selectable when read-only or superseded', async () => {
    renderStateful(<CodeBlock block={blocks().b_2} />, { readOnly: true })
    await screen.findByText('Nullable because the cache is built lazily.')
    expect(screen.queryByRole('button', { name: 'Line 12' })).toBeNull()
  })

  it('renders inline code blocks and blob errors', async () => {
    renderStateful(<CodeBlock block={blocks().b_5} />)
    expect(screen.getByText('x := 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Line 1' })).toBeNull() // b_5 is superseded by b_6
    renderStateful(<CodeBlock block={blocks().b_2} />, { loadBlob: vi.fn(async () => Promise.reject(new Error('boom'))) })
    expect(await screen.findByText('Could not load src/Repo.kt: boom')).toBeInTheDocument()
  })

  it('opens the live file at the excerpt start when the path is clicked', async () => {
    const { ctx } = renderStateful(<CodeBlock block={blocks().b_2} />)
    await userEvent.click(await screen.findByRole('button', { name: 'src/Repo.kt' }))
    expect(ctx.openPath).toHaveBeenCalledWith('src/Repo.kt', 12)
  })

  it('expands into the block modal', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<CodeBlock block={blocks().b_2} />)
    await screen.findByText('Nullable because the cache is built lazily.')
    expect(container.querySelector('figure')).toHaveAttribute('id', 'b_2')
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    expect(ctx.expandBlock).toHaveBeenCalledWith('b_2')
  })

  it('renders without an id and with a Collapse button when expanded', async () => {
    const user = userEvent.setup()
    const { ctx, container } = renderStateful(<CodeBlock block={blocks().b_2} expanded />)
    await screen.findByText('Nullable because the cache is built lazily.')
    const figure = container.querySelector('figure')!
    expect(figure).not.toHaveAttribute('id')
    expect(figure).toHaveClass('is-expanded')
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(ctx.expandBlock).toHaveBeenCalledWith(null)
  })
})

// Repo.kt lines 12–15 vs HEAD: 12 added, 14 modified, one line deleted after 15.
const REPO_DIFF = [
  'diff --git a/src/Repo.kt b/src/Repo.kt',
  '--- a/src/Repo.kt',
  '+++ b/src/Repo.kt',
  '@@ -11,5 +11,5 @@',
  ' // repo',
  '+class Repo(',
  '     val db: Db,',
  '-    val cache: Map<String, User>?',
  '+    val cache: Map<String, User>? = null',
  ' )',
  '-// trailing',
  '',
].join('\n')

describe('CodeBlock changes vs HEAD', () => {
  const block = () => ({ ...blocks().b_2, diffSha: 'diff1' })
  const loadBlob = vi.fn(async (sha: string) => (sha === 'diff1' ? REPO_DIFF : REPO_KT))

  it('marks changed lines and shows the counts in the header', async () => {
    const { ctx } = renderStateful(<CodeBlock block={block()} />, { loadBlob })
    expect(await screen.findByLabelText('Changed since HEAD: 1 added, 1 modified, 1 deleted')).toHaveTextContent('+1~1−1')
    expect(ctx.loadBlob).toHaveBeenCalledWith('diff1')
    expect(screen.getByRole('button', { name: 'Added line, show the diff' }).closest('.code-row')).toHaveAttribute('data-line', '12')
    expect(screen.getByRole('button', { name: 'Modified line, show the diff' }).closest('.code-row')).toHaveAttribute('data-line', '14')
    expect(screen.getByRole('button', { name: '1 line deleted below, show the diff' }).closest('.code-row')).toHaveAttribute('data-line', '15')
    expect(screen.getByRole('switch', { name: 'Changes' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: 'Line 12' })).toBeInTheDocument()
  })

  it('renders as before without a diff', async () => {
    const { container } = renderStateful(<CodeBlock block={blocks().b_2} />)
    await screen.findByText('Nullable because the cache is built lazily.')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /show the diff/ })).toBeNull()
    expect(container.querySelector('.gbar')).toBeNull()
  })

  it('reveals deleted lines with the Changes switch, keeping selection and comments working', async () => {
    const user = userEvent.setup()
    const { container } = renderStateful(<CodeBlock block={block()} />, { loadBlob })
    const sw = await screen.findByRole('switch', { name: 'Changes' })
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    const ghosts = [...container.querySelectorAll('.code-row.is-ghost')].map((g) => g.textContent)
    expect(ghosts).toEqual(['−    val cache: Map<String, User>?', '−// trailing'])
    expect([...container.querySelectorAll('.code-row[data-line]')].map((r) => r.getAttribute('data-line'))).toEqual(['12', '13', '14', '15'])
    await user.click(screen.getByRole('button', { name: 'Line 13' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Line 14' }))
    await user.keyboard('{/Shift}')
    await user.click(screen.getByRole('button', { name: /Comment on lines 13–14/ }))
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Why nullable?')
    await user.click(screen.getByRole('button', { name: 'Save to draft' }))
    expect(screen.getByText('You · draft · lines 13–14')).toBeInTheDocument()
    // Keyboard: Space toggles it back.
    sw.focus()
    await user.keyboard(' ')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(container.querySelector('.is-ghost')).toBeNull()
  })

  it('keeps the switch per panel and shows it read-only too', async () => {
    renderStateful(
      <>
        <CodeBlock block={block()} />
        <CodeBlock block={block()} expanded />
      </>,
      { loadBlob, readOnly: true },
    )
    await screen.findAllByRole('switch')
    const [a, b] = screen.getAllByRole('switch', { name: 'Changes' })
    await userEvent.click(b)
    expect(a).toHaveAttribute('aria-checked', 'false')
    expect(b).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('button', { name: 'Line 12' })).toBeNull()
  })

  it('opens the diff modal on a clicked change, with layout and scope toggles', async () => {
    const user = userEvent.setup()
    renderStateful(<CodeBlock block={block()} />, { loadBlob })
    await user.click(await screen.findByRole('button', { name: 'Modified line, show the diff' }))
    const dialog = screen.getByRole('dialog', { name: 'Changes in src/Repo.kt' })
    expect(dialog).toHaveAttribute('open')
    const d = within(dialog)
    expect(d.getByText('working tree vs HEAD')).toBeInTheDocument()
    expect(d.getByText('+2')).toBeInTheDocument()
    expect(d.getByText('−2')).toBeInTheDocument()
    expect(d.getByText('@@ -11,5 +11,5 @@')).toBeInTheDocument()
    // The clicked change group flashes.
    expect([...dialog.querySelectorAll('.drow.is-flash')].map((r) => r.textContent)).toEqual([
      '13−    val cache: Map<String, User>?',
      '14+    val cache: Map<String, User>? = null',
    ])
    expect(d.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(d.getByRole('button', { name: 'Split' }))
    expect(dialog.querySelectorAll('.diff-split .diff-scroll')).toHaveLength(2)
    expect(dialog.querySelectorAll('.drow.is-blank')).toHaveLength(2)
    await user.click(d.getByRole('button', { name: 'Whole file' }))
    expect(dialog.querySelectorAll('.drow.is-excerpt').length).toBeGreaterThan(0)
    await user.click(d.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the whole diff from the Diff pill and closes it on Escape (cancel)', async () => {
    const user = userEvent.setup()
    renderStateful(<CodeBlock block={block()} />, { loadBlob })
    await user.click(await screen.findByRole('button', { name: 'Show the diff vs HEAD' }))
    const dialog = screen.getByRole('dialog', { name: 'Changes in src/Repo.kt' })
    expect(dialog.querySelector('.is-flash')).toBeNull()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('NoteBlock', () => {
  it('renders the note as prose', () => {
    const { container } = renderStateful(<NoteBlock block={blocks().b_1} />)
    expect(container.querySelector('strong')?.textContent).toBe('event log')
  })

  // Notes take comments like markdown: sections with their source lines, a gutter to select them.
  it('takes line comments on its sections', async () => {
    const user = userEvent.setup()
    const block = { ...blocks().b_1, text: 'First paragraph.\n\nSecond one.', lineCount: 3 }
    const { container } = renderStateful(<NoteBlock block={block} />)
    expect(container.querySelector('section.note')).toHaveAttribute('data-tn-block', 'b_1')
    expect([...container.querySelectorAll('.md-section')].map((s) => s.getAttribute('data-ls'))).toEqual(['1', '3'])
    await user.click(screen.getByRole('button', { name: 'Lines 3' }))
    await user.click(screen.getByRole('button', { name: /Comment on line 3/ }))
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Expand?')
    await user.click(screen.getByRole('button', { name: 'Save to draft' }))
    expect(screen.getByText('You · draft · line 3')).toBeInTheDocument()
  })

  it('has no gutter buttons when the block is read-only', () => {
    renderStateful(<NoteBlock block={blocks().b_1} />, { readOnly: true })
    expect(screen.queryByRole('button', { name: /Lines/ })).toBeNull()
  })
})
