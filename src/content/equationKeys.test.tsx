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

function moveOut(field: HTMLElement, direction: 'forward' | 'backward' | 'upward' | 'downward'): boolean {
  return !field.dispatchEvent(new CustomEvent('move-out', { detail: { direction }, cancelable: true, bubbles: true }))
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

  it('Retour arrière sur l’étape VIDE la retire et rend la main à la fin de l’opération précédente', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: '', right: '' }] }]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[2], { key: 'Backspace' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'equation', steps: [{ left: '2x', right: '8' }] },
    ]))
    // 2x = 8 n'est pas résolue : l'opération après la dernière étape reste là.
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
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
    // … mais le curseur remonte à la fin de l'opération précédente.
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
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

  it('Suppr en fin de D₀ passe à l’opération, puis Suppr sur Opₙ vide retire le bloc vide', async () => {
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
    fireEvent.keyDown(fields[1], { key: 'Delete' })
    const operation = await waitFor(() => {
      const input = screen.getByTestId('equation-op-input-0-0')
      expect(input).toHaveFocus()
      return input
    })
    expect(onState).not.toHaveBeenCalled()

    fireEvent.keyDown(operation, { key: 'Delete' })
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
    // Vide et non focalisée, l'opération de l'étape 1 est un bouton « + Opération » ;
    // cliquer dessus fait place à un `<input>` normal, pas une formule.
    const operationButton = await screen.findByTestId('equation-op-input-0-0')
    expect(operationButton.tagName).toBe('BUTTON')
    fireEvent.click(operationButton)
    const operationField = await screen.findByTestId('equation-op-input-0-0')
    expect(operationField.tagName).toBe('INPUT')

    fireEvent.keyDown(operationField, { key: 'Delete' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'equation', steps: [{ left: '2x', right: '8' }] },
    ]))
  })

  it('Opₙ : visible tant que la dernière étape n’est pas résolue, caché sinon — sauf s’il a un contenu', async () => {
    const { unmount } = render(<Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }] }]} />)
    expect(await screen.findByTestId('equation-op-input-0-0')).toBeInTheDocument()
    unmount()

    const solved = render(
      <Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8', operation: '\\div 2' }, { left: 'x', right: '4' }] }]} />
    )
    await mathFields()
    expect(screen.queryByTestId('equation-op-input-0-1')).not.toBeInTheDocument()
    solved.unmount()

    render(<Harness initial={[{ kind: 'equation', steps: [{ left: 'x', right: '4', operation: 'vérif' }] }]} />)
    expect(await screen.findByTestId('equation-op-input-0-0')).toBeInTheDocument()
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

  it('dans le champ opération, « * » écrit un signe multiplié et « / » un signe divisé', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: 'x', right: '4' }] }]}
        onState={onState}
      />
    )
    const operationButton = await screen.findByTestId('equation-op-input-0-0')
    fireEvent.click(operationButton)
    const operationInput = (await screen.findByTestId('equation-op-input-0-0')) as HTMLInputElement

    fireEvent.keyDown(operationInput, { key: '*' })
    await waitFor(() => expect(lastBlocks(onState)[0]).toEqual({
      kind: 'equation',
      steps: [{ left: '2x', right: '8', operation: '\\times ' }, { left: 'x', right: '4' }],
    }))

    fireEvent.keyDown(operationInput, { key: '/' })
    await waitFor(() => expect(lastBlocks(onState)[0]).toEqual({
      kind: 'equation',
      steps: [{ left: '2x', right: '8', operation: '\\times \\div ' }, { left: 'x', right: '4' }],
    }))
  })
})

