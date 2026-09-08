import { describe, it, expect } from 'vitest'
import { windowTitleFor } from './windowTitle'

describe('windowTitleFor', () => {
  it('is just the app name when no file is open', () => {
    expect(windowTitleFor(null)).toBe("Zachar’t Mentale")
  })

  it('appends the open file\'s name, without its extension', () => {
    expect(windowTitleFor('/cours/math/fractions.json')).toBe("Zachar’t Mentale - fractions")
  })

  it('reads the file name off a Windows path too', () => {
    expect(windowTitleFor('C:\\cours\\Nombres relatifs.json')).toBe("Zachar’t Mentale - Nombres relatifs")
  })
})
