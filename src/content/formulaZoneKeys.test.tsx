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

function Harness({ initial }: { initial: CardBlock[] }) {
  const [blocks, setBlocks] = useState(initial)
  return <BlockEditor blocks={blocks} onChange={setBlocks} resolveAsset={asset => `/a/${asset}`} />
}

async function mathFields(): Promise<(HTMLElement & { value: string; focus: () => void; executeCommand: (c: string) => boolean })[]> {
  const hosts = await waitFor(() => {
    const found = screen.getAllByTestId('math-field')
    if (found.length === 0) throw new Error('pas encore de champ formule monté')
    return found
  })
  return hosts.map(host => host.firstElementChild) as unknown as (HTMLElement & {
    value: string
    focus: () => void
    executeCommand: (c: string) => boolean
  })[]
}

describe('la « zone formule »', () => {
  it('Entrée dans une formule ajoute une nouvelle ligne de formule', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'x' }]} />)
    const [first] = await mathFields()

    fireEvent.keyDown(first, { key: 'Enter' })

    await waitFor(async () => expect(await mathFields()).toHaveLength(2))
    const fields = await mathFields()
    expect(fields[1].value).toBe('')
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
    // Le focus revient sur la formule restante, avec le curseur ramené à sa
    // fin — le même geste de fusion qu'un texte, via `MathFieldHandle.focusEnd`.
    await waitFor(() => expect(remaining.focus).toHaveBeenCalled())
    expect(remaining.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })
})
