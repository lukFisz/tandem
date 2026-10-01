import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A file block in a git work tree shows its changes vs HEAD: gutter bars, the Changes switch and
// the diff modal.
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

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=tandem', '-c', 'user.email=tdm@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: proj, stdio: 'pipe' })

test.beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tandem-web-e2e-diff-'))
  tdm = join(tmpDir, 'tdm')
  home = join(tmpDir, 'home')
  proj = join(tmpDir, 'proj')
  execFileSync('go', ['build', '-o', tdm, './cmd/tdm'], { cwd: repoRoot, stdio: 'inherit' })
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'Repo.kt'), 'class Repo(\n    val db: Database,\n    val cache: Map<String, User>?\n    val log: Log,\n)\n')
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  // Line 1 added, line 3 modified, "val log" deleted outright (before line 5).
  writeFileSync(join(proj, 'src', 'Repo.kt'), '// Users.\nclass Repo(\n    val db: Db,\n    val cache: Map<String, User>?\n)\n')
})

test.afterAll(() => {
  run(['daemon', 'stop'])
  rmSync(tmpDir, { recursive: true, force: true })
})

test('changed lines vs HEAD: bars, the Changes switch and the diff modal', async ({ page }) => {
  const url = run(['session', 'new', 'Diff']).trim().split(' ')[1]
  run(['stage', 'add', 'Changes'])
  run(['thread', 'add', 'Changed file'])
  run(['block', 'add', 'file', '--path', 'src/Repo.kt'])
  await page.goto(url)

  const panel = page.locator('figure.code-panel').first()
  await expect(panel.getByLabel(/Changed since HEAD/)).toBeVisible()
  await expect(panel.locator('.code-row[data-line="1"] .gbar.is-add')).toBeVisible()
  await expect(panel.locator('.code-row[data-line="3"] .gbar.is-mod')).toBeVisible()
  await expect(panel.locator('.delmark')).toHaveCount(1)

  const sw = panel.getByRole('switch', { name: 'Changes' })
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(panel.locator('.code-row.is-ghost')).toHaveText(['−    val db: Database,', '−    val log: Log,'])
  await expect(panel.locator('.code-row[data-line]')).toHaveCount(5)

  // Line selection still works with ghosts in between.
  await page.getByRole('button', { name: 'Line 3', exact: true }).click()
  await page.keyboard.down('Shift')
  await page.getByRole('button', { name: 'Line 4', exact: true }).click()
  await page.keyboard.up('Shift')
  await expect(panel.locator('.code-row.is-selected')).toHaveCount(2)
  await page.keyboard.press('Escape')

  await panel.locator('.code-row[data-line="3"] .gbar').click()
  const dialog = page.getByRole('dialog', { name: 'Changes in src/Repo.kt' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.drow.is-flash')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Split' }).click()
  await expect(dialog.locator('.diff-split')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(sw).toHaveAttribute('aria-checked', 'true')
})
