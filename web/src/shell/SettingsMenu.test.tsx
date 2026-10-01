import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsMenu } from './SettingsMenu'

afterEach(() => vi.unstubAllGlobals())

describe('SettingsMenu', () => {
  it('shows the error of a rejected editor pick and keeps the previous pick', async () => {
    const settings = {
      editor: 'cursor',
      editors: [
        { id: 'cursor', name: 'Cursor', installed: true },
        { id: 'zed', name: 'Zed', installed: true },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? new Response('{"error":{"code":"invalid_input","message":"editor zed is not installed"}}', { status: 400 })
          : new Response(JSON.stringify(settings)),
      ),
    )
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Zed' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('editor zed is not installed')
    expect(screen.getByRole('menuitemradio', { name: 'Cursor' })).toHaveAttribute('aria-checked', 'true')
  })

  const stub = (settings: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(settings))))

  it('does not render editors that are not installed', async () => {
    stub({
      editor: 'cursor',
      editors: [
        { id: 'cursor', name: 'Cursor', installed: true },
        { id: 'zed', name: 'Zed', installed: false },
      ],
    })
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Cursor' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'Zed' })).toBeNull()
  })

  it('says so when no editor is installed', async () => {
    stub({ editor: '', editors: [{ id: 'zed', name: 'Zed', installed: false }] })
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('No editor detected')).toBeInTheDocument()
  })
})
