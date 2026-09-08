import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './context-menu'

describe('ContextMenu', () => {
  it('opens on right-click and runs an item\'s handler on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <div>Ligne</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Action</ContextMenuItem>
          <ContextMenuSeparator />
        </ContextMenuContent>
      </ContextMenu>
    )

    expect(screen.queryByRole('menuitem', { name: 'Action' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('Ligne'))
    await user.click(await screen.findByRole('menuitem', { name: 'Action' }))

    expect(onSelect).toHaveBeenCalled()
  })
})
