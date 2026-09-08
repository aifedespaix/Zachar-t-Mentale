import { describe, it, expect } from 'vitest'
import { describeExportError } from './describeExportError'

describe('describeExportError', () => {
  it('uses the message of a real Error', () => {
    expect(describeExportError(new Error('disque plein'))).toBe('disque plein')
  })

  it('names the image when html-to-image rejects with an image load Event', () => {
    // This is the actual rejection shape: an Event, not an Error. The generic
    // `instanceof Error` check reported "erreur inconnue" here.
    const image = document.createElement('img')
    image.src = 'http://asset.localhost/cartes/schema.png'
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: image })

    const described = describeExportError(event)
    expect(described).toContain('image')
    expect(described).toContain('schema.png')
    expect(described).not.toContain('inconnue')
  })

  it('still describes a non-image resource Event', () => {
    expect(describeExportError(new Event('error'))).toContain('ressource')
  })

  it('passes a non-empty string through', () => {
    expect(describeExportError('quota dépassé')).toBe('quota dépassé')
  })

  it('falls back for anything else', () => {
    expect(describeExportError(null)).toBe('erreur inconnue')
    expect(describeExportError('')).toBe('erreur inconnue')
    expect(describeExportError({ nope: true })).toBe('erreur inconnue')
  })
})
