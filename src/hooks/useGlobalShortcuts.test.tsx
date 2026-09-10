import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useCommand } from './useCommand'
import { useCommandRegistry } from '../state/useCommandRegistry'
import { useShortcutSettingsStore } from '../state/useShortcutSettingsStore'
import { useQuizStore, createQuizStore } from '../state/useQuizStore'
import type { CommandId } from '../types/commands'

interface HarnessProps {
  /** Commands to publish, with whether each is currently available. */
  handlers: { id: CommandId; run: () => void; enabled?: boolean }[]
}

function Harness({ handlers }: HarnessProps) {
  useGlobalShortcuts()
  return (
    <>
      {handlers.map(handler => (
        <Registration key={handler.id} {...handler} />
      ))}
      <div className="react-flow" data-testid="canvas">
        <button type="button" data-testid="toolbar-button">
          Bouton
        </button>
      </div>
      <input data-testid="field" aria-label="champ" />
    </>
  )
}

function Registration({ id, run, enabled = true }: { id: CommandId; run: () => void; enabled?: boolean }) {
  useCommand(id, run, enabled)
  return null
}

/** Fires a keydown at a specific element, the way the browser would. */
function press(target: Element, init: KeyboardEventInit & { key: string }) {
  return fireEvent.keyDown(target, { bubbles: true, cancelable: true, ...init })
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    useCommandRegistry.setState({ registrations: {} })
    useShortcutSettingsStore.getState().resetAll()
    useQuizStore.setState(createQuizStore().getState())
  })

  it('runs the command a chord is bound to', () => {
    const undo = vi.fn()
    render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)
    press(document.body, { key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledOnce()
  })

  it('follows a rebinding, without anything re-registering', () => {
    const undo = vi.fn()
    render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)
    act(() => useShortcutSettingsStore.getState().setBinding('edit.undo', 'Mod+U'))

    press(document.body, { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
    press(document.body, { key: 'u', ctrlKey: true })
    expect(undo).toHaveBeenCalledOnce()
  })

  it('swallows the key only when a command actually ran', () => {
    const undo = vi.fn()
    render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)

    // Handled: the browser must not also undo the page.
    expect(press(document.body, { key: 'z', ctrlKey: true })).toBe(false)
    // Bound to nothing: the keystroke belongs to the browser.
    expect(press(document.body, { key: 'q', ctrlKey: true })).toBe(true)
  })

  it('lets the key through when the action cannot apply right now', () => {
    // A greyed-out action must not eat the keystroke — Ctrl+V with an empty
    // clipboard should still reach whatever else would handle it.
    const paste = vi.fn()
    render(<Harness handlers={[{ id: 'edit.paste', run: paste, enabled: false }]} />)
    expect(press(document.body, { key: 'v', ctrlKey: true })).toBe(true)
    expect(paste).not.toHaveBeenCalled()
  })

  it('keeps out of a text field, so Ctrl+Z undoes the TEXT', () => {
    const undo = vi.fn()
    render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)
    press(screen.getByTestId('field'), { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
  })

  it('still saves from inside a text field — the one reflex that fires mid-sentence', () => {
    const save = vi.fn()
    render(<Harness handlers={[{ id: 'file.save', run: save }]} />)
    press(screen.getByTestId('field'), { key: 's', ctrlKey: true })
    expect(save).toHaveBeenCalledOnce()
  })

  it('fires a bare key on the canvas but not on a focused control', () => {
    // Entrée creates a sibling card on the map — and must still activate a
    // button that has focus, or the toolbar stops working from the keyboard.
    const addSibling = vi.fn()
    render(<Harness handlers={[{ id: 'card.addSiblingBelow', run: addSibling }]} />)

    press(screen.getByTestId('canvas'), { key: 'Enter' })
    expect(addSibling).toHaveBeenCalledOnce()

    press(screen.getByTestId('toolbar-button'), { key: 'Enter' })
    expect(addSibling).toHaveBeenCalledOnce()
  })

  it('leaves card commands alone while a quiz is running', () => {
    // No card may move or disappear under a question in progress.
    const del = vi.fn()
    render(<Harness handlers={[{ id: 'edit.delete', run: del }]} />)
    act(() => useQuizStore.setState({ active: true }))
    press(screen.getByTestId('canvas'), { key: 'Delete' })
    expect(del).not.toHaveBeenCalled()
  })

  it('lets a quiz-safe command through during a quiz', () => {
    const zoomIn = vi.fn()
    render(<Harness handlers={[{ id: 'view.zoomIn', run: zoomIn }]} />)
    act(() => useQuizStore.setState({ active: true }))
    press(document.body, { key: '+', code: 'Equal', ctrlKey: true })
    expect(zoomIn).toHaveBeenCalledOnce()
  })

  it('stands down while a modal is up, which owns the keyboard', () => {
    const undo = vi.fn()
    render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)
    const dialog = document.createElement('div')
    dialog.setAttribute('data-slot', 'dialog-content')
    dialog.setAttribute('data-state', 'open')
    document.body.append(dialog)
    try {
      press(document.body, { key: 'z', ctrlKey: true })
      expect(undo).not.toHaveBeenCalled()
    } finally {
      dialog.remove()
    }
  })

  it('respects a handler that already claimed the key', () => {
    const undo = vi.fn()
    render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    event.preventDefault()
    document.body.dispatchEvent(event)
    expect(undo).not.toHaveBeenCalled()
  })

  it('stops dispatching once the component that registered a command unmounts', () => {
    const undo = vi.fn()
    const { unmount } = render(<Harness handlers={[{ id: 'edit.undo', run: undo }]} />)
    unmount()
    press(document.body, { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
  })
})
