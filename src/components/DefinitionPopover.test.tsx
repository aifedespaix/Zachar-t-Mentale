// src/components/DefinitionPopover.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DefinitionPopover } from './DefinitionPopover'
import type { CardBlock } from '../types/cardBlock'

const text = (value: string): CardBlock[] => [{ kind: 'text', text: value }]

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
}

describe('DefinitionPopover', () => {
  it('shows the definition text once opened', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover blocks={text('Une définition')} locked={false} onCommit={() => {}} />)

    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
    await openPopover(user)
    expect(screen.getByText('Une définition')).toBeInTheDocument()
  })

  it('opens an editable field when the definition is clicked, and commits it', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover blocks={text('Une définition')} locked={false} onCommit={onCommit} />)

    await openPopover(user)
    await user.click(screen.getByText('Une définition'))
    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.clear(field)
    await user.type(field, 'Nouvelle définition')
    await user.click(screen.getByRole('button', { name: /terminer/i }))

    expect(onCommit).toHaveBeenCalledWith([{ kind: 'text', text: 'Nouvelle définition' }])
  })

  it('does not open the definition for editing when the mind map is locked', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover blocks={text('Une définition')} locked onCommit={() => {}} />)

    await openPopover(user)
    await user.click(screen.getByText('Une définition'))

    expect(screen.queryByRole('textbox', { name: /texte du bloc 1/i })).not.toBeInTheDocument()
  })

  it('cancels the edit on Escape without calling onCommit', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover blocks={text('Une définition')} locked={false} onCommit={onCommit} />)

    await openPopover(user)
    await user.click(screen.getByText('Une définition'))
    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' annulé{Escape}')

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the draft when the popover is closed by clicking away', async () => {
    // The path most people take. The block rewrite dropped the old field's
    // commit-on-blur, so every draft was silently discarded unless the user
    // found the « Terminer » link.
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover blocks={text('Avant')} locked={false} onCommit={onCommit} />)

    await openPopover(user)
    await user.click(screen.getByText('Avant'))
    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.clear(field)
    await user.type(field, 'Un long paragraphe que je viens de taper')
    await user.click(document.body)

    expect(onCommit).toHaveBeenCalledWith([
      { kind: 'text', text: 'Un long paragraphe que je viens de taper' },
    ])
  })

  it('does not commit when the popover is closed without an edit in progress', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover blocks={text('Intacte')} locked={false} onCommit={onCommit} />)

    await openPopover(user)
    await user.click(document.body)

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('re-seeds the draft from the card on each edit, so a stale draft cannot be committed later', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    const { rerender } = render(
      <DefinitionPopover blocks={text('Version 1')} locked={false} onCommit={onCommit} />
    )

    await openPopover(user)
    await user.click(screen.getByText('Version 1'))
    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' modifiée{Escape}')

    // Escape cancels the edit AND closes the popover (Radix's own behaviour),
    // so the next edit starts from a reopen — which is exactly the path where
    // a stale draft would leak if the component kept one.
    rerender(<DefinitionPopover blocks={text('Version 2')} locked={false} onCommit={onCommit} />)
    await openPopover(user)
    await user.click(screen.getByText('Version 2'))
    await user.click(screen.getByRole('button', { name: /terminer/i }))

    expect(onCommit).toHaveBeenCalledWith([{ kind: 'text', text: 'Version 2' }])
  })

  it('keeps one fixed width whatever the content holds', async () => {
    // Règle anti-décalage 2: a formula, a table and a picture must all occupy
    // the same box, or opening two different cards moves the popover under the
    // pointer.
    const user = userEvent.setup()
    const { rerender } = render(<DefinitionPopover blocks={text('Court')} locked={false} onCommit={() => {}} />)
    await openPopover(user)
    const width = () => (screen.getByText(/définition/i).closest('[style*="width"]') as HTMLElement).style.width

    const short = width()
    rerender(
      <DefinitionPopover
        blocks={[{ kind: 'table', header: ['a', 'b', 'c'], rows: [['1', '2', '3']] }]}
        locked={false}
        onCommit={() => {}}
      />
    )
    expect(width()).toBe(short)
  })

  it('renders a formula as typeset markup rather than its LaTeX source', async () => {
    const user = userEvent.setup()
    render(
      <DefinitionPopover blocks={[{ kind: 'math', latex: '\\frac{1}{2}' }]} locked={false} onCommit={() => {}} />
    )
    await openPopover(user)
    expect(document.querySelector('.katex')).not.toBeNull()
  })

  describe('the input-mode selector', () => {
    it('switches the active block to a formula, keeping what was typed', async () => {
      // Règle 6: reversible, so the selector is safe to explore.
      const user = userEvent.setup()
      const onCommit = vi.fn()
      render(<DefinitionPopover blocks={text('x^2')} locked={false} onCommit={onCommit} />)

      await openPopover(user)
      await user.click(screen.getByText('x^2'))
      await user.click(screen.getByRole('button', { name: /^formule$/i }))
      await user.click(screen.getByRole('button', { name: /terminer/i }))

      expect(onCommit).toHaveBeenCalledWith([{ kind: 'math', latex: 'x^2' }])
    })

    it('switches back to text without losing the formula source', async () => {
      const user = userEvent.setup()
      const onCommit = vi.fn()
      render(<DefinitionPopover blocks={[{ kind: 'math', latex: 'x^2' }]} locked={false} onCommit={onCommit} />)

      await openPopover(user)
      await user.click(screen.getByTestId('definition-body'))
      await user.click(screen.getByRole('button', { name: /^texte$/i }))
      await user.click(screen.getByRole('button', { name: /terminer/i }))

      expect(onCommit).toHaveBeenCalledWith([{ kind: 'text', text: 'x^2' }])
    })

    it('converts a text block to a formula in place when the user types $$', async () => {
      const user = userEvent.setup()
      const onCommit = vi.fn()
      render(<DefinitionPopover blocks={text('')} locked={false} onCommit={onCommit} />)

      await openPopover(user)
      await user.click(screen.getByTestId('definition-body'))
      await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), 'a+b$$')
      await user.click(screen.getByRole('button', { name: /terminer/i }))

      expect(onCommit).toHaveBeenCalledWith([{ kind: 'math', latex: 'a+b' }])
    })

    it('adds a second block through the permanent gutter, keeping the first', async () => {
      const user = userEvent.setup()
      const onCommit = vi.fn()
      render(<DefinitionPopover blocks={text('La règle')} locked={false} onCommit={onCommit} />)

      await openPopover(user)
      await user.click(screen.getByText('La règle'))
      await user.click(screen.getByRole('button', { name: /ajouter un bloc/i }))
      await user.type(screen.getByRole('textbox', { name: /texte du bloc 2/i }), 'Un exemple')
      await user.click(screen.getByRole('button', { name: /terminer/i }))

      expect(onCommit).toHaveBeenCalledWith([
        { kind: 'text', text: 'La règle' },
        { kind: 'text', text: 'Un exemple' },
      ])
    })

    it('removes a block', async () => {
      const user = userEvent.setup()
      const onCommit = vi.fn()
      render(
        <DefinitionPopover
          blocks={[{ kind: 'text', text: 'garder' }, { kind: 'text', text: 'jeter' }]}
          locked={false}
          onCommit={onCommit}
        />
      )

      await openPopover(user)
      await user.click(screen.getByText('garder'))
      await user.click(screen.getByRole('button', { name: /supprimer le bloc 2/i }))
      await user.click(screen.getByRole('button', { name: /terminer/i }))

      expect(onCommit).toHaveBeenCalledWith([{ kind: 'text', text: 'garder' }])
    })
  })
})
