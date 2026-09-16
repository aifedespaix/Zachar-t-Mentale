import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createBandFamiliesStorage } from './bandFamilies'

describe('createBandFamiliesStorage', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('part de rien quand rien n’a été réglé, et relit ce qu’il a écrit', () => {
    const storage = createBandFamiliesStorage({ key: 'test:families' })

    expect(storage.load()).toEqual([])

    storage.save(['Grec', 'Unités'])
    expect(storage.load()).toEqual(['Grec', 'Unités'])
  })

  it('accepte un réglage vide — tout réafficher est un choix, pas une absence', () => {
    const storage = createBandFamiliesStorage({ key: 'test:families' })
    storage.save(['Grec'])

    storage.save([])
    expect(storage.load()).toEqual([])
  })

  it('survit à un réglage illisible sans casser le bandeau', () => {
    const storage = createBandFamiliesStorage({ key: 'test:families' })

    localStorage.setItem('test:families', '{pas du json')
    expect(storage.load()).toEqual([])

    // Ni un JSON valide mais de la mauvaise forme.
    localStorage.setItem('test:families', '{"Grec":true}')
    expect(storage.load()).toEqual([])

    // Ni des entrées qui ne sont pas des noms.
    localStorage.setItem('test:families', '["Grec",42,null]')
    expect(storage.load()).toEqual(['Grec'])
  })

  it('ne jette pas quand le stockage est bloqué', () => {
    const storage = createBandFamiliesStorage({ key: 'test:families' })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('stockage bloqué')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('stockage bloqué')
    })

    expect(storage.load()).toEqual([])
    expect(() => storage.save(['Grec'])).not.toThrow()
  })
})
