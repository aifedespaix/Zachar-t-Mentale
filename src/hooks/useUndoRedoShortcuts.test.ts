import { renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { useUndoRedoShortcuts } from './useUndoRedoShortcuts'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'

describe('useUndoRedoShortcuts', () => {
  beforeEach(() => {
    // The hook under test imports the module-level singleton, so isolation is
    // achieved by resetting that singleton's DATA slices to those of a
    // pristine store before every test. Only `history`/`locked` are copied:
    // the pristine store's action closures are bound to that throwaway store,
    // so copying them over would silently detach the singleton's actions.
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
    const rootId = useCardsStore.getState().history.present[0].id
    useCardsStore.getState().addChild(rootId)
  })

  it('undoes on Ctrl+Z', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())
    expect(useCardsStore.getState().history.present).toHaveLength(2)

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('redoes on Ctrl+Shift+Z', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(1)

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(2)
  })

  it('ignores Ctrl+Z while the focus is inside a text input (lets the field undo its own text)', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(2)

    input.remove()
  })

  it('ignores Ctrl+Z while the focus is inside a textarea', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(2)

    textarea.remove()
  })

  it('ignores Ctrl+Z while the focus is inside a contenteditable element', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.tabIndex = 0
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.appendChild(editable)
    editable.focus()

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(2)

    editable.remove()
  })
})
