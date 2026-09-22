import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { BlockEditor } from './BlockEditor'
import type { CardBlock } from '../types/cardBlock'

// Même mock que `formulaZoneKeys.test.tsx` : un `math-field` minimal qui
// espionne `focus`/`executeCommand` et simule `position` comme le vrai
// MathLive, ramené en bout de contenu à chaque écriture de `value`.
vi.mock('mathlive', () => {
  if (!customElements.get('math-field')) {
    customElements.define(
      'math-field',
      class extends HTMLElement {
        #value = ''
        #position = 0
        selectionIsCollapsed = true
        get value() {
          return this.#value
        }
        set value(next: string) {
          this.#value = next
          this.#position = next.length
        }
        get position() {
          return this.#position
        }
        set position(next: number) {
          this.#position = next
        }
        get lastOffset() {
          return this.#value.length
        }
        getValue(start = 0, end = this.#value.length) {
          return this.#value.slice(start, end)
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

async function mathFields(): Promise<(HTMLElement & { value: string; focus: () => void; executeCommand: (c: string) => boolean; position: number })[]> {
  return (await waitFor(() => {
    const hosts = screen.getAllByTestId('math-field')
    if (hosts.length === 0) throw new Error('pas encore de champ équation monté')
    const fields = hosts.map(host => host.firstElementChild)
    if (fields.some(field => field === null)) throw new Error('le champ réel n’est pas encore monté')
    return fields
  })) as unknown as (HTMLElement & {
    value: string
    focus: () => void
    executeCommand: (c: string) => boolean
    position: number
  })[]
}

function lastBlocks(onState: ReturnType<typeof vi.fn>): CardBlock[] {
  return onState.mock.calls[onState.mock.calls.length - 1][0] as CardBlock[]
}

describe('le bloc équation — clavier', () => {
  it('Entrée (dans n’importe quel champ) ajoute une ÉTAPE dans le même bloc, jamais un bloc', async () => {
    const onState = vi.fn()
    render(<Harness initial={[{ kind: 'equation', steps: [{ left: 'x', right: '' }] }]} onState={onState} />)
    // Une seule étape (la dernière) : deux champs, gauche et droit, pas
    // d'opération.
    const [left] = await mathFields()
    expect(left.value).toBe('x')

    fireEvent.keyDown(left, { key: 'Enter' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'equation', steps: [{ left: 'x', right: '' }, { left: '', right: '' }] },
    ]))
    // Toujours UN seul bloc.
    expect(document.querySelectorAll('[data-row-index]')).toHaveLength(1)
  })

  it('pose le focus sur le membre gauche de la nouvelle étape', async () => {
    render(<Harness initial={[{ kind: 'equation', steps: [{ left: 'x', right: '11' }] }]} />)
    const [left] = await mathFields()

    fireEvent.keyDown(left, { key: 'Enter' })

    // 1 étape → 2 : quatre champs FORMULE (gauche/droite de chaque étape) — le
    // champ opération de la première étape n'en est plus un, voir
    // `EquationOperationField`.
    await waitFor(async () => expect(await mathFields()).toHaveLength(4))
    const fields = await mathFields()
    const newLeft = fields[2] // gauche, droite, [gauche de l'étape 2]
    await waitFor(() => expect(newLeft.focus).toHaveBeenCalled())
    expect(newLeft.executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('Ctrl+Entrée demande un nouveau BLOC après celui-ci, pas une étape', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: 'x', right: '4' }] }]}
        onState={onState}
      />
    )
    const [left] = await mathFields()

    fireEvent.keyDown(left, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(lastBlocks(onState)).toHaveLength(2))
    expect(lastBlocks(onState)[0]).toEqual({ kind: 'equation', steps: [{ left: 'x', right: '4' }] })
    expect(document.querySelectorAll('[data-row-index]')).toHaveLength(2)
  })

  it('Retour arrière sur l’étape VIDE la retire et rend la main à la fin du membre droit précédent', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: '', right: '' }] }]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    expect(fields).toHaveLength(4) // étape 1 : gauche, droite ; étape 2 : gauche, droite — pas d'opération formule
    const secondLeft = fields[2]

    fireEvent.keyDown(secondLeft, { key: 'Backspace' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'equation', steps: [{ left: '2x', right: '8' }] },
    ]))
    const remaining = await mathFields()
    expect(remaining).toHaveLength(2) // plus qu'une étape, donc plus d'opération
    const right = remaining[1]
    await waitFor(() => expect(right.focus).toHaveBeenCalled())
    expect(right.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })

  it('Retour arrière sur une étape NON vide ne retire rien — jamais de perte silencieuse', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: 'x', right: '4' }] }]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    const secondLeft = fields[2]
    secondLeft.value = 'x'
    secondLeft.position = 0

    fireEvent.keyDown(secondLeft, { key: 'Backspace' })

    // Rien n'a changé : deux étapes toujours là, le contenu de la seconde intact.
    expect(onState).not.toHaveBeenCalled()
    expect(await mathFields()).toHaveLength(4)
  })

  it('Retour arrière en tout début de bloc — le bloc entier vide demande à disparaître vers le précédent', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[
          { kind: 'text', text: 'avant' },
          { kind: 'equation', steps: [{ left: '', right: '' }] },
        ]}
        onState={onState}
      />
    )
    const [left] = await mathFields()

    fireEvent.keyDown(left, { key: 'Backspace' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([{ kind: 'text', text: 'avant' }]))
  })

  it('Suppr en toute fin de bloc — le bloc entier vide demande à disparaître vers le suivant', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[
          { kind: 'equation', steps: [{ left: '', right: '' }] },
          { kind: 'text', text: 'après' },
        ]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    const right = fields[1]

    fireEvent.keyDown(right, { key: 'Delete' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([{ kind: 'text', text: 'après' }]))
  })

  it('Suppr en fin du champ opération, étape suivante VIDE : elle disparaît', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: '', right: '' }] }]}
        onState={onState}
      />
    )
    // Vide, l'opération de l'étape 1 est un `<input>` normal, pas une formule.
    const operationField = await screen.findByTestId('equation-op-input-0-0')
    expect(operationField.tagName).toBe('INPUT')

    fireEvent.keyDown(operationField, { key: 'Delete' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'equation', steps: [{ left: '2x', right: '8' }] },
    ]))
  })

  it('la dernière étape — une variable seule — n’a pas de champ opération', async () => {
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8', operation: '÷ 2' }, { left: 'x', right: '4' }] }]}
      />
    )
    const fields = await mathFields()
    // étape 1 : gauche, droite (2) ; étape 2 (résultat) : gauche, droite (2) —
    // l'opération n'est jamais un champ formule, quel que soit son contenu.
    expect(fields).toHaveLength(4)
  })

  it('l’opération est un texte normal, affiché deux fois — une fois sous chaque membre —, éditable au clic', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8', operation: '\\div 2' }, { left: 'x', right: '4' }] }]}
        onState={onState}
      />
    )
    // Rempli et non focalisé : un rendu KaTeX, jamais une formule MathLive.
    const operationDisplay = await screen.findByTestId('equation-op-input-0-0')
    expect(operationDisplay.tagName).not.toBe('INPUT')
    expect(operationDisplay.innerHTML).not.toBe('')
    // …et son double en lecture seule affiche EXACTEMENT le même rendu.
    const mirror = await screen.findByTestId('equation-op-mirror-0-0')
    expect(mirror.innerHTML).toBe(operationDisplay.innerHTML)

    // Cliquer dessus repasse en LaTeX brut éditable.
    fireEvent.click(operationDisplay)
    const operationInput = (await screen.findByTestId('equation-op-input-0-0')) as HTMLInputElement
    expect(operationInput.tagName).toBe('INPUT')
    expect(operationInput.value).toBe('\\div 2')

    fireEvent.change(operationInput, { target: { value: '\\div 3' } })
    await waitFor(() =>
      expect(lastBlocks(onState)[0]).toEqual({
        kind: 'equation',
        steps: [{ left: '2x', right: '8', operation: '\\div 3' }, { left: 'x', right: '4' }],
      })
    )
    // Le double se met à jour avec la frappe, sans attendre le blur.
    await waitFor(() => expect(screen.getByTestId('equation-op-mirror-0-0').innerHTML).toContain('3'))

    // Quitter le champ (blur) réaffiche le rendu — jamais le LaTeX brut.
    fireEvent.blur(operationInput)
    const operationDisplayAgain = await screen.findByTestId('equation-op-input-0-0')
    expect(operationDisplayAgain.tagName).not.toBe('INPUT')
    expect(operationDisplayAgain.innerHTML).toBe(screen.getByTestId('equation-op-mirror-0-0').innerHTML)
  })
})
