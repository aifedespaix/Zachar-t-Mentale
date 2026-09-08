interface UpdateReadyBannerProps {
  onApply: () => void
  onDismiss: () => void
}

/**
 * A discreet, dismissible banner offering to restart into an already
 * fully-downloaded update. This component holds no state of its own —
 * `App.tsx` controls visibility via `useAppUpdater`'s `updateReady`/
 * `dismissed` flags, so dismissal survives this component unmounting and
 * remounting (e.g. when an unrelated error banner briefly takes its
 * place). Dismissing only hides the banner; the update is already
 * downloaded and installing it is still available via a future action.
 */
export function UpdateReadyBanner({ onApply, onDismiss }: UpdateReadyBannerProps) {
  return (
    <div role="status" className="status-banner status-banner--info">
      <span style={{ flex: 1 }}>Mise à jour prête</span>
      <button
        type="button"
        onClick={() => {
          void onApply()
        }}
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: 4,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 13,
          padding: '2px 8px',
        }}
      >
        Redémarrer
      </button>
      <button
        type="button"
        aria-label="Masquer le message de mise à jour"
        onClick={onDismiss}
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15 }}
      >
        ×
      </button>
    </div>
  )
}
