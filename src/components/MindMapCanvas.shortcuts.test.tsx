import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MindMapCanvas } from './MindMapCanvas'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { useCardsStore } from '../state/useCardsStore'
import { useCardSelectionStore } from '../state/useCardSelectionStore'
import { useCardClipboardStore } from '../state/useCardClipboardStore'
import { useCardDetailStore } from '../state/useCardDetailStore'
import { useShortcutSettingsStore } from '../state/useShortcutSettingsStore'
import { useQuizStore, createQuizStore } from '../state/useQuizStore'
import { childrenOf, siblingsOf } from '../state/cardsReducer'
import type { Card } from '../types/card'

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    // jsdom has no layout, so the real `setCenter` would throw its way through
    // every navigation assertion. Nothing here is about the viewport.
    useReactFlow: () => ({ ...actual.useReactFlow(), setCenter: vi.fn() }),
  }
})

const root: Card = { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }
const a: Card = { id: 'a', level: 2, title: 'A', parentId: 'root', order: 0 }
const b: Card = { id: 'b', level: 2, title: 'B', parentId: 'root', order: 1 }
const a1: Card = { id: 'a1', level: 3, title: 'A1', parentId: 'a', order: 0 }

/** The canvas as the app mounts it: with the keyboard listening. */
function Harness() {
  useGlobalShortcuts()
  return <MindMapCanvas />
}

/** A keydown aimed at the canvas pane, which is where the map has focus. */
function pressOnCanvas(container: HTMLElement, init: KeyboardEventInit & { key: string }) {
  fireEvent.keyDown(container.querySelector('.react-flow')!, { bubbles: true, cancelable: true, ...init })
}

function select(cardId: string) {
  act(() => useCardSelectionStore.getState().select(cardId))
}

function cards(): Card[] {
  return useCardsStore.getState().history.present
}

