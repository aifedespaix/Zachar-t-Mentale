import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MathFieldEditor } from './MathFieldEditor'

// Même couture que MathFieldEditor.test.tsx : un `math-field` minimal, pour
// exercer le VRAI champ (et son écouteur clavier) sans le paquet MathLive.
vi.mock('mathlive', () => {
  if (!customElements.get('math-field')) {
    customElements.define(
      'math-field',
      class extends HTMLElement {
        #value = ''
        get value() {
          return this.#value
        }
        set value(next: string) {
          this.#value = next
        }
      }
    )
  }
  return {}
})

async function mountField(props: {
  onEnter?: () => void
  onEmptyBackspace?: () => void
}) {
  render(
    <MathFieldEditor
      latex="x^2"
      onChange={() => {}}
      ariaLabel="Formule"
      fallback={<textarea aria-label="Formule brute" value="x^2" readOnly />}
      {...props}
    />
  )
  const host = await waitFor(() => screen.getByTestId('math-field'))
  return (await waitFor(() => {
    const element = host.querySelector('math-field')
    if (element === null) throw new Error('le champ réel n’est pas encore monté')
    return element as HTMLElement
  })) as HTMLElement & { value: string }
}

describe('les touches du champ formule', () => {
  it('Entrée seule ajoute une ligne de formule, Ctrl+Entrée aussi', async () => {
    // Un champ formule n'a pas de « ligne » à écrire : Entrée seule y fait donc
    // directement ce que Ctrl/Cmd+Entrée fait ailleurs, sans qu'il faille tenir
    // une touche de modification pour l'obtenir.
    const onEnter = vi.fn()
    const field = await mountField({ onEnter })

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onEnter).toHaveBeenCalledTimes(2)
  })

  it('Maj+Entrée ne déclenche rien — MathLive garde la touche pour ses propres lignes', async () => {
    const onEnter = vi.fn()
    const field = await mountField({ onEnter })

    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('Retour arrière sur un champ vide demande la suppression du bloc', async () => {
    const onEmptyBackspace = vi.fn()
    const field = await mountField({ onEmptyBackspace })

    field.value = ''
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(onEmptyBackspace).toHaveBeenCalledTimes(1)
  })
})
