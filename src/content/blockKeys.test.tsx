import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEditor } from './BlockEditor'
import type { CardBlock } from '../types/cardBlock'

vi.mock('./MathFieldEditor', () => ({
  MathFieldEditor: ({ fallback }: { fallback: React.ReactNode }) => fallback,
}))

function Harness({ initial, onState }: { initial: CardBlock[]; onState: (blocks: CardBlock[]) => void }) {
  const [blocks, setBlocks] = useState(initial)
  return (
    <BlockEditor
      blocks={blocks}
      onChange={next => {
        setBlocks(next)
        onState(next)
      }}
      resolveAsset={asset => `/a/${asset}`}
    />
  )
}

function renderEditor(initial: CardBlock[]) {
  const onState = vi.fn()
  render(<Harness initial={initial} onState={onState} />)
  const latest = () => {
    const calls = onState.mock.calls
    return calls.length === 0 ? undefined : (calls[calls.length - 1][0] as CardBlock[])
  }
  return { onState, latest }
}

beforeEach(() => localStorage.clear())

describe('Entrée écrit une ligne', () => {
  it('ajoute une ligne dans le bloc au lieu de créer un bloc', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'une règle' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.click(field)
    await user.keyboard('{Enter}')

    expect(latest()).toEqual([{ kind: 'text', text: 'une règle\n' }])
    expect(screen.queryByRole('textbox', { name: /texte du bloc 2/i })).not.toBeInTheDocument()
  })
})

describe('Ctrl+Entrée crée un bloc', () => {
  it('ajoute un bloc après, et y met le curseur', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'une règle' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.click(field)
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(latest()).toEqual([
      { kind: 'text', text: 'une règle' },
      { kind: 'text', text: '' },
    ])
    await waitFor(() => expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus())
  })
})

describe('Tab change le type du bloc', () => {
  it('avance dans le cycle : texte → formule', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'x^2' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.click(field)
    await user.keyboard('{Tab}')

    expect(latest()).toEqual([{ kind: 'math', latex: 'x^2' }])
  })

  it('recule avec Maj+Tab : texte → question', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'Quel coefficient ?' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.click(field)
    await user.keyboard('{Shift>}{Tab}{/Shift}')

    expect(latest()).toEqual([{ kind: 'question', text: 'Quel coefficient ?' }])
  })

  it('reste le déplacement de cellule dans un tableau', async () => {
    // Tab, dans une cellule, doit continuer de circuler : c'est la seule façon
    // d'écrire un tableau au clavier, et changer de type y serait destructeur.
    const user = userEvent.setup()
    const { onState } = renderEditor([{ kind: 'table', header: [], rows: [['a', 'b']] }])

    await user.click(screen.getByRole('textbox', { name: /ligne 1 colonne 1 du tableau 1/i }))
    await user.keyboard('{Tab}')

    expect(onState).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /type du bloc 1 : tableau/i })).toBeInTheDocument()
  })
})

describe('Retour arrière sur un bloc vide', () => {
  it('supprime le bloc et remet le curseur à la fin du précédent', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'abc' },
      { kind: 'text', text: '' },
    ])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    await user.keyboard('{Backspace}')

    expect(latest()).toEqual([{ kind: 'text', text: 'abc' }])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    await waitFor(() => expect(first).toHaveFocus())
    expect(first.selectionStart).toBe(3)
  })

  it('ne supprime jamais le dernier bloc', async () => {
    const user = userEvent.setup()
    const { onState } = renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 1/i }))
    await user.keyboard('{Backspace}')

    expect(onState).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toBeInTheDocument()
  })

  it('ne supprime pas le PREMIER bloc vide : il n’y a pas de précédent où aller', async () => {
    const user = userEvent.setup()
    const { onState } = renderEditor([
      { kind: 'text', text: '' },
      { kind: 'text', text: 'suite' },
    ])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 1/i }))
    await user.keyboard('{Backspace}')

    expect(onState).not.toHaveBeenCalled()
    expect(screen.getAllByRole('textbox', { name: /texte du bloc/i })).toHaveLength(2)
  })
})

describe('Suppr sur un bloc vide', () => {
  it('supprime le bloc et met le curseur au DÉBUT du suivant', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: '' },
      { kind: 'text', text: 'suite' },
    ])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 1/i }))
    await user.keyboard('{Delete}')

    expect(latest()).toEqual([{ kind: 'text', text: 'suite' }])
    const next = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    await waitFor(() => expect(next).toHaveFocus())
    expect(next.selectionStart).toBe(0)
  })

  it('ne supprime pas le DERNIER bloc vide : il n’y a pas de suivant', async () => {
    const user = userEvent.setup()
    const { onState } = renderEditor([
      { kind: 'text', text: 'a' },
      { kind: 'text', text: '' },
    ])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    await user.keyboard('{Delete}')

    expect(onState).not.toHaveBeenCalled()
    expect(screen.getAllByRole('textbox', { name: /texte du bloc/i })).toHaveLength(2)
  })
})

