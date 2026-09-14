import { describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileTree, type TreeCallbacks } from './FileTree'
import { buildTree, type LibraryMap } from '@/lib/tree'

function map(path: string, overrides: Partial<LibraryMap> = {}): LibraryMap {
  return {
    id: `rec-${path}`,
    file_id: `file-${path}`,
    author: 'eleve1',
    path,
    type: '',
    updated: new Date().toISOString(),
    ...overrides,
  }
}

function setup(options: { expanded?: string[]; maps?: LibraryMap[]; conflicts?: string[] } = {}) {
  const callbacks: TreeCallbacks = {
    onOpenMap: vi.fn(),
    onActions: vi.fn(),
    isExpanded: path => (options.expanded ?? []).includes(path),
    toggle: vi.fn(),
    conflictedFileIds: new Set(options.conflicts ?? []),
  }
  const nodes = buildTree(options.maps ?? [map('Maths/Chapitre 1.zmap'), map('Racine.zmap')])
  render(<FileTree nodes={nodes} callbacks={callbacks} />)
  return callbacks
}

describe('FileTree', () => {
  it('shows the folders without unfolding them', () => {
    setup()
    expect(screen.getByText('Maths')).toBeInTheDocument()
    expect(screen.queryByText('Chapitre 1.zmap')).not.toBeInTheDocument()
  })

  it('reveals the contents of an expanded folder', () => {
    setup({ expanded: ['Maths'] })
    expect(screen.getByText('Chapitre 1.zmap')).toBeInTheDocument()
  })

  it('folds and unfolds on a tap anywhere on the row, not only on the chevron', async () => {
    const callbacks = setup()
    await userEvent.click(screen.getByText('Maths'))
    expect(callbacks.toggle).toHaveBeenCalledWith('Maths')
  })

  it('opens a map on a tap', async () => {
    const callbacks = setup()
    await userEvent.click(screen.getByText('Racine.zmap'))
    expect(callbacks.onOpenMap).toHaveBeenCalledWith(expect.objectContaining({ path: 'Racine.zmap' }))
  })

  it('gives every row its own actions button, labelled for a screen reader', async () => {
    const callbacks = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Actions sur Racine.zmap' }))
    expect(callbacks.onActions).toHaveBeenCalledWith(expect.objectContaining({ path: 'Racine.zmap' }))
  })

  it('says a folder is empty rather than leaving a blank gap', () => {
    render(
      <FileTree
        nodes={buildTree([], [{ id: 'f', path: 'Vide' }])}
        callbacks={{
          onOpenMap: vi.fn(),
          onActions: vi.fn(),
          isExpanded: () => true,
          toggle: vi.fn(),
          conflictedFileIds: new Set(),
        }}
      />
    )
    expect(screen.getByText('Dossier vide')).toBeInTheDocument()
  })

  it('marks a map in conflict so it is spotted without opening anything', () => {
    setup({ expanded: ['Maths'], conflicts: ['file-Maths/Chapitre 1.zmap'] })
    expect(screen.getByTitle('Conflit à trancher')).toBeInTheDocument()
  })

  it('shows a type pill only for a classified map', () => {
    setup({ maps: [map('a.zmap', { type: 'cours' }), map('b.zmap')] })
    expect(screen.getByText('Cours')).toBeInTheDocument()
    expect(screen.queryByText('Sans type')).not.toBeInTheDocument()
  })
})

describe('FileTree — appui long', () => {
  /** Un événement de pointeur tactile, que jsdom ne fabrique pas tout seul. */
  function touch(type: string, x = 0, y = 0) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>
    event.pointerType = 'touch'
    event.clientX = x
    event.clientY = y
    return event
  }

  it('opens the actions after a long press, for whoever has the reflex', () => {
    vi.useFakeTimers()
    try {
      const callbacks = setup()
      const row = screen.getByText('Racine.zmap').closest('button')!

      act(() => {
        row.dispatchEvent(touch('pointerdown'))
      })
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(callbacks.onActions).toHaveBeenCalledWith(expect.objectContaining({ path: 'Racine.zmap' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('never fires when the finger was in fact starting to scroll', () => {
    vi.useFakeTimers()
    try {
      const callbacks = setup()
      const row = screen.getByText('Racine.zmap').closest('button')!

      act(() => {
        row.dispatchEvent(touch('pointerdown', 0, 0))
        // Un vrai défilement : le doigt part, et le menu ne doit pas surgir en
        // plein glissement.
        row.dispatchEvent(touch('pointermove', 0, 40))
      })
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(callbacks.onActions).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('tolerates the tremble of a finger held still', () => {
    vi.useFakeTimers()
    try {
      const callbacks = setup()
      const row = screen.getByText('Racine.zmap').closest('button')!

      act(() => {
        row.dispatchEvent(touch('pointerdown', 0, 0))
        row.dispatchEvent(touch('pointermove', 2, 3))
      })
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(callbacks.onActions).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the mouse alone: it has the ⋮ button and the system menu', () => {
    vi.useFakeTimers()
    try {
      const callbacks = setup()
      const row = screen.getByText('Racine.zmap').closest('button')!
      const event = new Event('pointerdown', { bubbles: true }) as Event & Record<string, unknown>
      event.pointerType = 'mouse'

      act(() => {
        row.dispatchEvent(event)
      })
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(callbacks.onActions).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
