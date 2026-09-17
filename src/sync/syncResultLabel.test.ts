import { describe, it, expect } from 'vitest'
import { syncResultDetailLines, syncOutcomeSummary, syncResultLabel } from './syncResultLabel'
import type { SyncResult } from './syncService'

/** A finished run, with only what a test cares about spelled out. */
function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    pushed: 0, pulled: 0, errors: [], cancelled: false, conflicts: [], transferred: [],
    relocated: 0, moved: [], notices: [],
    ...overrides,
  }
}

describe('syncResultLabel', () => {
  it('reads as the two counters of the run', () => {
    expect(syncResultLabel(result({ pushed: 3, pulled: 2 }))).toBe('3 envoyé(s), 2 reçu(s)')
  })

  it('names a run that moved nothing, rather than rendering an empty string', () => {
    expect(syncResultLabel(result())).toBe('0 envoyé(s), 0 reçu(s)')
  })

  it('appends the failure count only when the batch had failures', () => {
    const errors = [{ fileId: 'file-1', message: 'réseau coupé' }]
    expect(syncResultLabel(result({ pushed: 1, pulled: 1, errors }))).toBe('1 envoyé(s), 1 reçu(s), 1 erreur(s)')
  })

  it('says a run was interrupted, since its counters are then partial', () => {
    expect(syncResultLabel(result({ pushed: 2, cancelled: true }))).toBe('2 envoyé(s), 0 reçu(s) (interrompue)')
  })

  it('counts the conflicts, which are reported but never resolved', () => {
    const conflicts = [{ fileId: 'f1', path: 'a.zmap', localModified: 'x', remoteUpdated: 'y' }]
    expect(syncResultLabel(result({ conflicts }))).toBe('0 envoyé(s), 0 reçu(s), 1 conflit(s) résolu(s)')
  })

  it('says how many files followed a path decided elsewhere', () => {
    expect(syncResultLabel(result({ relocated: 2 }))).toBe('0 envoyé(s), 0 reçu(s), 2 déplacé(s)')
  })

  it('counts a both-sides move as a remark, not as a failure', () => {
    const notices = [{ fileId: 'file-1', message: 'déplacé des deux côtés' }]
    expect(syncResultLabel(result({ relocated: 1, notices }))).toBe('0 envoyé(s), 0 reçu(s), 1 déplacé(s), 1 remarque(s)')
  })

  it('mentionne les reclassements', () => {
    expect(
      syncResultLabel({
        pushed: 0,
        pulled: 0,
        errors: [],
        cancelled: false,
        transferred: [],
        conflicts: [],
        reclassified: 2,
      })
    ).toContain('2 reclassé(s)')
  })

  it('mentionne les cartes mises de côté par une fusion', () => {
    const merged = [{ fileId: 'f1', path: 'a.zmap', floatedCount: 2 }]
    expect(syncResultLabel(result({ merged }))).toContain('2 carte(s) mise(s) de côté')
  })
})

describe('syncResultLabel — suppressions', () => {
  it('affiche les suppressions distantes et locales', () => {
    expect(syncResultLabel(result({ remoteDeleted: 2, localDeleted: 1 }))).toBe(
      '0 envoyé(s), 0 reçu(s), 1 supprimé(s) ici, 2 supprimé(s) sur le serveur'
    )
  })

  it('ne dit rien quand rien n’a été supprimé', () => {
    expect(syncResultLabel(result())).toBe('0 envoyé(s), 0 reçu(s)')
  })
})

describe('syncOutcomeSummary', () => {
  it('résume le lot en fichiers synchronisés et non synchronisés', () => {
    const errors = [{ fileId: 'f1', message: 'réseau coupé' }]
    expect(syncOutcomeSummary(result({ pushed: 2, pulled: 1, errors }))).toBe(
      '3 fichiers synchronisés, 1 non synchronisé'
    )
  })

  it('accorde le singulier quand un seul fichier est passé', () => {
    expect(syncOutcomeSummary(result({ pushed: 1 }))).toBe('1 fichier synchronisé, 0 non synchronisé')
  })
})

describe('syncResultDetailLines', () => {
  it('liste les conflits, les erreurs et les remarques, dans cet ordre', () => {
    const errors = [{ fileId: 'f1', message: 'réseau coupé' }]
    const conflicts = [{ fileId: 'f2', path: 'a.zmap', localModified: 'x', remoteUpdated: 'y' }]
    const notices = [{ fileId: 'f3', message: 'déplacé des deux côtés' }]
    expect(syncResultDetailLines(result({ errors, conflicts, notices }))).toEqual([
      'conflit résolu : a.zmap',
      'f1 : réseau coupé',
      'déplacé des deux côtés',
    ])
  })

  it('ne rend aucune ligne pour un lot sans rien à détailler', () => {
    expect(syncResultDetailLines(result({ pushed: 2 }))).toEqual([])
  })
})
