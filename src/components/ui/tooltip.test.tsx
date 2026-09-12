import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

function show() {
  return render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Bouton</TooltipTrigger>
        <TooltipContent>Astuce</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe('TooltipProvider', () => {
  it('ferme le tooltip dès que la souris quitte le déclencheur, même en passant par le tooltip', async () => {
    const user = userEvent.setup()
    show()

    await user.hover(screen.getByText('Bouton'))
    await waitFor(() => expect(screen.getByText('Astuce')).toBeInTheDocument())

    await user.unhover(screen.getByText('Bouton'))
    await waitFor(() => expect(screen.queryByText('Astuce')).not.toBeInTheDocument())
  })
})
