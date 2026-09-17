import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { BlockEditor } from './BlockEditor'
import type { CardBlock } from '../types/cardBlock'

// Le VRAI `MathFieldEditor` (et son écouteur clavier), sur un `math-field`
// minimal qui espionne `focus`/`executeCommand` — les deux méthodes que
// `MathFieldHandle.focusEnd` appelle. Même couture que `mathFieldKeys.test.tsx`.
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
        focus = vi.fn()
        executeCommand = vi.fn()
      }
    )
  }
  return {}
})

function Harness({ initial, onState }: { initial: CardBlock[]; onState?: (blocks: CardBlock[]) => void }) {
  const [blocks, setBlocks] = useState(initial)
  return (
    <BlockEditor
      blocks={blocks}
      onChange={next => {
        setBlocks(next)
        onState?.(next)
      }}
      resolveAsset={asset => `/a/${asset}`}
    />
  )
}

async function mathFields(): Promise<(HTMLElement & { value: string; focus: () => void; executeCommand: (c: string) => boolean })[]> {
  return (await waitFor(() => {
    const hosts = screen.getAllByTestId('math-field')
    if (hosts.length === 0) throw new Error('pas encore de champ formule monté')
    const fields = hosts.map(host => host.firstElementChild)
    // L'hôte est posé par le rendu, l'élément réel par un effet : attendre les
    // deux, sinon on récupère un hôte encore vide et fireEvent n'a pas de cible.
    if (fields.some(field => field === null)) throw new Error('le champ réel n’est pas encore monté')
    return fields
  })) as unknown as (HTMLElement & {
    value: string
    focus: () => void
    executeCommand: (c: string) => boolean
  })[]
}

describe('la « zone formule »', () => {
  it('Entrée dans une formule ajoute une LIGNE dans le même bloc, pas un bloc', async () => {
    const onState = vi.fn()
    render(<Harness initial={[{ kind: 'math', latex: 'x' }]} onState={onState} />)
    const [first] = await mathFields()

    fireEvent.keyDown(first, { key: 'Enter' })

    await waitFor(async () => expect(await mathFields()).toHaveLength(2))
    const fields = await mathFields()
    expect(fields[1].value).toBe('')
    expect(onState).toHaveBeenCalled()
    const blocks = onState.mock.calls[onState.mock.calls.length - 1][0] as CardBlock[]
    // UN bloc, dont le latex porte les deux lignes.
    expect(blocks).toEqual([{ kind: 'math', latex: 'x\n' }])
    expect(document.querySelectorAll('[data-row-index]')).toHaveLength(1)
  })

  it('pose le focus sur la nouvelle ligne', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'x' }]} />)
    const [first] = await mathFields()

    fireEvent.keyDown(first, { key: 'Enter' })

    await waitFor(async () => expect(await mathFields()).toHaveLength(2))
    const [, second] = await mathFields()
    await waitFor(() => expect(second.focus).toHaveBeenCalled())
    expect(second.executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('les flèches montent/descendent d’une ligne DANS le bloc', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'a\nb\nc' }]} />)
    const fields = await mathFields()
    expect(fields).toHaveLength(3)

    fireEvent.keyDown(fields[1], { key: 'ArrowDown' })
    expect(fields[2].focus).toHaveBeenCalled()
    expect(fields[2].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')

    fireEvent.keyDown(fields[1], { key: 'ArrowUp' })
    expect(fields[0].focus).toHaveBeenCalled()
    expect(fields[0].executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')

    // Toujours UN seul bloc : on ne sort jamais de la formule.
    expect(document.querySelectorAll('[data-row-index]')).toHaveLength(1)
  })

  it('les flèches ne sortent pas de la formule : rien aux extrémités', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'a\nb' }]} />)
    const fields = await mathFields()

    fireEvent.keyDown(fields[0], { key: 'ArrowUp' })
    fireEvent.keyDown(fields[1], { key: 'ArrowDown' })

    // Aucun déplacement : la touche est avalée plutôt que d'aller voir ailleurs.
    expect(fields[0].focus).not.toHaveBeenCalled()
    expect(fields[1].focus).not.toHaveBeenCalled()
  })

  it('une formule mono-ligne laisse les flèches à MathLive', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'x' }]} />)
    const [only] = await mathFields()

    fireEvent.keyDown(only, { key: 'ArrowUp' })
    fireEvent.keyDown(only, { key: 'ArrowDown' })

    // Pas de handler de ligne : on n'a rien à faire, MathLive garde la touche.
    expect(only.focus).not.toHaveBeenCalled()
  })

  it('Retour arrière sur la ligne vide la supprime et rend la main à la fin de la précédente', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'x' }]} />)
    const [first] = await mathFields()
    fireEvent.keyDown(first, { key: 'Enter' })
    await waitFor(async () => expect(await mathFields()).toHaveLength(2))
    const [, second] = await mathFields()
    expect(second.value).toBe('')

    fireEvent.keyDown(second, { key: 'Backspace' })

    await waitFor(async () => expect(await mathFields()).toHaveLength(1))
    const [remaining] = await mathFields()
    expect(remaining.value).toBe('x')
    // Le focus revient sur la ligne restante, avec le curseur ramené à sa fin —
    // le même geste de fusion qu'un texte, via `MathFieldHandle.focusEnd`.
    await waitFor(() => expect(remaining.focus).toHaveBeenCalled())
    expect(remaining.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })
})