describe('le bloc équation — flèches, Tab, Entrée', () => {
  const twoSteps: CardBlock[] = [{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: 'x', right: '2x' }] }]

  it('→ (move-out) suit l’ordre de lecture G₀ → D₀ → Op₀', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    moveOut(fields[0], 'forward')
    expect(fields[1].focus).toHaveBeenCalled()
    expect(fields[1].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
    moveOut(fields[1], 'forward')
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
  })

  it('↓ depuis G₀ va sur l’interligne, puis ↓ sur l’étape suivante dans la colonne mémorisée', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    // Focus sur D₀ : c'est lui que la colonne retient.
    fireEvent.focusIn(fields[1])
    moveOut(fields[1], 'downward')
    const operation = await waitFor(() => {
      const input = screen.getByTestId('equation-op-input-0-0')
      expect(input).toHaveFocus()
      return input
    })
    fireEvent.keyDown(operation, { key: 'ArrowDown' })
    expect(fields[3].focus).toHaveBeenCalled() // D₁
    expect(fields[3].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('↑ depuis G₁ remonte sur l’opération de l’étape précédente', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    moveOut(fields[2], 'upward')
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
  })

  it('au-delà de G₀, sortie vers le bloc précédent (fin du texte)', async () => {
    render(<Harness initial={[{ kind: 'text', text: 'avant' }, ...twoSteps]} />)
    const fields = await mathFields()
    moveOut(fields[0], 'backward')
    const text = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(text).toHaveFocus()
    expect(text.selectionStart).toBe(5)
  })

  it('↓ en fin de texte entre dans l’équation par G₀', async () => {
    render(<Harness initial={[{ kind: 'text', text: 'ab' }, ...twoSteps]} />)
    const fields = await mathFields()
    const text = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    text.focus()
    text.setSelectionRange(2, 2)
    fireEvent.keyDown(text, { key: 'ArrowDown' })
    expect(fields[0].focus).toHaveBeenCalled()
    expect(fields[0].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('Tab (move-out) depuis D₀ va sur l’opération ; Tab dans Opₙ reste au navigateur', async () => {
    render(<Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }] }]} />)
    const fields = await mathFields()
    fireEvent.keyDown(fields[1], { key: 'Tab' })
    expect(moveOut(fields[1], 'forward')).toBe(true)
    const operation = await waitFor(() => {
      const input = screen.getByTestId('equation-op-input-0-0')
      expect(input).toHaveFocus()
      return input
    })
    // Dernier champ : Tab n'est pas avalé, pas de piège au clavier.
    expect(fireEvent.keyDown(operation, { key: 'Tab' })).toBe(true)
  })

  it('Entrée réutilise une étape suivante vide au lieu d’en ajouter une', async () => {
    const onState = vi.fn()
    render(
      <Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: '', right: '' }] }]} onState={onState} />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[0], { key: 'Enter' })
    expect(onState).not.toHaveBeenCalled()
    expect(fields[2].focus).toHaveBeenCalled()
    expect(fields[2].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('Retour arrière au début de D va à la fin de G', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    fields[1].position = 0
    fireEvent.keyDown(fields[1], { key: 'Backspace' })
    expect(fields[0].focus).toHaveBeenCalled()
    expect(fields[0].executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })

  it('Ctrl+Maj+Entrée : un bloc dans la question, juste après l’équation', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'question', text: 'Q' }, ...twoSteps, { kind: 'text', text: 'fin' }]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[0], { key: 'Enter', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'question', text: 'Q' },
      ...twoSteps,
      { kind: 'text', text: '' },
      { kind: 'text', text: 'fin' },
    ]))
  })

  it('repli sur le membre droit quand l’opération visée vient de disparaître', async () => {
    // Retirer l'étape vide rend x = 4 dernière ET résolue : Op₀ vide se cache,
    // le curseur doit atterrir à la fin de D₀ plutôt que nulle part.
    const onState = vi.fn()
    render(
      <Harness initial={[{ kind: 'equation', steps: [{ left: 'x', right: '4' }, { left: '', right: '' }] }]} onState={onState} />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[2], { key: 'Backspace' })
    await waitFor(() => expect(lastBlocks(onState)).toEqual([{ kind: 'equation', steps: [{ left: 'x', right: '4' }] }]))
    expect(screen.queryByTestId('equation-op-input-0-0')).not.toBeInTheDocument()
    const [, right] = await mathFields()
    await waitFor(() => expect(right.focus).toHaveBeenCalled())
    expect(right.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })
})
