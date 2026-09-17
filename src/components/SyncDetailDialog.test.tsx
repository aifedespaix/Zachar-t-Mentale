import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SyncDetailDialog } from './SyncDetailDialog'

describe('SyncDetailDialog', () => {
  it('shows the summary and one line per fact', () => {
    render(
      <SyncDetailDialog
        summary="3 fichiers synchronisés, 1 non synchronisé"
        lines={['f1 : réseau coupé', 'conflit résolu : a.zmap']}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('3 fichiers synchronisés, 1 non synchronisé')).toBeInTheDocument()
    expect(screen.getByText('f1 : réseau coupé')).toBeInTheDocument()
    expect(screen.getByText('conflit résolu : a.zmap')).toBeInTheDocument()
  })

  it('says there is nothing to detail rather than showing an empty list', () => {
    render(
      <SyncDetailDialog summary="1 fichier synchronisé, 0 non synchronisé" lines={[]} onClose={vi.fn()} />
    )

    expect(screen.getByText(/rien à détailler/i)).toBeInTheDocument()
  })

  it('closes on the button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SyncDetailDialog summary="résumé" lines={['f1 : boum']} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(onClose).toHaveBeenCalled()
  })
})
