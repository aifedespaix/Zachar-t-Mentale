import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MathFieldEditor } from './MathFieldEditor'

// Même couture que MathFieldEditor.test.tsx : un `math-field` minimal, pour
// exercer le VRAI champ (et son écouteur clavier) sans le paquet MathLive.
// `position`/`lastOffset`/`getValue`/`selectionIsCollapsed` simulent l'API
// réelle de MathLive avec un décalage linéaire = index de caractère, ce qui
// suffit à exercer la logique de coupe/fusion du composant.
vi.mock('mathlive', () => {
  if (!customElements.get('math-field')) {
    customElements.define(
      'math-field',
      class extends HTMLElement {
        #value = ''
        position = 0
        selectionIsCollapsed = true
        get value() {
          return this.#value
        }
        set value(next: string) {
          this.#value = next
        }
        get lastOffset() {
          return this.#value.length
        }
        getValue(start = 0, end = this.#value.length) {
          return this.#value.slice(start, end)
        }
      }
    )
  }
  return {}
})

async function mountField(props: {
  onEnter?: (before: string, after: string) => void
  onEnterBlock?: () => void
  onBackspaceAtStart?: (rest: string) => void
  onDeleteAtEnd?: (rest: string) => void
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
  })) as HTMLElement & { value: string; position: number }
}

describe('les touches du champ formule', () => {
  it('Entrée seule ajoute une ligne, Ctrl+Entrée demande un nouveau bloc', async () => {
    // Entrée écrit une ligne DANS le champ courant ; c'est Ctrl/Cmd+Entrée qui
    // garde le geste « un bloc de plus », comme partout ailleurs.
    const onEnter = vi.fn()
    const onEnterBlock = vi.fn()
    const field = await mountField({ onEnter, onEnterBlock })
    field.position = field.value.length

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onEnter).toHaveBeenCalledWith('x^2', '')
    expect(onEnterBlock).not.toHaveBeenCalled()

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onEnterBlock).toHaveBeenCalledTimes(1)
  })

  it('Entrée au milieu du champ coupe le contenu en deux', async () => {
    const onEnter = vi.fn()
    const field = await mountField({ onEnter })
    field.value = 'ab'
    field.position = 1

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledWith('a', 'b')
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
    const onBackspaceAtStart = vi.fn()
    const field = await mountField({ onBackspaceAtStart })

    field.value = ''
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(onBackspaceAtStart).toHaveBeenCalledTimes(1)
    expect(onBackspaceAtStart).toHaveBeenCalledWith('')
  })

  it('Retour arrière en tout début d’un champ NON vide fusionne — MathLive n’efface rien à gauche', async () => {
    const onBackspaceAtStart = vi.fn()
    const field = await mountField({ onBackspaceAtStart })

    field.value = 'ab'
    field.position = 0
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(onBackspaceAtStart).toHaveBeenCalledWith('ab')
  })

  it('Retour arrière plus loin dans un champ NON vide garde la touche pour MathLive', async () => {
    const onBackspaceAtStart = vi.fn()
    const field = await mountField({ onBackspaceAtStart })

    field.value = 'ab'
    field.position = 1
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
  })

  it('Suppr sur un champ vide demande la disparition vers le suivant', async () => {
    const onDeleteAtEnd = vi.fn()
    const field = await mountField({ onDeleteAtEnd })

    field.value = ''
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(onDeleteAtEnd).toHaveBeenCalledTimes(1)

    // Un champ NON vide, curseur pas en bout, garde la touche pour MathLive :
    // Suppr y efface le caractère à droite, il ne fait pas disparaître la ligne.
    field.value = 'x'
    field.position = 0
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(onDeleteAtEnd).toHaveBeenCalledTimes(1)
  })

  it('Suppr en toute fin d’un champ NON vide fusionne avec la ligne suivante', async () => {
    const onDeleteAtEnd = vi.fn()
    const field = await mountField({ onDeleteAtEnd })

    field.value = 'ab'
    field.position = 2
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(onDeleteAtEnd).toHaveBeenCalledWith('ab')
  })
})
