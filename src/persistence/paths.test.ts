import { describe, it, expect } from 'vitest'
import { fileNameOf, mindMapBaseName, parentDirOf, repairedCopyPath, separatorOf } from './paths'

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

  it('strips the .json extension whatever its case', () => {
    expect(mindMapBaseName('/cours/Chapitre 1.JSON')).toBe('Chapitre 1')
    expect(mindMapBaseName('/cours/sans-extension')).toBe('sans-extension')
  })
})

describe('repairedCopyPath', () => {
  it('names the copy « [Nom original] (Réparée).json », next to the original', () => {
    expect(repairedCopyPath('/cours/math/fractions.json')).toBe('/cours/math/fractions (Réparée).json')
    expect(repairedCopyPath('C:\\cours\\fractions.json')).toBe('C:\\cours\\fractions (Réparée).json')
  })

  it('numbers further attempts so an existing repair is never overwritten', () => {
    expect(repairedCopyPath('/cours/fractions.json', 2)).toBe('/cours/fractions (Réparée 2).json')
    expect(repairedCopyPath('/cours/fractions.json', 3)).toBe('/cours/fractions (Réparée 3).json')
  })

  it('always produces a .json file, even from a path that had no extension', () => {
    expect(repairedCopyPath('/cours/fractions')).toBe('/cours/fractions (Réparée).json')
    expect(repairedCopyPath('fractions.json')).toBe('fractions (Réparée).json')
  })
})
