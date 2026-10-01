import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
let tdm = ''
let home = ''
let proj = ''
let tmpDir = ''

function run(args: string[], input = ''): string {
  return execFileSync(tdm, args, {
    cwd: proj,
    env: { ...process.env, TANDEM_HOME: home, TANDEM_NO_BROWSER: '1', TANDEM_SESSION: '' },
    input,
    encoding: 'utf8',
  })
}

test.beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tandem-web-e2e-'))
  tdm = join(tmpDir, 'tdm')
  home = join(tmpDir, 'home')
  proj = join(tmpDir, 'proj')
  execFileSync('go', ['build', '-o', tdm, './cmd/tdm'], { cwd: repoRoot, stdio: 'inherit' })
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'Repo.kt'), 'class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n')
})

test.afterAll(() => {
  run(['daemon', 'stop'])
  rmSync(tmpDir, { recursive: true, force: true })
})

test('agent and user complete a thread through the page', async ({ page }) => {
  const url = run(['session', 'new', 'Implement idea ABC']).trim().split(' ')[1]
  run(['stage', 'add', 'Data model'])
  run(['thread', 'add', 'Repository layer'])
  run(['block', 'add', 'note', '--text', 'The repository isolates **storage**.'])
  run(['block', 'add', 'file', '--path', 'src/Repo.kt'])
  run(['annotate', 'b_2', '--lines', '3', 'Nullable because the cache is lazy.'])
  run(['block', 'add', 'variants', '--input', '-'], '{"options":[{"title":"Empty map"},{"title":"Lazy delegate"}]}')

  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Repository layer' })).toBeVisible()
  await expect(page.getByText('Nullable because the cache is lazy.')).toBeVisible()
  await expect(page.getByText('AI is working…')).toBeVisible()

  // Line comment into the draft (click a line number, press c)
  await page.getByRole('button', { name: 'Line 3', exact: true }).click()
  await page.keyboard.press('c')
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Why not an empty map?')
  await page.getByRole('button', { name: 'Save to draft' }).click()
  await expect(page.getByRole('button', { name: 'Send to AI · 1' })).toBeEnabled()

  // Selecting a variant just marks it pending; Send choice confirms it, together with the draft
  const lazy = page.locator('[data-option="o_2"]')
  await lazy.getByRole('button', { name: 'Choose' }).click()
  await expect(lazy.getByRole('button', { name: 'Selected' })).toBeVisible()
  await page.getByRole('button', { name: 'Send choice' }).click()
  await expect(lazy.getByText('Chosen')).toBeVisible()
  // Follow-ups A: the draft went as its own send (a review before the choice), headed "1 line comment"
  await expect(page.getByRole('button', { name: '1 line comment' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send to AI · 0' })).toBeDisabled()

  const first = run(['wait', '--timeout', '5s'])
  // Spec §13.6: `tdm wait` output must match the golden `render.Fence`/`render.Quote` shape —
  // header, language-tagged fence, the commented source line verbatim, closing fence, quote.
  expect(first).toContain(
    'Comment on b_2, `src/Repo.kt:3`:\n' +
      '```kotlin\n' +
      '    val cache: Map<String, User>? = null\n' +
      '```\n' +
      '> Why not an empty map?\n',
  )
  expect(first).toContain('Chose o_2 "Lazy delegate" (block b_3).')

  // The agent's conclusion arrives live over SSE; accept it with the keyboard
  run(['conclude', 'Keep the repository; use a lazy delegate.'])
  const card = page.getByRole('region', { name: 'Proposed conclusion' })
  await expect(card).toContainText('Keep the repository; use a lazy delegate.')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('a')

  // Task 12b: accepting a conclusion auto-advances the page (here, to the thread's stage,
  // since it's the only thread). The nav item for the thread shows the resolved icon.
  await expect(page.getByRole('heading', { level: 1, name: 'Data model' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Repository layer' })).toHaveClass(/is-resolved/)
  expect(run(['wait', '--timeout', '5s'])).toContain('conclusion accepted')

  // Navigate back to the thread and confirm it now shows the accepted conclusion, under the
  // title and above the first block (resolve feedback 1).
  await page.getByRole('button', { name: 'Repository layer' }).click()
  const conclusion = page.getByRole('region', { name: 'Conclusion' })
  await expect(conclusion).toContainText('Keep the repository; use a lazy delegate.')
  const [conclusionBox, firstBlockBox] = await Promise.all([conclusion.boundingBox(), page.locator('#b_1').boundingBox()])
  expect(conclusionBox!.y).toBeLessThan(firstBlockBox!.y)

  // Export copies the decision document
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.getByText('Decision document copied to the clipboard.')).toBeVisible()

  // Resolve feedback 3: ending the session confirms with a toast once the request succeeds
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'End session' }).click()
  await expect(page.getByText('✓ Session ended')).toBeVisible()
  await expect(page.getByRole('button', { name: 'End session' })).toHaveCount(0)
})

test('draft-only Send, id chips, and an edited stage summary', async ({ page }) => {
  const url = run(['session', 'new', 'Storage decisions']).trim().split(' ')[1]
  run(['stage', 'add', 'Storage'])
  run(['thread', 'add', 'Event log'])
  run(['block', 'add', 'code', '--lang', 'go', '--text', 'type Event struct{}\n'])
  run(['thread', 'add', 'Blobs'])
  run(['say', '--thread', 't_2', 'Blobs are referenced from t_1.'])

  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Event log' })).toBeVisible()

  // Follow-up 3: draft comments alone enable the composer's Send, which sends only them
  await page.getByRole('button', { name: 'Line 1', exact: true }).click()
  await page.keyboard.press('c')
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Why a struct?')
  await page.getByRole('button', { name: 'Save to draft' }).click()
  const send = page.getByRole('button', { name: 'Send (1 comment)' })
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByRole('button', { name: '1 line comment' })).toBeVisible()
  const sent = run(['wait', '--timeout', '5s'])
  expect(sent).toContain('Comment on b_1, lines 1:')
  expect(sent).toContain('> Why a struct?')

  // Follow-up 4: the agent's t_1 shows as a chip with the thread's title; a click opens that thread
  await page.getByRole('button', { name: 'Blobs' }).click()
  const chip = page.getByRole('link', { name: 'Event log' })
  await expect(chip).toHaveAttribute('title', 'id: t_1')
  await chip.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Event log' })).toBeVisible()

  // Resolve both threads in one click each; the page lands on the stage, which waits for the summary (follow-up 5)
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Blobs' })).toBeVisible()
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Storage' })).toBeVisible()
  expect(run(['wait', '--timeout', '5s'])).toContain('conclusion edited and accepted')
  await expect(page.getByRole('status', { name: "All threads resolved — waiting for the AI's stage summary." })).toBeVisible()

  // Part C: Edit → Save replaces the proposed summary and keeps it proposed; Accept summary then
  // accepts it, and the agent and the export get the user's text.
  // The proposed text is long, so the Edit editor should open tall enough to show it all
  // (auto-grow), not the default 3-row textarea.
  const longSummary = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1} of the proposed stage summary.`).join(' ')
  run(['stage', 'propose', longSummary])
  const proposed = page.getByRole('region', { name: 'Proposed stage summary' })
  await expect(proposed).toContainText(longSummary)
  await proposed.getByRole('button', { name: 'Edit' }).click()
  const editBox = page.getByRole('textbox', { name: 'Edit summary' })
  await expect(editBox).toHaveValue(longSummary)
  await expect
    .poll(() => editBox.evaluate((el: HTMLTextAreaElement) => el.getBoundingClientRect().height))
    .toBeGreaterThan(100)
  await editBox.fill('Events go to a JSONL log; blobs are content-addressed.')
  await proposed.getByRole('button', { name: 'Save' }).click()
  await expect(proposed.getByText('edited by you')).toBeVisible()
  await expect(proposed).toContainText('Events go to a JSONL log; blobs are content-addressed.')
  expect(run(['wait', '--timeout', '5s'])).toContain(
    '## Stage summary — edited\n\nYour proposal was replaced with:\n> Events go to a JSONL log; blobs are content-addressed.\n',
  )
  await proposed.getByRole('button', { name: 'Accept summary' }).click()
  await expect(page.getByText('Stage summary', { exact: true })).toBeVisible()
  expect(run(['wait', '--timeout', '5s'])).toContain('## Stage summary — accepted\n\nAccepted as proposed.\n')
  expect(run(['export'])).toContain('## 1. Storage\nEvents go to a JSONL log; blobs are content-addressed.')
})

// Follow-up 1: at the bottom of a long thread, opening the Resolve note editor (`c` or Add note)
// scrolls it fully into view, its Resolve and Cancel buttons included, clear of the sticky composer.
test('the Resolve note editor opens clear of the sticky composer', async ({ page }) => {
  const url = run(['session', 'new', 'Long threads']).trim().split(' ')[1]
  run(['stage', 'add', 'Scrolling'])
  for (const title of ['By key', 'By button']) {
    run(['thread', 'add', title])
    for (let i = 1; i <= 12; i++) run(['block', 'add', 'note', '--text', `Paragraph ${i} of a long thread. `.repeat(8)])
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'By key' })).toBeVisible()

  const scrollToBottom = async () => {
    await page.locator('.main').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect(page.getByRole('button', { name: 'Add note' })).toBeInViewport()
  }
  // Each button must lie inside the viewport, above the composer, and be the element hit at its center.
  const expectButtonsClear = async () => {
    const editor = page.getByRole('region', { name: 'Resolve thread' })
    await expect(editor.getByRole('textbox')).toBeFocused()
    for (const name of ['Resolve', 'Cancel']) {
      const button = editor.getByRole('button', { name, exact: true })
      await expect
        .poll(() =>
          button.evaluate((b) => {
            const r = b.getBoundingClientRect()
            const composerTop = document.querySelector('.composer')!.getBoundingClientRect().top
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            return r.top >= 0 && r.bottom <= Math.min(window.innerHeight, composerTop) && !!hit && b.contains(hit)
          }),
        )
        .toBe(true)
    }
  }

  await scrollToBottom()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('c')
  await expectButtonsClear()

  // The same with reduced motion (an instant scroll instead of a smooth one).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'By button' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'By button' })).toBeVisible()
  await scrollToBottom()
  await page.getByRole('button', { name: 'Add note' }).click()
  await expectButtonsClear()
})

// A file block loads its text after mount, so on a return the thread is still short when its
// saved scroll position is restored: the position must be re-applied once the text has loaded.
test('returning to a thread restores its scroll position after its file block loads', async ({ page }) => {
  writeFileSync(
    join(proj, 'src', 'Long.kt'),
    Array.from({ length: 160 }, (_, i) => `val line${i + 1} = ${i + 1}`).join('\n') + '\n',
  )
  const url = run(['session', 'new', 'Scroll restore']).trim().split(' ')[1]
  run(['stage', 'add', 'Restore'])
  run(['thread', 'add', 'Short'])
  run(['block', 'add', 'note', '--text', 'A short thread.'])
  run(['thread', 'add', 'Long file'])
  run(['block', 'add', 'note', '--text', 'A thread with a long file.'])
  run(['block', 'add', 'file', '--path', 'src/Long.kt'])
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url)
  await page.getByRole('button', { name: 'Long file' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Long file' })).toBeVisible()
  await expect(page.getByText('val line160 = 160')).toBeAttached()

  const main = page.locator('.main')
  await main.evaluate((el) => (el.scrollTop = 1000))
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(1000)
  await page.getByRole('button', { name: 'Short' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Short' })).toBeVisible()
  await page.getByRole('button', { name: 'Long file' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Long file' })).toBeVisible()
  await expect(page.getByText('val line160 = 160')).toBeAttached()
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(1000)
})

// Question message spec: answer with a button, with a key and with Other…; chips for o_N and
// q_N; a withdrawn question; the nav dot while a question is open.
test('questions answered with a button, a key and Other', async ({ page }) => {
  const url = run(['session', 'new', 'Log format']).trim().split(' ')[1]
  run(['stage', 'add', 'Storage'])
  run(['thread', 'add', 'Storage format'])
  expect(run(['ask', 'Must old logs stay readable?', '--option', 'Yes', '--option', 'No'])).toBe('q_1 o_1 o_2\n')

  await page.goto(url)
  const q1 = page.locator('[data-question="q_1"]')
  await expect(q1).toContainText('Must old logs stay readable?')
  await expect(page.getByLabel('question awaiting you')).toBeVisible()

  // A button answers at once; the buttons go, the muted answer and the Answered message show
  await q1.getByRole('button', { name: 'No', exact: true }).click()
  await expect(q1).toContainText('Answer: No')
  await expect(q1.getByRole('button')).toHaveCount(0)
  await expect(page.locator('.msg-user').filter({ hasText: 'AnsweredNo' })).toBeVisible()
  await expect(page.getByLabel('question awaiting you')).toHaveCount(0)
  expect(run(['wait', '--timeout', '5s'])).toContain(
    '## t_1 "Storage format" — question answered\n\nAnswered q_1 "Must old logs stay readable?": o_2 "No".\n',
  )

  // The agent refers to the answer and the question by id: both are chips
  run(['say', 'Since o_2 on q_1, we drop the v0 reader.'])
  await expect(page.getByRole('link', { name: 'No', exact: true })).toHaveAttribute('title', 'id: o_2')
  await expect(page.locator('.msg-ai').getByRole('link', { name: 'Must old logs stay readable?' })).toHaveAttribute('title', 'id: q_1')

  // Keys 1–4 pick a button when focus is not in a text field
  expect(run(['ask', 'Keep JSONL?', '--option', 'Yes', '--option', 'No'])).toBe('q_2 o_3 o_4\n')
  const q2 = page.locator('[data-question="q_2"]')
  await expect(q2.getByRole('button', { name: 'Yes', exact: true })).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('1')
  await expect(q2).toContainText('Answer: Yes')
  expect(run(['wait', '--timeout', '5s'])).toContain('Answered q_2 "Keep JSONL?": o_3 "Yes".')

  // Other… swaps the buttons for a one-line input; Enter sends
  run(['ask', 'Which field holds the version?', '--option', 'v', '--option', 'version'])
  const q3 = page.locator('[data-question="q_3"]')
  await q3.getByRole('button', { name: 'Other…' }).click()
  await expect(q3.getByRole('button', { name: 'version', exact: true })).toHaveCount(0)
  await q3.getByRole('textbox', { name: 'Your answer' }).fill('schemaVersion')
  await page.keyboard.press('Enter')
  await expect(q3).toContainText('Answer: "schemaVersion"')
  expect(run(['wait', '--timeout', '5s'])).toContain(
    'Answered q_3 "Which field holds the version?" with their own answer:\n> schemaVersion\n',
  )

  // A withdrawn question loses its buttons
  run(['ask', 'Compress old logs?', '--option', 'Yes', '--option', 'No'])
  const q4 = page.locator('[data-question="q_4"]')
  await expect(q4.getByRole('button', { name: 'Yes', exact: true })).toBeVisible()
  expect(run(['ask', '--withdraw', 'q_4'])).toBe('q_4\n')
  await expect(q4).toContainText('Withdrawn')
  await expect(q4.getByRole('button')).toHaveCount(0)
})

// Demo 6 follow-ups, through the real daemon and CLI: the Answered message is muted until
// `tdm wait` delivers it, and its header jumps back to the question, which lights up on every click.
test('an answer shows its delivery and links back to its question', async ({ page }) => {
  const url = run(['session', 'new', 'Cache design']).trim().split(' ')[1]
  run(['stage', 'add', 'Caching'])
  run(['thread', 'add', 'User cache'])
  expect(run(['ask', 'Cache user lookups too?', '--option', 'Yes', '--option', 'No'])).toBe('q_1 o_1 o_2\n')

  await page.goto(url)
  const q1 = page.locator('[data-question="q_1"]')
  await q1.getByRole('button', { name: 'Yes', exact: true }).click()

  // Muted until the agent picks it up, then the normal style
  const answer = page.locator('.msg-user').filter({ hasText: 'AnsweredYes' })
  await expect(answer).toHaveClass(/is-undelivered/)
  expect(run(['wait', '--timeout', '5s'])).toContain('Answered q_1 "Cache user lookups too?": o_1 "Yes".')
  await expect(answer).not.toHaveClass(/is-undelivered/)

  // The header jumps to the question and highlights it; the highlight clears and plays again
  const header = answer.getByRole('link', { name: 'Cache user lookups too?' })
  await expect(header).toHaveAttribute('href', '#q_1')
  await header.click()
  await expect(q1).toHaveClass(/is-jump-target/)
  await expect(page).toHaveURL(/#t_1$/)
  await expect(q1).not.toHaveClass(/is-jump-target/)
  await header.click()
  await expect(q1).toHaveClass(/is-jump-target/)
})

test('dragging across line numbers and long-pressing the text select a line range', async ({ page }) => {
  const url = run(['session', 'new', 'Line drag']).trim().split(' ')[1]
  run(['stage', 'add', 'Drag'])
  run(['thread', 'add', 'Selecting lines'])
  run(['block', 'add', 'file', '--path', 'src/Repo.kt'])
  await page.goto(url)
  const row = (n: number) => page.locator(`.code-row[data-line="${n}"]`)
  const box = async (n: number, sel: string) => (await row(n).locator(sel).boundingBox())!

  const from = await box(2, '.ln')
  const to = await box(4, '.ln')
  await page.mouse.move(from.x + 5, from.y + 5)
  await page.mouse.down()
  await page.mouse.move(to.x + 5, to.y + 5, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.code-row.is-selected')).toHaveCount(3)
  await expect(row(2)).toHaveClass(/is-selected/)
  await expect(row(4)).toHaveClass(/is-selected/)

  await page.getByRole('button', { name: 'Line 1', exact: true }).click()
  await expect(page.locator('.code-row.is-selected')).toHaveCount(1)

  const src = await box(2, '.src')
  await page.mouse.move(src.x + 10, src.y + 5)
  await page.mouse.down()
  await page.waitForTimeout(450)
  const src3 = await box(3, '.src')
  await page.mouse.move(src3.x + 10, src3.y + 5, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.code-row.is-selected')).toHaveCount(2)
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
})

test('notes on selected text in a code block and a chat message', async ({ page }) => {
  const url = run(['session', 'new', 'Text notes']).trim().split(' ')[1]
  run(['stage', 'add', 'Notes'])
  run(['thread', 'add', 'Selecting text'])
  run(['block', 'add', 'file', '--path', 'src/Repo.kt'])
  run(['say', 'The cache is built lazily on first use.'])
  await page.goto(url)
  await expect(page.locator('.code-row[data-line="3"]')).toBeVisible()

  // Select text the way a user would leave it, then release the mouse.
  const select = (rowSel: string, needle: string) =>
    page.evaluate(
      ([rowSel, needle]) => {
        const el = document.querySelector(rowSel)!
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const nodes: Text[] = []
        for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text)
        const flat = nodes.map((n) => n.data).join('')
        const at = flat.indexOf(needle)
        const point = (i: number): [Text, number] => {
          for (const n of nodes) {
            if (i <= n.data.length) return [n, i]
            i -= n.data.length
          }
          throw new Error('out of range')
        }
        const r = document.createRange()
        r.setStart(...point(at))
        r.setEnd(...point(at + needle.length))
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      },
      [rowSel, needle],
    )

  await select('.code-row[data-line="3"] .src', 'Map<String, User>?')
  await expect(page.locator('.tn-pill')).toBeVisible()
  await page.keyboard.press('c')
  const editor = page.getByRole('dialog', { name: 'Note on selection' })
  await expect(editor.locator('.tn-quote')).toHaveText('Map<String, User>?')
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Why nullable?')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(editor).toBeHidden()

  // Saved: a 💬 badge on line 3; hovering it shows the card with Edit and Remove.
  const badge = page.locator('.code-row[data-line="3"] .tn-badge')
  await badge.hover()
  const card = page.getByRole('dialog', { name: 'Note' })
  await expect(card).toContainText('Why nullable?')
  await expect(card.getByRole('button', { name: 'Edit draft note' })).toBeVisible()

  await select('[data-tn-msg] [data-tn-text]', 'built lazily')
  await page.locator('.tn-pill').click()
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('How lazily?')
  await page.getByRole('button', { name: /Save to draft/ }).click()
  await expect(page.locator('.msg-ai-wrap .tn-badge')).toBeVisible()

  await page.getByRole('button', { name: 'Send (2 comments)' }).click()
  await expect(page.getByRole('button', { name: '2 comments' })).toBeVisible()
  const out = run(['wait', '--timeout', '5s'])
  expect(out).toContain(
    'Comment on b_1, `src/Repo.kt:3`:\n' +
      '```kotlin\n' +
      'Map<String, User>?\n' +
      '```\n' +
      '> Why nullable?\n',
  )
  expect(out).toContain('Comment on message 5:\n```text\nbuilt lazily\n```\n> How lazily?\n')
  // Sent notes keep their badge; the card has no draft actions.
  await page.locator('.code-row[data-line="3"] .tn-badge').hover()
  await expect(page.getByRole('dialog', { name: 'Note' })).toContainText('Why nullable?')
  await expect(page.getByRole('button', { name: 'Edit draft note' })).toHaveCount(0)
})
