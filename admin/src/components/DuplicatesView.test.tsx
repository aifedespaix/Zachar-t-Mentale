import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Card } from '@app/types/card'
import { fullDate } from '@/lib/format'
import type { DuplicateFile } from '@/lib/duplicates'

const { fetchMapContents, removeMaps } = vi.hoisted(() => ({
  fetchMapContents: vi.fn(),
  removeMaps: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ fetchMapContents }))
vi.mock('@/lib/pb', () => ({ describeApiError: (_error: unknown, what: string) => `${what} a échoué.` }))
vi.mock('@/state/useLibrary', () => ({
  useLibrary: (selector: (state: { removeMaps: typeof removeMaps }) => unknown) => selector({ removeMaps }),
}))

import { DuplicatesView } from './DuplicatesView'

function card(id: string, title: string, parentId: string | null): Card {
  return { id, level: parentId === null ? 1 : 2, title, parentId, order: 0 }
}

function fileOf(id: string, path: string, overrides: Partial<DuplicateFile> = {}): DuplicateFile {
  return {
    id,
    file_id: `file-${id}`,
    author: 'eleve1',
    path,
    type: 'cours',
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-02 00:00:00.000Z',
    content: JSON.stringify({ meta: { id: `file-${id}` }, cards: [card('root', 'Chapitre 1', null), card('n1', 'Notion', 'root')] }),
    ...overrides,
  }
}

const ANCIEN = fileOf('rec-old', 'Maths/Chapitre 1.zmap', {
  author: 'eleve1',
  type: 'cours',
  created: '2026-01-01 00:00:00.000Z',
  updated: '2026-01-02 00:00:00.000Z',
})
const RECENT = fileOf('rec-new', 'Sauvegardes/Chapitre 1 (copie).zmap', {
  author: 'prof',
  type: 'corrections',
  created: '2026-03-01 00:00:00.000Z',
  updated: '2026-03-02 00:00:00.000Z',
})

beforeEach(() => {
  fetchMapContents.mockReset()
  removeMaps.mockReset()
  removeMaps.mockResolvedValue(undefined)
})

/** Lance l'analyse et rend la main ; chaque test attend ensuite ce qu'il guette. */
async function analyser() {
  render(<DuplicatesView />)
  await userEvent.click(screen.getByRole('button', { name: /Lancer l/ }))
}

async function ouvrirArbitrage() {
  await userEvent.click(screen.getByRole('button', { name: /Garder celui-ci/ }))
  await screen.findByText('Arbitrer ce doublon')
}

describe('DuplicatesView', () => {
  it('ne lit pas toute la bibliothèque au montage : l’analyse reste à la demande', () => {
    render(<DuplicatesView />)

    expect(screen.getByText('Chercher les doublons')).toBeInTheDocument()
    expect(fetchMapContents).not.toHaveBeenCalled()
  })

  it('affiche chemin, auteur, type et dates de création et de modification de chaque copie', async () => {
    fetchMapContents.mockResolvedValue([RECENT, ANCIEN])
    await analyser()
    await screen.findByText('Chapitre 1.zmap')

    expect(screen.getByText('Chapitre 1.zmap')).toBeInTheDocument()
    expect(screen.getByText('Chapitre 1 (copie).zmap')).toBeInTheDocument()
    expect(screen.getByText('Dans « Maths »')).toBeInTheDocument()
    expect(screen.getByText('eleve1')).toBeInTheDocument()
    expect(screen.getByText('prof')).toBeInTheDocument()
    expect(screen.getByText('Cours')).toBeInTheDocument()
    expect(screen.getByText('Corrections')).toBeInTheDocument()
    expect(screen.getByText(fullDate(ANCIEN.created))).toBeInTheDocument()
    expect(screen.getByText(fullDate(RECENT.updated))).toBeInTheDocument()
  })

  it('garde par défaut la copie la plus récemment modifiée et ne supprime que les autres', async () => {
    fetchMapContents.mockResolvedValue([RECENT, ANCIEN])
    await analyser()
    await screen.findByText(/identiques/)
    await ouvrirArbitrage()

    await userEvent.click(screen.getByRole('button', { name: /Supprimer 1/ }))

    await waitFor(() => expect(removeMaps).toHaveBeenCalledWith(['rec-old']))
  })

  it('supprime bien celles qui ne sont pas choisies quand l’utilisateur change son choix', async () => {
    fetchMapContents.mockResolvedValue([RECENT, ANCIEN])
    await analyser()
    await screen.findByText(/identiques/)

    // Les radios suivent l'ordre du groupe : la plus récente d'abord.
    const radios = screen.getAllByRole('radio')
    await userEvent.click(radios[1])
    await ouvrirArbitrage()
    await userEvent.click(screen.getByRole('button', { name: /Supprimer 1/ }))

    await waitFor(() => expect(removeMaps).toHaveBeenCalledWith(['rec-new']))
  })

  it('nomme les fichiers condamnés avant de les supprimer', async () => {
    fetchMapContents.mockResolvedValue([RECENT, ANCIEN])
    await analyser()
    await ouvrirArbitrage()

    expect(screen.getByText('Maths/Chapitre 1.zmap')).toBeInTheDocument()
  })

  it('annonce l’absence de doublons plutôt qu’une liste vide', async () => {
    fetchMapContents.mockResolvedValue([
      RECENT,
      fileOf('rec-autre', 'Autre.zmap', { content: JSON.stringify({ cards: [card('r', 'Autre', null)] }) }),
    ])
    await analyser()

    expect(await screen.findByText('Aucun doublon')).toBeInTheDocument()
  })

  it('montre l’erreur et permet de relancer quand la lecture échoue', async () => {
    fetchMapContents.mockRejectedValueOnce(new Error('réseau'))
    render(<DuplicatesView />)
    await userEvent.click(screen.getByRole('button', { name: /Lancer l/ }))

    expect(await screen.findByText('Analyse des doublons a échoué.')).toBeInTheDocument()
  })
})
