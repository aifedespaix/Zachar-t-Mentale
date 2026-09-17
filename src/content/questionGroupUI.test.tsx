import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  const { container } = render(<Harness initial={initial} onState={onState} />)
  const latest = () => {
    const calls = onState.mock.calls
    return calls.length === 0 ? undefined : (calls[calls.length - 1][0] as CardBlock[])
  }
  return { onState, latest, container }
}

beforeEach(() => localStorage.clear())

const q = (text: string, extra: Record<string, unknown> = {}): CardBlock =>
  ({ kind: 'question', text, ...extra }) as CardBlock
const t = (text: string, standalone = false): CardBlock =>
  standalone ? { kind: 'text', text, standalone: true } : { kind: 'text', text }

describe('le groupe question, à l’écran', () => {
  it('pose la question dans un bandeau, sans cadre de bloc autour', () => {
    const { container } = renderEditor([q('Quel coefficient ?'), t('a')])

    const banner = container.querySelector('[data-question-banner]')
    expect(banner).not.toBeNull()
    const field = within(banner as HTMLElement).getByRole('textbox', { name: /question du bloc 1/i })
    expect(field).toBeInTheDocument()
    expect((field as HTMLTextAreaElement).style.borderStyle).toBe('none')
  })

  it('ne se laisse pas compresser par la zone qui défile', () => {
    // La zone qui défile est un flex-column de hauteur bornée : sans
    // `flex-shrink: 0`, ses enfants se compriment au lieu de défiler, et le
    // groupe rogné (`overflow: hidden`) coupe ses blocs.
    const { container } = renderEditor([q('Quel coefficient ?'), t('a')])

    const group = container.querySelector('[data-group="question"]') as HTMLElement
    expect(group.style.flexShrink).toBe('0')
  })
})

describe('la pastille de question', () => {
  it('numérote automatiquement, de 1 à la suite', () => {
    renderEditor([q('Q1'), t('a'), q('Q2')])

    expect(screen.getByRole('button', { name: /pastille de la question 1/i })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /pastille de la question 2/i })).toHaveTextContent('2')
  })

  it('reprend la pastille saisie pour numéroter la suivante', () => {
    renderEditor([q('Q1', { label: 'a' }), q('Q2')])

    expect(screen.getByRole('button', { name: /pastille de la question 1/i })).toHaveTextContent('a')
    expect(screen.getByRole('button', { name: /pastille de la question 2/i })).toHaveTextContent('b')
  })

  it('s’édite à la main', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([q('Q1'), q('Q2')])

    await user.click(screen.getByRole('button', { name: /pastille de la question 2/i }))
    const input = screen.getByRole('textbox', { name: /pastille de la question 2/i })
    await user.clear(input)
    await user.type(input, 'Ex 3{Enter}')

    expect(latest()).toEqual([q('Q1'), q('Q2', { label: 'Ex 3' })])
    expect(screen.getByRole('button', { name: /pastille de la question 2/i })).toHaveTextContent('Ex 3')
  })

  it('revient à l’automatique quand on vide la pastille', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([q('Q1', { label: 'a' }), q('Q2', { label: 'Zzz' })])

    await user.click(screen.getByRole('button', { name: /pastille de la question 2/i }))
    await user.clear(screen.getByRole('textbox', { name: /pastille de la question 2/i }))
    await user.keyboard('{Enter}')

    expect(latest()).toEqual([q('Q1', { label: 'a' }), q('Q2')])
    expect(screen.getByRole('button', { name: /pastille de la question 2/i })).toHaveTextContent('b')
  })
})

describe('les boutons d’ajout', () => {
  it('celui du groupe ajoute DANS la question, avant le bloc qui l’a quittée', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([q('Q1'), t('a'), t('b', true)])

    await user.click(screen.getByRole('button', { name: /ajouter un bloc dans la question 1/i }))

    expect(latest()).toEqual([q('Q1'), t('a'), t(''), t('b', true)])
  })

  it('celui du bas marque le bloc comme extérieur à la question', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([q('Q1'), t('a')])

    await user.click(screen.getByRole('button', { name: /^ajouter un bloc$/i }))

    expect(latest()).toEqual([q('Q1'), t('a'), t('', true)])
  })

  it('ne marque rien quand il n’y a aucune question à quitter', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([t('a')])

    await user.click(screen.getByRole('button', { name: /^ajouter un bloc$/i }))

    expect(latest()).toEqual([t('a'), t('')])
  })
})

describe('le bouton « Nouvelle question »', () => {
  it('pose la question APRÈS le groupe, sans réassigner ses blocs', async () => {
    const user = userEvent.setup()
    // Deux questions : cliquer sur la première insère ENTRE les deux, sans
    // avaler le premier bloc de la seconde.
    const { latest } = renderEditor([q('Q1'), t('a'), q('Q2'), t('b')])

    await user.click(screen.getByRole('button', { name: /nouvelle question après la question 1/i }))

    expect(latest()).toEqual([q('Q1'), t('a'), q(''), q('Q2'), t('b')])
  })

  it('continue la numérotation automatique de la pastille', async () => {
    const user = userEvent.setup()
    renderEditor([q('Q1'), q('Q2')])

    await user.click(screen.getByRole('button', { name: /nouvelle question après la question 2/i }))

    expect(screen.getByRole('button', { name: /pastille de la question 3/i })).toHaveTextContent('3')
  })
})

describe('les flèches Monter/Descendre autour d’une question', () => {
  it('fait passer un bloc extérieur au-dessus de la question qu’il suit', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([q('Q1'), t('a'), t('b', true)])

    await user.click(screen.getByRole('button', { name: 'Monter le bloc 3' }))

    expect(latest()).toEqual([t('b', true), q('Q1'), t('a')])
  })

  it('fait passer un bloc extérieur sous la question qu’il précède', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([t('b', true), q('Q1'), t('a')])

    await user.click(screen.getByRole('button', { name: 'Descendre le bloc 1' }))

    expect(latest()).toEqual([q('Q1'), t('a'), t('b', true)])
  })

  it('emmène toute la question quand on déplace son en-tête', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([q('Q1'), t('a'), q('Q2'), t('b')])

    await user.click(screen.getByRole('button', { name: 'Monter le bloc 3' }))

    expect(latest()).toEqual([q('Q2'), t('b'), q('Q1'), t('a')])
  })

  it('grise la montée d’un bloc que son en-tête retient', () => {
    renderEditor([q('Q1'), t('a')])

    expect(screen.getByRole('button', { name: 'Monter le bloc 2' })).toBeDisabled()
  })

  it('grise les flèches de l’en-tête quand rien ne l’entoure', () => {
    renderEditor([q('Q1'), t('a')])

    expect(screen.getByRole('button', { name: 'Monter le bloc 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descendre le bloc 1' })).toBeDisabled()
  })

  it('laisse la descente active quand une question suit', () => {
    renderEditor([q('Q1'), t('a'), q('Q2'), t('b')])

    expect(screen.getByRole('button', { name: 'Descendre le bloc 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Monter le bloc 4' })).toBeDisabled()
  })
})
