import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TypingBubble } from './TypingBubble'

const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')
const reduced = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join('\n')

describe('TypingBubble', () => {
  it('draws a decorative pixel diamond instead of a word, with the label for assistive tech', () => {
    const { container } = render(<TypingBubble />)
    const status = screen.getByRole('status', { name: 'AI is replying' })
    expect(status).toHaveTextContent('AI is replying')
    expect(status).not.toHaveTextContent('writing')
    const diamond = container.querySelector('.typing-diamond')
    expect(diamond).toHaveAttribute('aria-hidden', 'true')
    expect(diamond?.querySelectorAll('.px-grid > i')).toHaveLength(9)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('[class*="pong"]')).toBeNull()
  })

  it('animates with CSS only, pausing on a still frame under reduced motion', () => {
    const { container } = render(<TypingBubble />)
    expect(container.querySelectorAll('animate')).toHaveLength(0)
    expect(appCss).toMatch(/\.typing-diamond i\s*{[^}]*animation:\s*tdm-px/)
    expect(reduced).toMatch(/\.typing-diamond i\s*{\s*animation-play-state:\s*paused/)
  })

  it('shows the given text before the diamond', () => {
    const { container } = render(<TypingBubble text="Waiting for the summary" label="Waiting" />)
    const bubble = container.querySelector('.typing-bubble.has-text')!
    expect(bubble.firstElementChild).toHaveTextContent('Waiting for the summary')
    expect(bubble.lastElementChild).toHaveClass('typing-diamond')
  })

  it('says the AI went quiet in words, without the diamond', () => {
    const { container } = render(<TypingBubble quietMinutes={12} />)
    expect(screen.getByRole('status')).toHaveTextContent('AI quiet for 12m, it may have stopped')
    expect(container.querySelector('.typing-diamond')).toBeNull()
  })
})
