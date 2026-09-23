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
  onEnterBlock?: (place: 'inside' | 'outside') => void
  onBackspaceAtStart?: (rest: string) => void
  onDeleteAtEnd?: (rest: string) => void
  onExit?: (direction: 'left' | 'right' | 'up' | 'down', via: 'arrow' | 'tab') => boolean | void
  tabExits?: boolean
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

/** Ce que MathLive émet quand une flèche ou Tab n'a plus rien à parcourir. Renvoie `true` si l'événement a été annulé. */
function moveOut(field: HTMLElement, direction: 'forward' | 'backward' | 'upward' | 'downward'): boolean {
  return !field.dispatchEvent(new CustomEvent('move-out', { detail: { direction }, cancelable: true, bubbles: true }))
}

describe('les touches du champ formule', () => {
  it('pendant une composition (IME), Entrée et Retour arrière restent à l’IME', async () => {
    const onEnter = vi.fn()
    const onBackspaceAtStart = vi.fn()
    const field = await mountField({ onEnter, onBackspaceAtStart })
    field.position = 0

    expect(fireEvent.keyDown(field, { key: 'Enter', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(field, { key: 'Backspace', isComposing: true })).toBe(true)
    expect(onEnter).not.toHaveBeenCalled()
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
  })

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
    expect(onEnterBlock).toHaveBeenCalledWith('outside')
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

describe('move-out → onExit', () => {
  it('traduit les quatre directions et annule le « plonk »', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    expect(moveOut(field, 'forward')).toBe(true)
    moveOut(field, 'backward')
    moveOut(field, 'upward')
    moveOut(field, 'downward')
    expect(onExit.mock.calls).toEqual([
      ['right', 'arrow'],
      ['left', 'arrow'],
      ['up', 'arrow'],
      ['down', 'arrow'],
    ])
  })

  it('↑/↓ ne sont plus interceptés : MathLive les garde (fractions)', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    expect(fireEvent.keyDown(field, { key: 'ArrowUp' })).toBe(true)
    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(true)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('un move-out issu de Tab reste à MathLive sans tabExits', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(moveOut(field, 'forward')).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('avec tabExits, Tab sort vers le champ voisin ; `false` laisse faire MathLive', async () => {
    const onExit = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(false)
    const field = await mountField({ onExit, tabExits: true })
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(moveOut(field, 'forward')).toBe(true)
    fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })
    expect(moveOut(field, 'backward')).toBe(false)
    expect(onExit.mock.calls).toEqual([['right', 'tab'], ['left', 'tab']])
  })

  it('une flèche modifiée (Maj : sélection) ne sort jamais', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    fireEvent.keyDown(field, { key: 'ArrowRight', shiftKey: true })
    expect(moveOut(field, 'forward')).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('anti-rafale et variantes d’Entrée', () => {
  it('Retour arrière / Suppr répétés au bord sont avalés sans rien déclencher', async () => {
    const onBackspaceAtStart = vi.fn()
    const onDeleteAtEnd = vi.fn()
    const field = await mountField({ onBackspaceAtStart, onDeleteAtEnd })
    field.position = 0
    expect(fireEvent.keyDown(field, { key: 'Backspace', repeat: true })).toBe(false)
    field.position = field.value.length
    expect(fireEvent.keyDown(field, { key: 'Delete', repeat: true })).toBe(false)
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
    expect(onDeleteAtEnd).not.toHaveBeenCalled()
  })

  it('Ctrl+Entrée → hors groupe, Ctrl+Maj+Entrée → dans le groupe', async () => {
    const onEnterBlock = vi.fn()
    const field = await mountField({ onEnterBlock, onEnter: vi.fn() })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(onEnterBlock.mock.calls).toEqual([['outside'], ['inside']])
  })
})
