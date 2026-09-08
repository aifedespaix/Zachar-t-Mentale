import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SaveFailedDialog } from './SaveFailedDialog'

describe('SaveFailedDialog', () => {
  it('offers the choice when there is something to continue to', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(
      <SaveFailedDialog
        message="La sauvegarde a échoué : disque plein"
        continueLabel="Quitter quand même"
        onCancel={vi.fn()}
        onContinue={onContinue}
      />
    )

    expect(screen.getByText(/Continuer maintenant perdra ce changement/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Quitter quand même' }))

    expect(onContinue).toHaveBeenCalled()
  })

  it('is an acknowledgement, not a choice, when nothing can be continued to', async () => {
    // A window that refuses to close: offering « Quitter quand même » there
    // gives the user a button whose only possible outcome is failing again,
    // which reads exactly like the button doing nothing.
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <SaveFailedDialog
        message="Impossible de fermer la fenêtre : window.destroy not allowed"
        detail="Vos modifications sont enregistrées."
        continueLabel={null}
        onCancel={onCancel}
        onContinue={null}
      />
    )

    expect(screen.getByText('Vos modifications sont enregistrées.')).toBeInTheDocument()
    expect(screen.queryByText(/perdra ce changement/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quand même/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fermer ce message' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
