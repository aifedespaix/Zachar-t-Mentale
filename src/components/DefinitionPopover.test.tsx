// src/components/DefinitionPopover.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DefinitionPopover } from './DefinitionPopover'

describe('DefinitionPopover', () => {
  it('shows the definition text once opened', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover definition="Une définition" locked={false} onCommit={() => {}} />)

    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    expect(screen.getByText('Une définition')).toBeInTheDocument()
  })

  it('opens an editable field when the definition text is clicked, and commits on Enter', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover definition="Une définition" locked={false} onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Une définition'))
    const field = screen.getByRole('textbox', { name: /définition/i })
    await user.clear(field)
    await user.type(field, 'Nouvelle définition{Enter}')

    expect(onCommit).toHaveBeenCalledWith('Nouvelle définition')
  })

  it('does not open the definition for editing when the mind map is locked', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover definition="Une définition" locked onCommit={() => {}} />)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Une définition'))

    expect(screen.queryByRole('textbox', { name: /définition/i })).not.toBeInTheDocument()
  })

  it('cancels the edit on Escape without calling onCommit', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover definition="Une définition" locked={false} onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Une définition'))
    await user.type(screen.getByRole('textbox', { name: /définition/i }), ' texte annulé{Escape}')

    expect(onCommit).not.toHaveBeenCalled()
  })
})
