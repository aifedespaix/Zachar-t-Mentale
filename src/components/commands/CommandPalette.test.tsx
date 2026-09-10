import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CommandPalette, scoreCommand } from './CommandPalette'
import { useCommandRegistry } from '../../state/useCommandRegistry'
import { useShortcutSettingsStore } from '../../state/useShortcutSettingsStore'
import { commandById } from '../../types/commands'

function publish(id: string, run: () => void, enabled = true) {
  act(() => useCommandRegistry.getState().register(id as never, { run, enabled }))
}

describe('scoreCommand', () => {
  it('ranks a hit on the name above one buried in the explanation', () => {
    const rename = commandById('edit.rename')!
    const del = commandById('edit.delete')!
    expect(scoreCommand(rename, 'renommer')!).toBeLessThan(scoreCommand(del, 'confirmation')!)
  })

  it('ignores accents and case, because nobody types them into a search box', () => {
    expect(scoreCommand(commandById('card.addFloating')!, 'creer une carte')).not.toBeNull()
  })

  it('reports no match at all rather than a weak one', () => {
    expect(scoreCommand(commandById('edit.undo')!, 'xyzzy')).toBeNull()
  })
})

describe('CommandPalette', () => {
  beforeEach(() => {
    useCommandRegistry.setState({ registrations: {} })
    useShortcutSettingsStore.getState().resetAll()
  })

  it('shows each action with its category and its current shortcut', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText('Rechercher une commande'), 'annuler')
    const option = screen.getByRole('option', { name: /Annuler/ })
    expect(option).toHaveTextContent('Édition')
    expect(option).toHaveTextContent('Ctrl + Z')
  })

  it('runs the highlighted action on Entrée and closes', async () => {
    const user = userEvent.setup()
    const undo = vi.fn()
    const onOpenChange = vi.fn()
    publish('edit.undo', undo)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<CommandPalette open onOpenChange={onOpenChange} />)
      await user.type(screen.getByLabelText('Rechercher une commande'), 'annuler')
      await user.keyboard('{Enter}')
      expect(onOpenChange).toHaveBeenCalledWith(false)
      // Deferred by a tick so the closing dialog cannot steal focus from
      // whatever the command opens.
      act(() => vi.runAllTimers())
      expect(undo).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists an unavailable action, greyed, rather than hiding it', async () => {
    // « Coller la carte » missing looks like a missing feature; greyed out, it
    // says the clipboard is empty.
    const user = userEvent.setup()
    const paste = vi.fn()
    publish('edit.paste', paste, false)
    render(<CommandPalette open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText('Rechercher une commande'), 'coller')
    expect(screen.getByRole('option', { name: /Coller la carte/ })).toBeDisabled()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open onOpenChange={() => {}} />)
    await user.type(screen.getByLabelText('Rechercher une commande'), 'xyzzy')
    expect(screen.getByText(/Aucune commande ne correspond/)).toBeInTheDocument()
  })
})
