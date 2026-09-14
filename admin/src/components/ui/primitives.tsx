import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Les quelques briques d'interface partagées. Volontairement peu nombreuses et
 * sans dépendance : l'application de bureau a shadcn/Radix, celle-ci a six
 * composants, et en importer une bibliothèque entière pour ça pèserait plus
 * lourd que tout le reste du SPA — sur une connexion de téléphone, dans un
 * couloir.
 */

type ButtonTone = 'primary' | 'neutral' | 'ghost' | 'danger'

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-accent text-ink-950 hover:brightness-110 font-semibold',
  neutral: 'bg-ink-800 text-ink-100 hover:bg-ink-700',
  ghost: 'bg-transparent text-ink-300 hover:bg-ink-850 hover:text-ink-100',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
}

export function Button({
  tone = 'neutral',
  className = '',
  children,
  ...rest
}: { tone?: ButtonTone } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`tap inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]} ${className}`}
    >
      {children}
    </button>
  )
}

/** Un bouton carré pour une icône seule — la cible reste celle d'un doigt. */
export function IconButton({
  label,
  className = '',
  children,
  ...rest
}: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`tap grid w-11 shrink-0 place-items-center rounded-xl text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-300">{label}</span>
      {children}
      {error != null && error !== '' ? (
        <span className="mt-1.5 block text-sm text-danger">{error}</span>
      ) : hint !== undefined ? (
        <span className="mt-1.5 block text-xs text-ink-500">{hint}</span>
      ) : null}
    </label>
  )
}

export const inputClass =
  'tap w-full rounded-xl border border-ink-800 bg-ink-900 px-3.5 text-base text-ink-100 placeholder:text-ink-500 transition-colors focus:border-accent focus:outline-none'

/**
 * Un panneau qui monte du bas sur téléphone et se centre sur grand écran.
 *
 * Le bas de l'écran n'est pas un choix esthétique : c'est la seule zone qu'un
 * pouce atteint sans changer de prise. Les actions destructrices y sont donc
 * placées loin des autres, pas au bord.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Le fond ne doit pas défiler sous le panneau : sur iOS c'est le défaut, et
    // l'effet est qu'on « perd » la page derrière en refermant.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Le focus part dans le panneau, sinon la touche Tab continue de parcourir
    // la page cachée derrière.
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="animate-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-sheet relative flex max-h-[88vh] w-full flex-col rounded-t-3xl border border-ink-800 bg-ink-900 shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl"
      >
        <header className="flex items-center gap-2 border-b border-ink-850 px-4 py-3">
          {/* La poignée est décorative, mais elle dit « ça se ferme en tirant » —
              ce que personne ne devine d'un rectangle. */}
          <div className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-ink-700 sm:hidden" />
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
          <IconButton label="Fermer" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer !== undefined && (
          <footer className="safe-bottom border-t border-ink-850 px-4 pt-3">{footer}</footer>
        )}
      </div>
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-300',
    accent: 'bg-accent-soft/40 text-ink-100',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
    ok: 'bg-ok/15 text-ok',
  }
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-500" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-ink-700 border-t-accent" />
      {label !== undefined && <span>{label}</span>}
    </div>
  )
}

/**
 * Un état vide qui explique, plutôt qu'un écran blanc.
 *
 * Le premier écran d'une installation neuve est vide par nature : sans phrase,
 * il est indistinguable d'un écran cassé.
 */
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="text-ink-700">{icon}</div>
      <p className="font-medium text-ink-300">{title}</p>
      {hint !== undefined && <p className="max-w-sm text-sm text-ink-500">{hint}</p>}
    </div>
  )
}

/** Une bannière d'erreur qui reste lisible sans couper le reste de l'écran. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink-100">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry !== undefined && (
        <Button tone="neutral" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  )
}
