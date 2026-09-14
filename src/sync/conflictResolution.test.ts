import { describe, it, expect } from 'vitest'
import { describePathChange, resolvedStateEntry } from './conflictResolution'
import type { SyncStateEntry } from '../persistence/syncState'

const entry: SyncStateEntry = {
  lastSyncedModified: '2026-01-01T10:00:00.000Z',
  lastSyncedUpdated: '2026-01-01T10:00:00Z',
  lastSyncedPath: 'Maths/Chapitre 1.zmap',
  lastSyncedContentHash: 'vieille-empreinte',
  lastSyncedType: 'default',
}

describe('resolvedStateEntry', () => {
  it('accepting the server disarms the push, leaving the pull to happen', () => {
    const resolved = resolvedStateEntry({
      choice: 'accept-remote',
      entry,
      localModified: '2026-01-02T09:00:00.000Z',
      remoteUpdated: '2026-01-02T08:00:00Z',
      remoteContentHash: 'empreinte-distante',
    })
    expect(resolved.lastSyncedModified).toBe('2026-01-02T09:00:00.000Z')
    // Toujours en retard sur le serveur : c'est ce qui déclenche le tirage.
    expect(resolved.lastSyncedUpdated).toBe(entry.lastSyncedUpdated)
    expect(resolved.lastSyncedContentHash).toBe(entry.lastSyncedContentHash)
  })

  it('a copy resolves like accepting the server: the local work is saved elsewhere', () => {
    const copy = resolvedStateEntry({
      choice: 'copy',
      entry,
      localModified: '2026-01-02T09:00:00.000Z',
      remoteUpdated: '2026-01-02T08:00:00Z',
      remoteContentHash: 'empreinte-distante',
    })
    const accepted = resolvedStateEntry({
      choice: 'accept-remote',
      entry,
      localModified: '2026-01-02T09:00:00.000Z',
      remoteUpdated: '2026-01-02T08:00:00Z',
      remoteContentHash: 'empreinte-distante',
    })
    expect(copy).toEqual(accepted)
  })

  it('keeping the local version marks the server revision as seen, so the push goes through', () => {
    const resolved = resolvedStateEntry({
      choice: 'keep-local',
      entry,
      localModified: '2026-01-02T09:00:00.000Z',
      remoteUpdated: '2026-01-02T08:00:00Z',
      remoteContentHash: 'empreinte-distante',
    })
    expect(resolved.lastSyncedUpdated).toBe('2026-01-02T08:00:00Z')
    expect(resolved.lastSyncedContentHash).toBe('empreinte-distante')
    // Le fichier local reste « modifié depuis le dernier envoi » : sans ça, il
    // n'y aurait plus rien à envoyer et le choix ne ferait rien du tout.
    expect(resolved.lastSyncedModified).toBe(entry.lastSyncedModified)
  })

  it('keeps everything else of the entry untouched', () => {
    const resolved = resolvedStateEntry({
      choice: 'keep-local',
      entry,
      localModified: '2026-01-02T09:00:00.000Z',
      remoteUpdated: '2026-01-02T08:00:00Z',
      remoteContentHash: 'empreinte-distante',
    })
    expect(resolved.lastSyncedPath).toBe('Maths/Chapitre 1.zmap')
    expect(resolved.lastSyncedType).toBe('default')
  })
})

describe('describePathChange', () => {
  it('reports no change when both sides name the same file', () => {
    const change = describePathChange('Maths/Chapitre 1.zmap', 'Maths/Chapitre 1.zmap')
    expect(change.nameChanged).toBe(false)
    expect(change.folderChanged).toBe(false)
  })

  it('reports a rename', () => {
    const change = describePathChange('Maths/Chapitre 1 bis.zmap', 'Maths/Chapitre 1.zmap')
    expect(change.nameChanged).toBe(true)
    expect(change.folderChanged).toBe(false)
    expect(change.localName).toBe('Chapitre 1 bis.zmap')
    expect(change.remoteName).toBe('Chapitre 1.zmap')
  })

  it('reports a move', () => {
    const change = describePathChange('Archives/Chapitre 1.zmap', 'Maths/Chapitre 1.zmap')
    expect(change.nameChanged).toBe(false)
    expect(change.folderChanged).toBe(true)
    expect(change.localFolder).toBe('Archives')
    expect(change.remoteFolder).toBe('Maths')
  })

  it('does not mistake a Windows separator for a move', () => {
    const change = describePathChange('Maths\\Chapitre 1.zmap', 'Maths/Chapitre 1.zmap')
    expect(change.folderChanged).toBe(false)
    expect(change.nameChanged).toBe(false)
  })

  it('names the root folder as an empty string rather than inventing one', () => {
    const change = describePathChange('Chapitre 1.zmap', 'Maths/Chapitre 1.zmap')
    expect(change.localFolder).toBe('')
    expect(change.folderChanged).toBe(true)
  })
})
