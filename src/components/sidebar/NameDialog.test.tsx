import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NameDialog } from './NameDialog'

describe('NameDialog', () => {
  it('pre-fills the name field with the initial name, fully selected', () => {
    render(
      <NameDialog
        title="Nouvelle carte mentale"
        initialName="Nouvelle carte mentale"
        confirmLabel="Créer"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )

    const input = screen.getByRole('textbox', { name: 'Nouvelle carte mentale' }) as HTMLInputElement
    expect(input).toHaveValue('Nouvelle carte mentale')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Nouvelle carte mentale'.length)
  })

  it('confirms with the trimmed name on Enter', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NameDialog
        title="Dupliquer « Chapitre 3 »"
        initialName="Chapitre 3 (copie)"
        confirmLabel="Dupliquer"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    const input = screen.getByRole('textbox', { name: /dupliquer/i })
    await user.clear(input)
    await user.type(input, '  Ma copie  {Enter}')

    expect(onConfirm).toHaveBeenCalledWith('Ma copie')
  })

  it('confirms with the current name when the confirm button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NameDialog
        title="Nouveau sous-dossier"
        initialName="Nouveau dossier"
        confirmLabel="Créer"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(onConfirm).toHaveBeenCalledWith('Nouveau dossier')
  })

  it('disables the confirm button and refuses to submit an empty name', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NameDialog
        title="Nouvelle carte mentale"
        initialName="Nouvelle carte mentale"
        confirmLabel="Créer"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    const input = screen.getByRole('textbox', { name: 'Nouvelle carte mentale' })
    await user.clear(input)

    expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <NameDialog
        title="Nouvelle carte mentale"
        initialName="Nouvelle carte mentale"
        confirmLabel="Créer"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(onCancel).toHaveBeenCalled()
  })
})
