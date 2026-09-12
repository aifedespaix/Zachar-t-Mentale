import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '../ui/tooltip'
import { MapTypeBadge } from './MapTypeBadge'

function show(type: string | undefined) {
  return render(
    <TooltipProvider>
      <MapTypeBadge type={type} />
    </TooltipProvider>
  )
}

describe('MapTypeBadge', () => {
  it('n’affiche rien pour default, une valeur absente ou vide', () => {
    expect(show(undefined).container).toBeEmptyDOMElement()
    expect(show('').container).toBeEmptyDOMElement()
    expect(show('default').container).toBeEmptyDOMElement()
  })

  it('affiche le libellé du type connu', () => {
    show('cours')
    expect(screen.getByTestId('map-type-badge')).toHaveTextContent('Cours')
  })

  it('affiche une pilule neutre avec le libellé BRUT pour une valeur inconnue', () => {
    show('futur')
    expect(screen.getByTestId('map-type-badge')).toHaveTextContent('futur')
  })

  it('nomme la pilule pour les technologies d’assistance', () => {
    show('exo')
    expect(screen.getByTestId('map-type-badge')).toHaveAttribute('aria-label', 'Exercices')
  })
})
