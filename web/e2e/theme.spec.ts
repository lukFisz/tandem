import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
let tdm = ''
let home = ''
let proj = ''
let tmpDir = ''

function run(args: string[]): string {
  return execFileSync(tdm, args, {
    cwd: proj,
    env: { ...process.env, TANDEM_HOME: home, TANDEM_NO_BROWSER: '1', TANDEM_SESSION: '' },
    encoding: 'utf8',
  })
}

test.beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tandem-web-e2e-theme-'))
  tdm = join(tmpDir, 'tdm')
  home = join(tmpDir, 'home')
  proj = join(tmpDir, 'proj')
  execFileSync('go', ['build', '-o', tdm, './cmd/tdm'], { cwd: repoRoot, stdio: 'inherit' })
  mkdirSync(proj, { recursive: true })
})

test.afterAll(() => {
  run(['daemon', 'stop'])
  rmSync(tmpDir, { recursive: true, force: true })
})

// Demo 7 "Style button": the theme persists across a reload, with no flash — the value is applied
// by index.html's inline script before React (or any stylesheet) runs.
test('theme persists across reload', async ({ page }) => {
  const url = run(['session', 'new', 'Theme check']).trim().split(' ')[1]
  const openMenu = () => page.getByRole('button', { name: 'Settings' }).click()

  await page.goto(url)
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')

  await openMenu()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // Before any click after the reload, the attribute must already be there (no flash).
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await openMenu()
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('menuitemradio', { name: 'System' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})
