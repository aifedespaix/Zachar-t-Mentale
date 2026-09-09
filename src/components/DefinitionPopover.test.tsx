// src/components/DefinitionPopover.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DefinitionPopover } from './DefinitionPopover'
import type { CardBlock } from '../types/cardBlock'

// The editing contract these tests used to cover moved to the description
// dialog along with the behaviour itself — see `DescriptionDialog.test.tsx`.
// What is left here is what the popover still owns: showing a definition
// without letting its content move the box.

const text = (value: string): CardBlock[] => [{ kind: 'text', text: value }]

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
}

describe('DefinitionPopover', () => {
  it('shows the definition text once opened', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover blocks={text('Une définition')} locked={false} onEdit={() => {}} />)

    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
    await openPopover(user)
    expect(screen.getByText('Une définition')).toBeInTheDocument()
  })

  it('opens the editor rather than editing in place', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<DefinitionPopover blocks={text('Une définition')} locked={false} onEdit={onEdit} />)

    await openPopover(user)
    await user.click(screen.getByRole('button', { name: /modifier la définition/i }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    // The popover is a reading surface now: nothing in it is a field.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('offers no way to edit when the mind map is locked', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover blocks={text('Une définition')} locked onEdit={() => {}} />)

    await openPopover(user)

    expect(screen.getByText('Une définition')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /modifier la définition/i })).not.toBeInTheDocument()
  })

  it('keeps one fixed width whatever the content holds', async () => {
    // Règle anti-décalage 2: a formula, a table and a picture must all occupy
    // the same box, or opening two different cards moves the popover under the
    // pointer.
    const user = userEvent.setup()
    const { rerender } = render(<DefinitionPopover blocks={text('Court')} locked={false} onEdit={() => {}} />)
    await openPopover(user)
    const width = () => (screen.getByText(/définition/i).closest('[style*="width"]') as HTMLElement).style.width

    const short = width()
    rerender(
      <DefinitionPopover
        blocks={[{ kind: 'table', header: ['a', 'b', 'c'], rows: [['1', '2', '3']] }]}
        locked={false}
        onEdit={() => {}}
      />
    )
    expect(width()).toBe(short)
  })

  it('renders a formula as typeset markup rather than its LaTeX source', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover blocks={[{ kind: 'math', latex: '\\frac{1}{2}' }]} locked={false} onEdit={() => {}} />)
    await openPopover(user)
    expect(document.querySelector('.katex')).not.toBeNull()
  })

  it('renders an image through the resolver it is given', async () => {
    const user = userEvent.setup()
    render(
      <DefinitionPopover
        blocks={[{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 320, height: 240 }]}
        locked={false}
        onEdit={() => {}}
        resolveAsset={asset => `asset://localhost/${asset}`}
      />
    )
    await openPopover(user)

    expect(screen.getByRole('img', { name: 'Schéma' })).toHaveAttribute('src', 'asset://localhost/a1.png')
  })
})
