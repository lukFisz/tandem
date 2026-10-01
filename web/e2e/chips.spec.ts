import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Block id chips in a real browser. jsdom has no layout, so jumps that depend on scroll positions
// (a chip's target must stay in view while content above it loads) can only be checked here.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
let tdm = ''
let home = ''
let proj = ''
let tmpDir = ''
let url = ''

function run(args: string[]): string {
  return execFileSync(tdm, args, {
    cwd: proj,
    env: { ...process.env, TANDEM_HOME: home, TANDEM_NO_BROWSER: '1', TANDEM_SESSION: '' },
    encoding: 'utf8',
  })
}

test.beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tandem-web-e2e-chips-'))
  tdm = join(tmpDir, 'tdm')
  home = join(tmpDir, 'home')
  proj = join(tmpDir, 'proj')
  execFileSync('go', ['build', '-o', tdm, './cmd/tdm'], { cwd: repoRoot, stdio: 'inherit' })
  mkdirSync(join(proj, 'internal', 'daemon'), { recursive: true })
  copyFileSync(join(repoRoot, 'internal', 'daemon', 'wait.go'), join(proj, 'internal', 'daemon', 'wait.go'))

  url = run(['session', 'new', 'Chips']).trim().split(' ')[1]
  run(['stage', 'add', 'Jumps'])
  run(['thread', 'add', 'Source'])
  run(['block', 'add', 'note', '--text', 'Intro note.'])
  // ~29 lines, fetched asynchronously by the page: it starts short and grows.
  run(['block', 'add', 'file', '--path', 'internal/daemon/wait.go', '--lines', '18-46'])
  run(['block', 'add', 'code', '--lang', 'go', '--text', 'type Old struct{}\n'])
  run(['block', 'add', 'code', '--lang', 'go', '--text', 'type New struct{}\n', '--supersedes', 'b_3'])
  run(['thread', 'add', 'Refs'])
  run(['say', '--thread', 't_2', 'Live: b_4. File: b_2. Old: b_3. Literal `b_1` and unknown b_99.'])
})

test.afterAll(() => {
  run(['daemon', 'stop'])
  rmSync(tmpDir, { recursive: true, force: true })
})

test.use({ viewport: { width: 1280, height: 795 } })

test('chip text: file name only, code language; backticked and unknown ids stay text', async ({ page }) => {
  await page.goto(`${url}#t_2`)
  const refs = page.locator('main')
  await expect(refs.getByRole('link', { name: 'wait.go:18-46' })).toBeVisible()
  await expect(refs.getByRole('link', { name: 'code (go)' })).toHaveCount(2)
  await expect(refs.locator('a.id-chip')).toHaveCount(3)
  await expect(refs.locator('code', { hasText: 'b_1' })).toBeVisible()
  await expect(refs.locator('a[href="#b_1"]')).toHaveCount(0)
  await expect(refs.locator('a[href="#b_99"]')).toHaveCount(0)
  await expect(refs.getByText('b_99')).toBeVisible()
})

test('chip to a superseded block scrolls to its collapsed row', async ({ page }) => {
  await page.goto(`${url}#t_2`)
  await page.locator('a.id-chip[href="#b_3"]').click()
  await expect(page).toHaveURL(/#t_1$/)
  const row = page.locator('[data-superseded="b_3"]')
  await expect(row).toBeInViewport()
  await expect(row).toHaveClass(/is-jump-target/)
})

test('chip jump stays on target while the file block above it grows', async ({ page }) => {
  await page.goto(`${url}#t_2`)
  const chip = page.locator('a.id-chip[href="#b_4"]')
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page).toHaveURL(/#t_1$/)
  // The file block's text arrives after the jump and pushes b_4 down; the jump must follow it.
  await expect(page.locator('#b_2 .code-row[data-line]')).toHaveCount(29)
  await expect(page.locator('#b_4')).toBeInViewport()
  await expect(page.locator('#b_4')).toHaveClass(/is-jump-target/)
})
