import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button'

interface CanvasErrorBoundaryProps {
  children: ReactNode
  /** Lets the app close the map that crashed instead of leaving a dead screen. */
  onClose: () => void
}

interface CanvasErrorBoundaryState {
  error: Error | null
}

/**
 * Last line of defence around the canvas.
 *
 * A render-time throw with no boundary above it unmounts the WHOLE React tree:
 * the map the user just opened flashes on screen and then everything vanishes,
 * with no message and only a console trace to explain it. `validateCards` is
 * what stops a malformed map from getting here in the first place; this turns
 * whatever still slips through into a contained, explained failure instead of a
 * blank window.
 */
export class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Échec du rendu de la carte mentale :', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
        <p style={{ margin: 0, fontWeight: 500 }}>Cette carte n’a pas pu être affichée.</p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-foreground)' }}>
          Son contenu est resté intact sur le disque. Fermez-la, puis rouvrez-la depuis la barre latérale
          pour lancer une réparation.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            this.setState({ error: null })
            this.props.onClose()
          }}
        >
          Fermer la carte
        </Button>
      </div>
    )
  }
}
