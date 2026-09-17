import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
