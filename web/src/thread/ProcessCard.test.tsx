import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Process } from '../api/types'
import { ProcessCard, tailLines } from './ProcessCard'

const base: Process = {
  id: 'p_1',
  threadId: 't_1',
  pid: 9,
  cmd: 'go test ./internal/domain',
  status: 'running',
  seq: 4,
  startedAt: Date.now() - 4000,
}

describe('ProcessCard', () => {
  it('shows the output tail under the row only when there is one', () => {
    const { container, rerender } = render(<ProcessCard process={base} tail={'step 4\nstep 5\nstep 6'} />)
    expect(container.querySelector('pre.process-tail')).not.toBeNull()
    rerender(<ProcessCard process={base} />)
    expect(container.querySelector('.process-tail')).toBeNull()
  })

  it('renders one span per tail line, in order', () => {
    const { container } = render(<ProcessCard process={base} tail={'step 4\nstep 5\nstep 6\n'} />)
    const lines = [...container.querySelectorAll('pre.process-tail > .process-tail-line')].map((l) => l.textContent)
    expect(lines).toEqual(['step 4', 'step 5', 'step 6'])
  })

  it('keeps the nodes of surviving lines as the tail scrolls and adds only the new line', () => {
    const { container, rerender } = render(<ProcessCard process={base} tail={'a\nb\nc'} />)
    const before = [...container.querySelectorAll('.process-tail-line')]
    rerender(<ProcessCard process={base} tail={'b\nc\nd'} />)
    const after = [...container.querySelectorAll('.process-tail-line')]
    expect(after.map((l) => l.textContent)).toEqual(['b', 'c', 'd'])
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[2])
    expect(before).not.toContain(after[2])
  })

  it('keys repeated lines apart', () => {
    expect(tailLines('ok\nok\ndone').map((l) => l.key)).toEqual(['ok#0', 'ok#1', 'done#0'])
  })

  it('shows a running command with elapsed time', () => {
    const { container } = render(<ProcessCard process={base} />)
    expect(screen.getByText('go test ./internal/domain')).toBeInTheDocument()
    expect(screen.getByText(/running/)).toBeInTheDocument()
    expect(container.querySelector('.process-card')).toHaveClass('is-running')
  })

  it('shows a quiet success and a failed exit', () => {
    const { rerender, container } = render(
      <ProcessCard process={{ ...base, status: 'exited', exitCode: 0, exitedAt: base.startedAt + 4200 }} />,
    )
    expect(screen.getByText(/exit 0/)).toBeInTheDocument()
    expect(container.querySelector('.process-card')).toHaveClass('is-ok')
    rerender(<ProcessCard process={{ ...base, status: 'exited', exitCode: 1, exitedAt: base.startedAt + 4200 }} />)
    expect(screen.getByText(/exit 1/)).toBeInTheDocument()
    expect(container.querySelector('.process-card')).toHaveClass('is-fail')
  })

  it('shows an unknown exit code without a failure colour', () => {
    const { container } = render(
      <ProcessCard process={{ ...base, status: 'exited', exitCode: -1, exitedAt: base.startedAt + 4200 }} />,
    )
    expect(screen.getByText(/code unknown/)).toBeInTheDocument()
    expect(container.querySelector('.process-card')).toHaveClass('is-unknown')
  })
})
