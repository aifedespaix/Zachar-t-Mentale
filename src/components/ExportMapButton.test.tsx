import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { ExportMapButton } from './ExportMapButton'
import type { Card } from '../types/card'

const CARDS: Card[] = [{ id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }]

describe('ExportMapButton', () => {
  it('opens the export dialog for the map on screen', async () => {
    const user = userEvent.setup()
    render(<ExportMapButton filePath="/cours/chapitre1.zmap" cards={CARDS} />)

    await user.click(screen.getByRole('button', { name: 'Exporter la carte mentale' }))

    expect(await screen.findByText('Exporter « chapitre1 »')).toBeInTheDocument()
  })

  it('is disabled, and says why, when no map is open', async () => {
    const user = userEvent.setup()
    render(<ExportMapButton filePath={null} cards={[]} />)

    const button = screen.getByRole('button', { name: 'Exporter (aucune carte ouverte)' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
