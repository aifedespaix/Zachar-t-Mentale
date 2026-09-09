// src/components/sidebar/ExportDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './ExportDialog'
import type { Card } from '../../types/card'

vi.mock('../../export/exportMindMap', () => ({
  exportToPdfBytes: vi.fn(async () => new Uint8Array([1])),
  exportToImageDataUrls: vi.fn(async () => ['data:image/png;base64,AA==']),
}))
vi.mock('../../xmind/exportXmind', () => ({ writeXmindFile: vi.fn(async () => new Uint8Array([2])) }))
vi.mock('../../persistence/exportIO', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/exportIO')>()
  return { ...actual, saveBytesAs: vi.fn(async () => '/out/chapitre.pdf') }
})

import { exportToPdfBytes, exportToImageDataUrls } from '../../export/exportMindMap'
import { writeXmindFile } from '../../xmind/exportXmind'
import { saveBytesAs } from '../../persistence/exportIO'

const cards: Card[] = [{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }]

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.mocked(exportToPdfBytes).mockClear()
    vi.mocked(exportToImageDataUrls).mockClear()
    vi.mocked(writeXmindFile).mockClear()
    vi.mocked(saveBytesAs).mockClear()
  })

  it('exports PDF by default (with definitions shown and detached cards excluded) and closes on success', async () => {
    const onClose = vi.fn()
    const onError = vi.fn()
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={onClose} onError={onError} />)

    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(exportToPdfBytes).toHaveBeenCalledWith(cards, {
      showDefinitions: true,
      includeDetached: false,
      mindMapPath: null,
    })
    expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([1]), 'chapitre.pdf', [{ name: 'PDF', extensions: ['pdf'] }])
    expect(onClose).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('exports XMind when that format is selected', async () => {
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={vi.fn()} onError={vi.fn()} />)

    await userEvent.click(screen.getByRole('radio', { name: 'XMind' }))
    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(writeXmindFile).toHaveBeenCalledWith(cards)
    expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([2]), 'chapitre.xmind', [{ name: 'XMind', extensions: ['xmind'] }])
  })

  it('reports a failure through onError instead of throwing', async () => {
    vi.mocked(exportToPdfBytes).mockRejectedValueOnce(new Error('disque plein'))
    const onError = vi.fn()
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={vi.fn()} onError={onError} />)

    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(onError).toHaveBeenCalledWith('Échec de l’export : disque plein')
  })

  it('leaves the dialog open with no error when the save is cancelled', async () => {
    vi.mocked(saveBytesAs).mockResolvedValueOnce(null)
    const onClose = vi.fn()
    const onError = vi.fn()
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={onClose} onError={onError} />)

    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('exports Image, saving one file per page with numbered suffixes', async () => {
    vi.mocked(exportToImageDataUrls).mockResolvedValueOnce([
      'data:image/png;base64,AA==',
      'data:image/png;base64,BB==',
    ])
    const onClose = vi.fn()
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={onClose} onError={vi.fn()} />)

    await userEvent.click(screen.getByRole('radio', { name: 'Image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(exportToImageDataUrls).toHaveBeenCalledWith(cards, {
      showDefinitions: true,
      includeDetached: false,
      mindMapPath: null,
    })
    expect(saveBytesAs).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), 'chapitre (1).png', [
      { name: 'Image PNG', extensions: ['png'] },
    ])
    expect(saveBytesAs).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), 'chapitre (2).png', [
      { name: 'Image PNG', extensions: ['png'] },
    ])
    expect(onClose).toHaveBeenCalled()
  })
})
