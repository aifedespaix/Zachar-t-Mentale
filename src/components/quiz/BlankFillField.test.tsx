import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlankFillField } from './BlankFillField'
import { revealedSet } from '../../quiz/blanks'

/** The rendered feedback colours, as the DOM reports them. */
const GREEN = 'rgb(22, 163, 74)'
const RED = 'rgb(220, 38, 38)'

/** The colour of each drawn letter box, in order. */
function letterColors(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[aria-hidden] > span')].map(el => getComputedStyle(el).color)
}

/** Wraps the controlled field so tests can type into it like a real user. */
function Harness({
  target,
  extraReveals = 0,
  ...rest
}: {
  target: string
  extraReveals?: number
  liveFeedback?: boolean
  gradedSnapshot?: readonly string[] | null
  onSubmit?: () => void
}) {
  const [typed, setTyped] = useState<string[]>([])
  return (
    <BlankFillField
      target={target}
      revealed={revealedSet(target, 'difficile', extraReveals)}
      typed={typed}
      onTypedChange={setTyped}
      {...rest}
    />
  )
}

describe('BlankFillField', () => {
  it('shows the revealed letters and the structure of the answer', () => {
    render(<Harness target="Bonsoir" />)

    // The first letter is conceded even at the hardest level.
    expect(screen.getByLabelText('Réponse').closest('div')).toHaveTextContent('B')
  })

  it('caps typing at the number of missing letters, so the answer cannot overflow', () => {
    render(<Harness target="Bonsoir" />)
    // Six letters hidden behind the conceded "B".
    expect(screen.getByLabelText('Réponse')).toHaveAttribute('maxLength', '6')
  })

  it('asks only for the letters that are missing, not for spaces or punctuation', () => {
    render(<Harness target="le mot" />)
    // "le mot" has 5 letters; the first is revealed, the space is free.
    expect(screen.getByLabelText('Réponse')).toHaveAttribute('maxLength', '4')
  })

  it('accepts typed letters into the blanks', async () => {
    const user = userEvent.setup()
    render(<Harness target="Bonsoir" />)

    await user.type(screen.getByLabelText('Réponse'), 'onsoir')

    expect(screen.getByLabelText('Réponse')).toHaveValue('onsoir')
  })

  it('shrinks the field as help is handed over, so given letters are not retyped', () => {
    render(<Harness target="Bonsoir" extraReveals={2} />)
    expect(screen.getByLabelText('Réponse')).toHaveAttribute('maxLength', '4')
  })

  it('submits on Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness target="Bonsoir" onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Réponse'), 'onsoir{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('stays uncoloured while typing by default — live grading would give the answer away letter by letter', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness target="Bonsoir" />)

    await user.type(screen.getByLabelText('Réponse'), 'onjour')

    expect(letterColors(container)).not.toContain(GREEN)
    expect(letterColors(container)).not.toContain(RED)
  })

  it('colours letters as they are typed when live feedback is switched on', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness target="Bonsoir" liveFeedback />)

    await user.type(screen.getByLabelText('Réponse'), 'onjour')

    // Typing "onjour" over "B(onsoir)": o-n match, j does not, o matches,
    // u does not, r matches.
    expect(letterColors(container).slice(1)).toEqual([GREEN, GREEN, RED, GREEN, RED, GREEN])
  })

  it('colours right and wrong letters against a graded snapshot', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(<Harness target="Bonsoir" />)

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    expect(letterColors(container)).not.toContain(RED)

    rerender(<Harness target="Bonsoir" gradedSnapshot={['o', 'n', 'j', 'o', 'u', 'r']} />)

    expect(letterColors(container).slice(1)).toEqual([GREEN, GREEN, RED, GREEN, RED, GREEN])
  })

  it('reverts a box to uncoloured once its letter is edited after grading, but leaves the others alone', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(<Harness target="Bonsoir" />)

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    rerender(<Harness target="Bonsoir" gradedSnapshot={['o', 'n', 'j', 'o', 'u', 'r']} />)

    // Fix the wrong "j" (third editable box, index 2) without touching the rest.
    const input = screen.getByLabelText('Réponse') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'onsour', selectionStart: 3 } })

    const colors = letterColors(container).slice(1)
    expect(colors[2]).not.toBe(RED)
    expect(colors[2]).not.toBe(GREEN)
    expect([colors[0], colors[1], colors[3], colors[4], colors[5]]).toEqual([GREEN, GREEN, GREEN, RED, GREEN])
  })

  it('positions the input cursor where an already-answered box is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness target="Bonsoir" />)
    const input = screen.getByLabelText('Réponse') as HTMLInputElement

    await user.type(input, 'ons')
    const boxes = container.querySelectorAll('[aria-hidden] > span')
    await user.click(boxes[2]) // the "n" box — editable position 1

    expect(input.selectionStart).toBe(1)
  })

  it('clamps a click on a box further ahead than what is typed to the end of the typed text', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness target="Bonsoir" />)
    const input = screen.getByLabelText('Réponse') as HTMLInputElement

    await user.type(input, 'on')
    const boxes = container.querySelectorAll('[aria-hidden] > span')
    await user.click(boxes[6]) // the "r" box — editable position 5, well beyond what's typed

    expect(input.selectionStart).toBe(2)
  })

  it('absorbs a keystroke that only repeats a letter the field just skipped', async () => {
    function BarbeHarness() {
      const [typed, setTyped] = useState<string[]>([])
      return (
        <BlankFillField target="barbe" revealed={new Set([2])} typed={typed} onTypedChange={setTyped} />
      )
    }
    const user = userEvent.setup()
    render(<BarbeHarness />)
    const input = screen.getByLabelText('Réponse') as HTMLInputElement

    // "barbe": b-a-r-b-e, "r" (index 2) revealed. Typing "b","a" then "r" out
    // of habit must not land in the box that wants the second "b".
    await user.type(input, 'bar')

    expect(input).toHaveValue('ba')
  })

  it('leaves an empty box uncoloured rather than marking it wrong', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness target="Bonsoir" liveFeedback />)

    await user.type(screen.getByLabelText('Réponse'), 'on')

    expect(letterColors(container).slice(3)).not.toContain(RED)
  })

  it('cannot be typed into once disabled', async () => {
    const user = userEvent.setup()
    render(
      <BlankFillField
        target="Bonsoir"
        revealed={revealedSet('Bonsoir', 'difficile')}
        typed={[]}
        onTypedChange={() => {}}
        disabled
      />
    )

    await user.type(screen.getByLabelText('Réponse'), 'onsoir')

    expect(screen.getByLabelText('Réponse')).toHaveValue('')
  })

  it('leaves nothing to type when every letter has been revealed', () => {
    render(<Harness target="Bonsoir" extraReveals={99} />)
    expect(screen.getByLabelText('Réponse')).toHaveAttribute('maxLength', '0')
  })
})