describe('les flèches sortent d’un bloc texte en deux temps', () => {
  it('→ en fin passe au bloc suivant, curseur au début', () => {
    renderEditor([
      { kind: 'text', text: 'ab' },
      { kind: 'text', text: 'cd' },
    ])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(1, 1)
    expect(fireEvent.keyDown(first, { key: 'ArrowRight' })).toBe(true) // pas au bord : natif
    first.setSelectionRange(2, 2)
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const second = screen.getByRole('textbox', { name: /texte du bloc 2/i }) as HTMLTextAreaElement
    expect(second).toHaveFocus()
    expect(second.selectionStart).toBe(0)
  })

  it('↑ seulement quand le curseur est DÉJÀ en position 0 ; arrive à la fin du précédent', () => {
    renderEditor([
      { kind: 'text', text: 'ab' },
      { kind: 'text', text: 'ligne 1\nligne 2' },
    ])
    const second = screen.getByRole('textbox', { name: /texte du bloc 2/i }) as HTMLTextAreaElement
    second.focus()
    second.setSelectionRange(3, 3)
    expect(fireEvent.keyDown(second, { key: 'ArrowUp' })).toBe(true)
    second.setSelectionRange(0, 0)
    fireEvent.keyDown(second, { key: 'ArrowUp' })
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(first).toHaveFocus()
    expect(first.selectionStart).toBe(2)
  })

  it('saute un tableau, et avale la touche sans voisin', () => {
    renderEditor([
      { kind: 'text', text: 'a' },
      { kind: 'table', header: [], rows: [['x']] },
      { kind: 'text', text: 'b' },
    ])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(0, 0)
    expect(fireEvent.keyDown(first, { key: 'ArrowLeft' })).toBe(false) // avalée
    expect(first).toHaveFocus()
    first.setSelectionRange(1, 1)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(screen.getByRole('textbox', { name: /texte du bloc 3/i })).toHaveFocus()
  })

  it('Alt+↓ reste le déplacement du bloc', () => {
    const { latest } = renderEditor([
      { kind: 'text', text: 'a' },
      { kind: 'text', text: 'b' },
    ])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(1, 1)
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true })
    expect(latest()).toEqual([
      { kind: 'text', text: 'b' },
      { kind: 'text', text: 'a' },
    ])
  })
})

describe('Ctrl+Entrée hors groupe, Ctrl+Maj+Entrée dans le groupe', () => {
  const group: CardBlock[] = [
    { kind: 'question', text: 'Q' },
    { kind: 'text', text: 'a' },
    { kind: 'text', text: 'b' },
  ]

  it('Ctrl+Entrée : après le DERNIER bloc du groupe, marqué standalone', () => {
    const { latest } = renderEditor(group)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 2/i }), { key: 'Enter', ctrlKey: true })
    expect(latest()).toEqual([...group, { kind: 'text', text: '', standalone: true }])
  })

  it('Ctrl+Maj+Entrée : juste après le bloc courant, dans le groupe', () => {
    const { latest } = renderEditor(group)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 2/i }), { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(latest()).toEqual([group[0], group[1], { kind: 'text', text: '' }, group[2]])
  })

  it('Ctrl+Entrée hors question : juste après le bloc courant, jamais standalone', () => {
    // Sans en-tête, `blockGroups` renvoie quand même un groupe (headerIndex
    // null) pour toute la suite de blocs — mais ce n'est pas une VRAIE
    // question à sauter : le spec veut juste-après-le-bloc, comme si de rien.
    const noQuestion: CardBlock[] = [
      { kind: 'text', text: 'a' },
      { kind: 'text', text: 'b' },
      { kind: 'text', text: 'c' },
    ]
    const { latest } = renderEditor(noQuestion)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 1/i }), { key: 'Enter', ctrlKey: true })
    expect(latest()).toEqual([noQuestion[0], { kind: 'text', text: '' }, noQuestion[1], noQuestion[2]])
  })
})

describe('Entrée dans l’en-tête de question passe dans le corps', () => {
  it('insère un texte vide juste après l’en-tête et le focalise', async () => {
    const { latest } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'réponse' },
    ])
    fireEvent.keyDown(screen.getByRole('textbox', { name: /question du bloc 1/i }), { key: 'Enter' })
    expect(latest()).toEqual([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: '' },
      { kind: 'text', text: 'réponse' },
    ])
    await waitFor(() => expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus())
  })

  it('réutilise un texte vide qui suit déjà, sans rien insérer', () => {
    const { onState } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: '' },
    ])
    fireEvent.keyDown(screen.getByRole('textbox', { name: /question du bloc 1/i }), { key: 'Enter' })
    expect(onState).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus()
  })

  it('Maj+Entrée reste un retour à la ligne dans le titre', () => {
    const { onState } = renderEditor([{ kind: 'question', text: 'Q' }])
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: /question du bloc 1/i }), { key: 'Enter', shiftKey: true })).toBe(true)
    expect(onState).not.toHaveBeenCalled()
  })
})

describe('anti-rafale sur un bloc texte vide', () => {
  it('Retour arrière répété ne supprime pas le bloc', () => {
    const { onState } = renderEditor([
      { kind: 'text', text: 'abc' },
      { kind: 'text', text: '' },
    ])
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 2/i }), { key: 'Backspace', repeat: true })
    expect(onState).not.toHaveBeenCalled()
  })
})
