import { renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { useUndoRedoShortcuts } from './useUndoRedoShortcuts'
import { useCardsStore } from '../state/useCardsStore'

describe('useUndoRedoShortcuts', () => {
  beforeEach(() => {
    const rootId = useCardsStore.getState().history.present[0].id
    useCardsStore.getState().loadCards(useCardsStore.getState().history.present)
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
})
