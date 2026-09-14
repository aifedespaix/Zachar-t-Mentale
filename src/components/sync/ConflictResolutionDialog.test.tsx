import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import type { SyncConflict } from '../../sync/syncService'

function conflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    fileId: 'file-1',
    path: 'Maths/Chapitre 1.zmap',
    localModified: '2026-02-01T10:00:00.000Z',
    remoteUpdated: '2026-02-01 12:00:00.000Z',
    detail: {
      localPath: '/cours/Maths/Chapitre 1.zmap',
      remotePath: 'Maths/Chapitre 1.zmap',
      remoteContent: '[]',
      remoteContentHash: 'empreinte',
      localCounts: { total: 7, byLevel: { 1: 1, 2: 3, 3: 2, 4: 0 }, detached: 1 },
      remoteCounts: { total: 5, byLevel: { 1: 1, 2: 2, 3: 2, 4: 0 }, detached: 0 },
    },
    ...overrides,
  }
}

/** Le trio de boutons, dans l'ordre où la boîte les propose. */
const ACCEPT = 'Accepter le changement'
const KEEP = 'Refuser et garder ma version'
const COPY = 'Créer une copie'

describe('ConflictResolutionDialog', () => {
  it('shows one conflict at a time, and says where it is in the queue', () => {
    render(
      <ConflictResolutionDialog
        conflicts={[conflict(), conflict({ fileId: 'file-2', path: 'Autre.zmap' })]}
        onResolve={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText(/Conflit 1 sur 2 — Chapitre 1/)).toBeInTheDocument()
    expect(screen.queryByText(/Autre/)).not.toBeInTheDocument()
  })

  it('counts the cards of each level on both sides, and signs the difference', () => {
    render(<ConflictResolutionDialog conflicts={[conflict()]} onResolve={vi.fn()} onApply={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('Cartes (total)')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    // L'écart : ce que l'utilisateur cherche vraiment quand il compare.
    expect(screen.getByText('(+2)')).toBeInTheDocument()
    expect(screen.getByText('Niveau 4')).toBeInTheDocument()
    // Les volantes ne s'affichent que lorsqu'il y en a.
    expect(screen.getByText('Cartes volantes')).toBeInTheDocument()
  })

  it('says nothing about floating cards when neither side has any', () => {
    const noFloating = conflict()
    noFloating.detail!.localCounts.detached = 0
    render(<ConflictResolutionDialog conflicts={[noFloating]} onResolve={vi.fn()} onApply={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Cartes volantes')).not.toBeInTheDocument()
  })

  it('flags a rename and a move, because that is not the same disagreement as a content one', () => {
    render(
      <ConflictResolutionDialog
        conflicts={[
          conflict({
            path: 'Archives/Chapitre 1 bis.zmap',
            detail: { ...conflict().detail!, remotePath: 'Maths/Chapitre 1.zmap' },
          }),
        ]}
        onResolve={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Nom différent')).toBeInTheDocument()
    expect(screen.getByText('Dossier différent')).toBeInTheDocument()
    expect(screen.getByText('Chapitre 1 bis.zmap')).toBeInTheDocument()
    expect(screen.getByText('Archives')).toBeInTheDocument()
  })

  it('flags nothing when both sides name the file the same way', () => {
    render(<ConflictResolutionDialog conflicts={[conflict()]} onResolve={vi.fn()} onApply={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Nom différent')).not.toBeInTheDocument()
    expect(screen.queryByText('Dossier différent')).not.toBeInTheDocument()
  })

  it('offers exactly the three issues, and hands the chosen one back', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn().mockResolvedValue(true)
    render(
      <ConflictResolutionDialog
        conflicts={[conflict(), conflict({ fileId: 'file-2' })]}
        onResolve={onResolve}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: ACCEPT }))
    expect(onResolve).toHaveBeenCalledWith('file-1', 'accept-remote')

    await user.click(screen.getByRole('button', { name: KEEP }))
    expect(onResolve).toHaveBeenCalledWith('file-1', 'keep-local')

    await user.click(screen.getByRole('button', { name: COPY }))
    expect(onResolve).toHaveBeenCalledWith('file-1', 'copy')
  })

  it('applies the decisions with one sync once the LAST conflict is decided', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const { rerender } = render(
      <ConflictResolutionDialog
        conflicts={[conflict(), conflict({ fileId: 'file-2' })]}
        onResolve={vi.fn().mockResolvedValue(true)}
        onApply={onApply}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: ACCEPT }))
    // Il en reste un : rien n'est appliqué, on enchaîne.
    expect(onApply).not.toHaveBeenCalled()

    rerender(
      <ConflictResolutionDialog
        conflicts={[conflict({ fileId: 'file-2' })]}
        onResolve={vi.fn().mockResolvedValue(true)}
        onApply={onApply}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/Conflit 2 sur 2/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: ACCEPT }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('stays on a conflict whose decision could not be recorded', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <ConflictResolutionDialog
        conflicts={[conflict()]}
        onResolve={vi.fn().mockResolvedValue(false)}
        onApply={onApply}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: ACCEPT }))

    expect(screen.getByRole('alert')).toHaveTextContent(/n’a pas pu être enregistrée/)
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/Conflit 1 sur 1/)).toBeInTheDocument()
  })

  it('« Plus tard » applies what was already decided rather than losing it', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const { rerender } = render(
      <ConflictResolutionDialog
        conflicts={[conflict(), conflict({ fileId: 'file-2' })]}
        onResolve={vi.fn().mockResolvedValue(true)}
        onApply={onApply}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: ACCEPT }))
    rerender(
      <ConflictResolutionDialog
        conflicts={[conflict({ fileId: 'file-2' })]}
        onResolve={vi.fn().mockResolvedValue(true)}
        onApply={onApply}
        onClose={onClose}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Plus tard' }))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('« Plus tard » on an untouched queue syncs nothing at all', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <ConflictResolutionDialog conflicts={[conflict()]} onResolve={vi.fn()} onApply={onApply} onClose={onClose} />
    )

    await user.click(screen.getByRole('button', { name: 'Plus tard' }))

    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('warns that an open map cannot be rewritten by a sync', () => {
    render(
      <ConflictResolutionDialog
        conflicts={[conflict()]}
        openFilePath="/cours/Maths/Chapitre 1.zmap"
        onResolve={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent(/fermez-la/)
  })

  it('refuses to decide on a conflict with no comparison to show', () => {
    render(
      <ConflictResolutionDialog
        conflicts={[conflict({ detail: undefined })]}
        onResolve={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/trop ancienne/)
    expect(screen.getByRole('button', { name: ACCEPT })).toBeDisabled()
    expect(screen.getByRole('button', { name: KEEP })).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY })).toBeDisabled()
  })

  it('says so, rather than showing an empty comparison, when the queue emptied under it', () => {
    render(<ConflictResolutionDialog conflicts={[]} onResolve={vi.fn()} onApply={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('Plus aucun conflit')).toBeInTheDocument()
  })
})
