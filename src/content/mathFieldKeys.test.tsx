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
  onEnterBlock?: () => void
  onEmptyBackspace?: () => void
  onEmptyDelete?: () => void
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
  it('Entrée seule ajoute une ligne, Ctrl+Entrée demande un nouveau bloc', async () => {
    // Entrée écrit une ligne DANS le champ courant ; c'est Ctrl/Cmd+Entrée qui
    // garde le geste « un bloc de plus », comme partout ailleurs.
    const onEnter = vi.fn()
    const onEnterBlock = vi.fn()
    const field = await mountField({ onEnter, onEnterBlock })

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onEnterBlock).not.toHaveBeenCalled()

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onEnterBlock).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Entrée sans `onEnterBlock` — une cellule — ajoute une ligne', async () => {
    // Une cellule de tableau n'a pas de bloc à créer : la touche retombe sur le
    // geste « une ligne de plus ».
    const onEnter = vi.fn()
    const field = await mountField({ onEnter })

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onEnter).toHaveBeenCalledTimes(1)
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

  it('Suppr sur un champ vide demande la disparition vers le suivant', async () => {
    const onEmptyDelete = vi.fn()
    const field = await mountField({ onEmptyDelete })

    field.value = ''
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(onEmptyDelete).toHaveBeenCalledTimes(1)

    // Un champ NON vide garde la touche pour MathLive : Suppr y efface le
    // caractère à droite, il ne fait pas disparaître la ligne.
    field.value = 'x'
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(onEmptyDelete).toHaveBeenCalledTimes(1)
  })
})
