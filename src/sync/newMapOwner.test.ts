import { describe, it, expect } from 'vitest'
import { newMapOwner } from './newMapOwner'

const LEA = { username: 'lea', role: 'eleve' as const }
const PROF = { username: 'aife', role: 'prof' as const }

describe('newMapOwner', () => {
  it('donne la carte au compte connecté quand elle naît dans le dossier synchronisé', () => {
    expect(newMapOwner({ folderPath: '/cours/maths', currentUser: LEA, syncFolderPath: '/cours' })).toEqual(LEA)
  })

  it('vaut aussi à la racine du dossier synchronisé, pas seulement dans ses sous-dossiers', () => {
    expect(newMapOwner({ folderPath: '/cours', currentUser: PROF, syncFolderPath: '/cours' })).toEqual(PROF)
  })

  it('ne distingue pas élève et prof : les deux voient leurs cartes se synchroniser par défaut', () => {
    const asEleve = newMapOwner({ folderPath: '/cours', currentUser: LEA, syncFolderPath: '/cours' })
    const asProf = newMapOwner({ folderPath: '/cours', currentUser: PROF, syncFolderPath: '/cours' })
    expect(asEleve?.role).toBe('eleve')
    expect(asProf?.role).toBe('prof')
  })

  it('refuse hors du dossier synchronisé : rien ne pousserait jamais ce fichier', () => {
    expect(newMapOwner({ folderPath: '/brouillons', currentUser: LEA, syncFolderPath: '/cours' })).toBeNull()
  })

  it('n’est pas trompé par un dossier voisin dont le nom commence pareil', () => {
    expect(newMapOwner({ folderPath: '/cours-perso', currentUser: LEA, syncFolderPath: '/cours' })).toBeNull()
  })

  it('refuse sans compte connecté : il n’y a pas d’auteur à inscrire', () => {
    expect(newMapOwner({ folderPath: '/cours', currentUser: null, syncFolderPath: '/cours' })).toBeNull()
  })

  it('refuse quand la synchronisation n’est pas configurée', () => {
    expect(newMapOwner({ folderPath: '/cours', currentUser: LEA, syncFolderPath: null })).toBeNull()
  })
})
