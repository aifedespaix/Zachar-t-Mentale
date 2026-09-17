import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ClosingSyncScreen } from './ClosingSyncScreen'

describe('ClosingSyncScreen', () => {
  it('couvre l’écran et annonce la synchronisation de fermeture', () => {
    render(<ClosingSyncScreen progress={null} />)

    expect(screen.getByRole('status', { name: /fermeture/i })).toBeInTheDocument()
    expect(screen.getByText(/synchronisation avant fermeture/i)).toBeInTheDocument()
    expect(screen.getByText(/préparation/i)).toBeInTheDocument()
  })

  it('affiche l’avancement quand il est connu', () => {
    render(<ClosingSyncScreen progress={{ done: 3, total: 10 }} />)

    expect(screen.getByText('3 / 10')).toBeInTheDocument()
    expect(screen.getByTestId('closing-sync-bar')).toBeInTheDocument()
  })

  it('affiche une barre indéterminée tant que l’avancement est inconnu', () => {
    render(<ClosingSyncScreen progress={null} />)

    expect(screen.getByTestId('closing-sync-bar-indeterminate')).toBeInTheDocument()
  })
})