describe('MindMapCanvas — clavier', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([root, a, b, a1])
    useCardsStore.setState({ locked: false, readOnly: false })
    useCardSelectionStore.getState().reset()
    useCardClipboardStore.getState().clear()
    useCardDetailStore.getState().closeAll()
    useShortcutSettingsStore.getState().resetAll()
    useQuizStore.setState(createQuizStore().getState())
  })

  it('builds a branch with Tab and Entrée, the way an outliner does', () => {
    const { container } = render(<Harness />)
    select('a')

    pressOnCanvas(container, { key: 'Tab' })
    expect(childrenOf(cards(), 'a')).toHaveLength(2)

    // The card just created is selected, so the next keystroke acts on it —
    // that chaining is the whole point of the flow.
    const created = useCardSelectionStore.getState().selectedCardId!
    pressOnCanvas(container, { key: 'Enter' })
    expect(siblingsOf(cards(), created)).toHaveLength(3)
  })

  it('walks the tree with the arrows', () => {
    const { container } = render(<Harness />)
    select('a')

    pressOnCanvas(container, { key: 'ArrowDown' })
    expect(useCardSelectionStore.getState().selectedCardId).toBe('b')

    pressOnCanvas(container, { key: 'ArrowUp' })
    expect(useCardSelectionStore.getState().selectedCardId).toBe('a')

    pressOnCanvas(container, { key: 'ArrowRight' })
    expect(useCardSelectionStore.getState().selectedCardId).toBe('a1')

    pressOnCanvas(container, { key: 'ArrowLeft' })
    expect(useCardSelectionStore.getState().selectedCardId).toBe('a')
  })

  it('reorders among siblings with Alt + flèches', () => {
    const { container } = render(<Harness />)
    select('a')
    pressOnCanvas(container, { key: 'ArrowDown', altKey: true })
    expect(siblingsOf(cards(), 'a').map(c => c.id)).toEqual(['b', 'a'])
  })

  it('changes a card’s level with Alt + gauche/droite', () => {
    const { container } = render(<Harness />)

    // A1 rises beside A.
    select('a1')
    pressOnCanvas(container, { key: 'ArrowLeft', altKey: true })
    expect(cards().find(c => c.id === 'a1')!.parentId).toBe('root')
    expect(cards().find(c => c.id === 'a1')!.level).toBe(2)

    // And B drops under the sibling above it.
    select('b')
    pressOnCanvas(container, { key: 'ArrowRight', altKey: true })
    expect(cards().find(c => c.id === 'b')!.parentId).toBe('a1')
  })

  it('copies a branch and pastes it under another card', () => {
    const { container } = render(<Harness />)
    select('a')
    pressOnCanvas(container, { key: 'c', ctrlKey: true })
    expect(useCardClipboardStore.getState().branch?.cards.map(c => c.id)).toEqual(['a', 'a1'])

    select('b')
    pressOnCanvas(container, { key: 'v', ctrlKey: true })
    // The whole branch, under B, with ids of its own.
    expect(childrenOf(cards(), 'b')).toHaveLength(1)
    expect(cards()).toHaveLength(6)
  })

  it('cuts a branch into the clipboard, so nothing is lost by the deletion', () => {
    const { container } = render(<Harness />)
    select('a')
    pressOnCanvas(container, { key: 'x', ctrlKey: true })
    expect(cards().some(c => c.id === 'a')).toBe(false)
    expect(useCardClipboardStore.getState().branch?.rootId).toBe('a')
  })

  it('duplicates a branch in place with Ctrl + D', () => {
    const { container } = render(<Harness />)
    select('a')
    pressOnCanvas(container, { key: 'd', ctrlKey: true })
    expect(siblingsOf(cards(), 'a').map(c => c.title)).toEqual(['A', 'A', 'B'])
  })

  it('deletes a childless card outright, and asks about a branch', async () => {
    const { container } = render(<Harness />)

    select('b')
    pressOnCanvas(container, { key: 'Delete' })
    await waitFor(() => expect(cards().some(c => c.id === 'b')).toBe(false))

    // A branch is a different question: the card's own dialog offers to keep
    // the descendants, which a bare "supprimer" would silently take with it.
    select('a')
    pressOnCanvas(container, { key: 'Delete' })
    expect(await screen.findByRole('dialog')).toHaveTextContent(/1 descendant/)
    expect(cards().some(c => c.id === 'a')).toBe(true)
  })

  it('opens the fiche of the selected card', () => {
    const { container } = render(<Harness />)
    select('a')
    pressOnCanvas(container, { key: 'i', ctrlKey: true })
    expect(useCardDetailStore.getState().open.map(entry => entry.cardId)).toEqual(['a'])
  })

  it('refuses every editing shortcut while the map is locked', () => {
    const { container } = render(<Harness />)
    act(() => useCardsStore.setState({ locked: true }))
    select('a')

    pressOnCanvas(container, { key: 'Tab' })
    pressOnCanvas(container, { key: 'd', ctrlKey: true })
    expect(cards()).toHaveLength(4)

    // Reading is still allowed: a locked map is read-only, not inert.
    pressOnCanvas(container, { key: 'ArrowDown' })
    expect(useCardSelectionStore.getState().selectedCardId).toBe('b')
  })

  it('refuses every editing shortcut on a map that belongs to someone else', () => {
    // The read-only overlay only blocks the POINTER. Without the same flag
    // reaching the commands, a keystroke would edit a file the user was just
    // told is read-only — and autosave would write the result to disk.
    const { container } = render(<Harness />)
    act(() => useCardsStore.getState().setReadOnly(true))
    select('a')

    pressOnCanvas(container, { key: 'Tab' })
    pressOnCanvas(container, { key: 'Delete' })
    pressOnCanvas(container, { key: 'd', ctrlKey: true })
    pressOnCanvas(container, { key: 'Insert' })
    expect(cards()).toHaveLength(4)

    // Reading a colleague's map is the whole point of opening it.
    pressOnCanvas(container, { key: 'ArrowDown' })
    expect(useCardSelectionStore.getState().selectedCardId).toBe('b')
  })

  it('does nothing when no card is selected', () => {
    const { container } = render(<Harness />)
    pressOnCanvas(container, { key: 'Tab' })
    pressOnCanvas(container, { key: 'Delete' })
    expect(cards()).toHaveLength(4)
  })

  it('creates a floating card, which needs no selection at all', () => {
    const { container } = render(<Harness />)
    pressOnCanvas(container, { key: 'Insert' })
    expect(cards().filter(c => c.detached)).toHaveLength(1)
  })

  it('follows a rebinding made in the settings', () => {
    const { container } = render(<Harness />)
    act(() => useShortcutSettingsStore.getState().setBinding('card.addFloating', 'Mod+Shift+K'))

    pressOnCanvas(container, { key: 'Insert' })
    expect(cards().filter(c => c.detached)).toHaveLength(0)

    pressOnCanvas(container, { key: 'K', ctrlKey: true, shiftKey: true })
    expect(cards().filter(c => c.detached)).toHaveLength(1)
  })
})
