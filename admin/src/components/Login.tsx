import { useState } from 'react'
import { BrainCircuit, LogIn } from 'lucide-react'
import { login, LoginError, type AdminUser } from '@/lib/pb'
import { Button, Field, inputClass } from './ui/primitives'

/**
 * L'écran de connexion.
 *
 * Les mêmes comptes que l'application de bureau, par pseudo — il n'y a pas de
 * second annuaire, et c'est la seule conception défendable : un prof qui change
 * son mot de passe ne doit pas avoir à le faire deux fois.
 */
export function Login({ onSignedIn }: { onSignedIn: (user: AdminUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await login(username, password))
    } catch (caught) {
      setError(caught instanceof LoginError ? caught.message : 'La connexion a échoué.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft/30 text-accent">
            <BrainCircuit size={28} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Zachar’t Mentale</h1>
            <p className="mt-0.5 text-sm text-ink-500">Espace professeur</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Pseudo">
            <input
              value={username}
              onChange={event => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              className={inputClass}
            />
          </Field>

          <Field label="Mot de passe" error={error}>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </Field>

          <Button tone="primary" type="submit" disabled={busy} className="mt-1">
            <LogIn size={16} />
            {busy ? 'Connexion…' : 'Se connecter'}
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          Les comptes sont créés côté serveur&nbsp;:
          <br />
          <code className="text-ink-300">bun run infra/setup-pocketbase.mjs --add-user prof:prof</code>
        </p>
      </form>
    </div>
  )
}
