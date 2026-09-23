import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { rawFieldKeyDown, type RawFieldIntents } from './fieldIntents'

function mount(intents: RawFieldIntents, value = 'abc') {
  render(<input aria-label="champ" defaultValue={value} onKeyDown={rawFieldKeyDown(intents)} />)
  const input = screen.getByRole('textbox', { name: 'champ' }) as HTMLInputElement
  const caret = (start: number, end = start) => input.setSelectionRange(start, end)
  // `fireEvent` renvoie `false` quand le gestionnaire a appelé `preventDefault`.
  const press = (init: Parameters<typeof fireEvent.keyDown>[1]) => !fireEvent.keyDown(input, init)
  return { input, caret, press }
}

describe(`rawFieldKeyDown — flèches`, () => {
  it(`← au début et → en fin sortent ; ailleurs, natif`, () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(1)
    expect(press({ key: 'ArrowLeft' })).toBe(false)
    caret(0)
    expect(press({ key: 'ArrowLeft' })).toBe(true)
    caret(3)
    expect(press({ key: 'ArrowRight' })).toBe(true)
    expect(onExit.mock.calls).toEqual([['left', 'arrow'], ['right', 'arrow']])
  })

  it(`↑/↓ sortent toujours : un champ brut n'a pas de navigation verticale`, () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(1)
    expect(press({ key: 'ArrowUp' })).toBe(true)
    expect(press({ key: 'ArrowDown' })).toBe(true)
    expect(onExit.mock.calls).toEqual([['up', 'arrow'], ['down', 'arrow']])
  })

  it(`une flèche modifiée (Alt, Maj, Ctrl) n'est jamais une sortie`, () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(0)
    expect(press({ key: 'ArrowUp', altKey: true })).toBe(false)
    expect(press({ key: 'ArrowLeft', shiftKey: true })).toBe(false)
    expect(press({ key: 'ArrowLeft', ctrlKey: true })).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })

  it(`une sélection non vide reste au navigateur`, () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(0, 2)
    expect(press({ key: 'ArrowLeft' })).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe(`rawFieldKeyDown — Retour arrière / Suppr`, () => {
  it(`au bord : l'intention reçoit tout le contenu`, () => {
    const onBackspaceAtStart = vi.fn()
    const onDeleteAtEnd = vi.fn()
    const { caret, press } = mount({ onBackspaceAtStart, onDeleteAtEnd })
    caret(0)
    expect(press({ key: 'Backspace' })).toBe(true)
    caret(3)
    expect(press({ key: 'Delete' })).toBe(true)
    expect(onBackspaceAtStart).toHaveBeenCalledWith('abc')
    expect(onDeleteAtEnd).toHaveBeenCalledWith('abc')
  })

  it(`anti-rafale : une touche répétée au bord est avalée sans rien déclencher`, () => {
    const onBackspaceAtStart = vi.fn()
    const onDeleteAtEnd = vi.fn()
    const { caret, press } = mount({ onBackspaceAtStart, onDeleteAtEnd }, '')
    caret(0)
    expect(press({ key: 'Backspace', repeat: true })).toBe(true)
    expect(press({ key: 'Delete', repeat: true })).toBe(true)
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
    expect(onDeleteAtEnd).not.toHaveBeenCalled()
  })

  it(`pas au bord : natif`, () => {
    const onBackspaceAtStart = vi.fn()
    const { caret, press } = mount({ onBackspaceAtStart })
    caret(2)
    expect(press({ key: 'Backspace' })).toBe(false)
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
  })
})

describe(`rawFieldKeyDown — touche d'effacement maintenue`, () => {
  // Deux champs bruts : l'intention au bord du premier passe au second (fin
  // pour Retour arrière, début pour Suppr), comme un champ voisin de la
  // description.
  function mountPair() {
    const secondKeyDown = vi.fn()
    render(
      <>
        <input
          aria-label="premier"
          defaultValue="abc"
          onKeyDown={rawFieldKeyDown({
            onBackspaceAtStart: () => {
              second.focus()
              second.setSelectionRange(3, 3)
            },
            onDeleteAtEnd: () => {
              second.focus()
              second.setSelectionRange(0, 0)
            },
          })}
        />
        <input aria-label="second" defaultValue="xyz" onKeyDown={secondKeyDown} />
      </>
    )
    const first = screen.getByRole('textbox', { name: 'premier' }) as HTMLInputElement
    const second = screen.getByRole('textbox', { name: 'second' }) as HTMLInputElement
    return { first, second, secondKeyDown }
  }

  it(`Retour arrière maintenu : les répétitions dans le champ d'arrivée sont avalées`, () => {
    const { first, second, secondKeyDown } = mountPair()
    first.setSelectionRange(0, 0)
    fireEvent.keyDown(first, { key: 'Backspace' })
    expect(second).toHaveFocus()

    // `fireEvent` renvoie `false` quand la touche a été empêchée.
    expect(fireEvent.keyDown(second, { key: 'Backspace', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(second, { key: 'Backspace', repeat: true })).toBe(false)
    expect(secondKeyDown).not.toHaveBeenCalled()

    // Touche relâchée : un nouvel appui (même répété ensuite) efface normalement.
    fireEvent.keyUp(second, { key: 'Backspace' })
    expect(fireEvent.keyDown(second, { key: 'Backspace' })).toBe(true)
    expect(fireEvent.keyDown(second, { key: 'Backspace', repeat: true })).toBe(true)
    expect(secondKeyDown).toHaveBeenCalledTimes(2)
  })

  it(`Suppr maintenu : même garde, et un autre appui la lève`, () => {
    const { first, second, secondKeyDown } = mountPair()
    first.setSelectionRange(3, 3)
    fireEvent.keyDown(first, { key: 'Delete' })
    expect(second).toHaveFocus()

    expect(fireEvent.keyDown(second, { key: 'Delete', repeat: true })).toBe(false)
    // Une AUTRE touche n'est jamais avalée, et elle lève la garde.
    expect(fireEvent.keyDown(second, { key: 'x' })).toBe(true)
    expect(fireEvent.keyDown(second, { key: 'Delete', repeat: true })).toBe(true)
    expect(secondKeyDown).toHaveBeenCalledTimes(2)
  })
})

describe(`rawFieldKeyDown — composition (IME)`, () => {
  it(`une touche pendant une composition reste à l'IME`, () => {
    const onEnter = vi.fn()
    const onBackspaceAtStart = vi.fn()
    const { caret, press } = mount({ onEnter, onBackspaceAtStart })
    caret(0)
    expect(press({ key: 'Enter', isComposing: true })).toBe(false)
    expect(press({ key: 'Backspace', isComposing: true })).toBe(false)
    expect(onEnter).not.toHaveBeenCalled()
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
  })
})

describe(`rawFieldKeyDown — Entrée`, () => {
  it(`Entrée coupe au curseur`, () => {
    const onEnter = vi.fn()
    const { caret, press } = mount({ onEnter })
    caret(1)
    expect(press({ key: 'Enter' })).toBe(true)
    expect(onEnter).toHaveBeenCalledWith('a', 'bc')
  })

  it(`Ctrl+Entrée hors groupe, Ctrl+Maj+Entrée dans le groupe`, () => {
    const onEnterBlock = vi.fn()
    const { press } = mount({ onEnterBlock, onEnter: vi.fn() })
    press({ key: 'Enter', ctrlKey: true })
    press({ key: 'Enter', metaKey: true, shiftKey: true })
    expect(onEnterBlock.mock.calls).toEqual([['outside'], ['inside']])
  })

  it(`Ctrl+Entrée sans bloc à créer (cellule) : une ligne`, () => {
    const onEnter = vi.fn()
    const { caret, press } = mount({ onEnter })
    caret(3)
    press({ key: 'Enter', ctrlKey: true })
    expect(onEnter).toHaveBeenCalledWith('abc', '')
  })

  it(`Maj+Entrée est avalée : un champ brut n'a pas de rangées`, () => {
    const onEnter = vi.fn()
    const { press } = mount({ onEnter })
    expect(press({ key: 'Enter', shiftKey: true })).toBe(true)
    expect(onEnter).not.toHaveBeenCalled()
  })
})

describe(`rawFieldKeyDown — Tab`, () => {
  it(`avec tabExits : champ voisin`, () => {
    const onExit = vi.fn()
    const { press } = mount({ onExit, tabExits: true })
    expect(press({ key: 'Tab' })).toBe(true)
    expect(press({ key: 'Tab', shiftKey: true })).toBe(true)
    expect(onExit.mock.calls).toEqual([['right', 'tab'], ['left', 'tab']])
  })

  it(`nulle part où aller (onExit → false) : Tab reste au navigateur`, () => {
    const { press } = mount({ onExit: () => false, tabExits: true })
    expect(press({ key: 'Tab' })).toBe(false)
  })

  it(`sans tabExits : type du bloc`, () => {
    const onSwitchKind = vi.fn()
    const { press } = mount({ onSwitchKind })
    press({ key: 'Tab', shiftKey: true })
    expect(onSwitchKind).toHaveBeenCalledWith(-1)
  })
})
