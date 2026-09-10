import { describe, it, expect } from 'vitest'
import {
  fileNameOf,
  isInsideFolder,
  isMindMapPath,
  mindMapBaseName,
  parentDirOf,
  repairedCopyPath,
  sanitizeFileName,
  separatorOf,
  withMindMapExtension,
} from './paths'

describe('isInsideFolder', () => {
  it('accepts a file in the folder, whatever the separator or the case on a Windows path', () => {
    expect(isInsideFolder('C:\\Cours\\a.zmap', 'C:\\Cours')).toBe(true)
    expect(isInsideFolder('c:/cours/sous/b.zmap', 'C:/Cours')).toBe(true)
    expect(isInsideFolder('/home/eleve/cours/a.zmap', '/home/eleve/cours')).toBe(true)
    expect(isInsideFolder('C:\\Cours\\a.zmap', 'C:\\Cours\\')).toBe(true)
  })

  it('refuses a sibling folder whose name merely starts the same', () => {
    expect(isInsideFolder('C:\\Cours2\\a.zmap', 'C:\\Cours')).toBe(false)
    expect(isInsideFolder('/home/eleve/cours2/a.zmap', '/home/eleve/cours')).toBe(false)
  })

  it('keeps a POSIX path case-sensitive, unlike a Windows one', () => {
    expect(isInsideFolder('/home/Eleve/cours/a.zmap', '/home/eleve/cours')).toBe(false)
  })

  it('refuses a path outside the folder, and empty inputs', () => {
    expect(isInsideFolder('C:\\Autre\\a.zmap', 'C:\\Cours')).toBe(false)
    expect(isInsideFolder('', 'C:\\Cours')).toBe(false)
    expect(isInsideFolder('C:\\Cours\\a.zmap', '')).toBe(false)
  })
})

describe('path helpers', () => {
  it('reads the file name off both separators', () => {
    expect(fileNameOf('/cours/math/chap.json')).toBe('chap.json')
    expect(fileNameOf('C:\\cours\\math\\chap.json')).toBe('chap.json')
    expect(fileNameOf('chap.json')).toBe('chap.json')
  })

  it('reads the parent directory off both separators', () => {
    expect(parentDirOf('/cours/math/chap.json')).toBe('/cours/math')
    expect(parentDirOf('C:\\cours\\chap.json')).toBe('C:\\cours')
    expect(parentDirOf('chap.json')).toBe('')
  })

  it('keeps the separator the original path uses', () => {
    expect(separatorOf('C:\\cours\\chap.json')).toBe('\\')
    expect(separatorOf('/cours/chap.json')).toBe('/')
  })

  it('strips a mind-map extension whatever its case', () => {
    expect(mindMapBaseName('/cours/Chapitre 1.ZMAP')).toBe('Chapitre 1')
    expect(mindMapBaseName('/cours/Chapitre 1.JSON')).toBe('Chapitre 1')
    expect(mindMapBaseName('/cours/sans-extension')).toBe('sans-extension')
  })
})

describe('isMindMapPath', () => {
  it('recognises the extension the app writes', () => {
    expect(isMindMapPath('/cours/fractions.zmap')).toBe(true)
    expect(isMindMapPath('C:\\cours\\Fractions.ZMAP')).toBe(true)
  })

  it('still recognises a map written before .zmap existed', () => {
    expect(isMindMapPath('/cours/fractions.json')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isMindMapPath('/cours/notes.pdf')).toBe(false)
    expect(isMindMapPath('/cours/sans-extension')).toBe(false)
    // Not a suffix match on the bare word: only a real extension counts.
    expect(isMindMapPath('/cours/zmap')).toBe(false)
  })
})

describe('withMindMapExtension', () => {
  it('gives a bare name the extension the installer associates with the app', () => {
    expect(withMindMapExtension('Chapitre 3')).toBe('Chapitre 3.zmap')
  })

  it('leaves a name that already has one alone', () => {
    expect(withMindMapExtension('Chapitre 3.zmap')).toBe('Chapitre 3.zmap')
    // A legacy map keeps its own extension: re-saving one must not produce
    // « chapitre.json.zmap » beside the file the user has been editing.
    expect(withMindMapExtension('Chapitre 3.json')).toBe('Chapitre 3.json')
  })
})

describe('repairedCopyPath', () => {
  it('names the copy « [Nom original] (Réparée).zmap », next to the original', () => {
    expect(repairedCopyPath('/cours/math/fractions.zmap')).toBe('/cours/math/fractions (Réparée).zmap')
    expect(repairedCopyPath('C:\\cours\\fractions.zmap')).toBe('C:\\cours\\fractions (Réparée).zmap')
  })

  it('numbers further attempts so an existing repair is never overwritten', () => {
    expect(repairedCopyPath('/cours/fractions.zmap', 2)).toBe('/cours/fractions (Réparée 2).zmap')
    expect(repairedCopyPath('/cours/fractions.zmap', 3)).toBe('/cours/fractions (Réparée 3).zmap')
  })

  it('always produces a .zmap file, even from a path that had no extension', () => {
    expect(repairedCopyPath('/cours/fractions')).toBe('/cours/fractions (Réparée).zmap')
    expect(repairedCopyPath('fractions.zmap')).toBe('fractions (Réparée).zmap')
  })

  it('repairs a legacy .json map into a .zmap copy', () => {
    // The copy is a brand-new file, so it gets the current format — which is
    // also how a user migrates a map: open it, repair it, keep the copy.
    expect(repairedCopyPath('/cours/fractions.json')).toBe('/cours/fractions (Réparée).zmap')
  })
})

describe('sanitizeFileName', () => {
  it('strips characters illegal in a file name', () => {
    expect(sanitizeFileName('Chapitre 3: Vecteurs/Forces')).toBe('Chapitre 3 Vecteurs Forces')
  })

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(sanitizeFileName('///')).toBe('Sans titre')
  })

  it('leaves an already-safe name untouched', () => {
    expect(sanitizeFileName('Chimie organique')).toBe('Chimie organique')
  })
})
