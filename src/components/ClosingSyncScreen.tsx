import { AnimatedLogo } from './AnimatedLogo'

interface ClosingSyncScreenProps {
  /** L'avancement du run de fermeture, ou null tant qu'il n'a pas commencé. */
  progress: { done: number; total: number } | null
}

/**
 * Le plein écran affiché pendant la synchronisation de fermeture.
 *
 * Elle a lieu au moment le plus anxieux — l'utilisateur a cliqué sur « fermer »
 * et attend — donc elle doit dire ce qui se passe. Le logo rassure, la barre
 * répond à « ça avance ? », et l'écran entier couvre le reste : on ne veut pas
 * qu'un clic atterrisse dans un canevas en train d'être synchronisé.
 */
export function ClosingSyncScreen({ progress }: ClosingSyncScreenProps) {
  const ratio = progress === null || progress.total === 0 ? null : progress.done / progress.total

  return (
    <div
      role="status"
      aria-label="Synchronisation avant fermeture"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: 'var(--background)',
      }}
    >
      <AnimatedLogo mode="draw-pulse" size={120} />
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Synchronisation avant fermeture…</p>
      <p data-testid="closing-sync-label" style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>
        {progress === null ? 'Préparation…' : progress.done + ' / ' + progress.total}
      </p>
      <div
        style={{
          width: 240,
          height: 6,
          borderRadius: 999,
          background: 'var(--muted)',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid={ratio === null ? 'closing-sync-bar-indeterminate' : 'closing-sync-bar'}
          style={{
            width: ratio === null ? '100%' : Math.round(ratio * 100) + '%',
            height: '100%',
            background: 'var(--primary)',
            transition: 'width 200ms ease',
            opacity: ratio === null ? 0.4 : 1,
          }}
        />
      </div>
    </div>
  )
}
