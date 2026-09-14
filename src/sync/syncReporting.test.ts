import { describe, expect, it, vi } from 'vitest'
import {
  MAX_DETAIL_ENTRIES,
  buildConflictPayload,
  buildDetail,
  buildSyncEvent,
  levelOf,
  reportSyncRun,
  type ReportContext,
  type ReportingClient,
} from './syncReporting'
import type { SyncConflict, SyncResult } from './syncService'

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    transferred: [],
    conflicts: [],
    ...overrides,
  }
}

function conflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    fileId: 'file-1',
    path: 'Maths/Chapitre 1.zmap',
    localModified: '2026-09-10T10:00:00.000Z',
    remoteUpdated: '2026-09-10T11:00:00.000Z',
    localContent: '{"meta":{},"cards":[]}',
    ...overrides,
  }
}

const context: ReportContext = {
  username: 'eleve1',
  role: 'eleve',
  trigger: 'manual',
  summary: '2 envoyées, 1 reçue',
  device: 'Windows',
}

function fakeClient(overrides: Partial<ReportingClient> = {}): ReportingClient {
  return {
    createEvent: vi.fn(async () => ({})),
    listOpenConflicts: vi.fn(async () => []),
    createConflict: vi.fn(async () => ({})),
    updateConflict: vi.fn(async () => ({})),
    ...overrides,
  }
}

describe('levelOf', () => {
  it('answers info for a run where nothing went wrong', () => {
    expect(levelOf(result({ pushed: 3, pulled: 2 }))).toBe('info')
  })

  it('answers error only for a real per-file failure', () => {
    expect(levelOf(result({ errors: [{ fileId: 'a', message: 'boum' }] }))).toBe('error')
  })

  it('keeps a conflict out of the red: a pending decision is not a breakdown', () => {
    expect(levelOf(result({ conflicts: [conflict()] }))).toBe('warning')
  })

  it('flags a cancelled run, which finished nothing it promised', () => {
    expect(levelOf(result({ cancelled: true }))).toBe('warning')
  })

  it('reports the failure when a run both failed and conflicted', () => {
    expect(levelOf(result({ errors: [{ fileId: 'a', message: 'boum' }], conflicts: [conflict()] }))).toBe('error')
  })
})

describe('buildDetail', () => {
  it('carries the optional counters through as zero rather than undefined', () => {
    const detail = buildDetail(result())
    expect(detail.relocated).toBe(0)
    expect(detail.reclassified).toBe(0)
    expect(detail.truncated).toBeUndefined()
  })

  it('caps a long list and says how much it dropped, instead of losing the whole line', () => {
    const transferred = Array.from({ length: MAX_DETAIL_ENTRIES + 7 }, (_, index) => ({
      fileId: `file-${index}`,
      path: `p-${index}.zmap`,
      direction: 'push' as const,
    }))
    const detail = buildDetail(result({ transferred }))
    expect(detail.transferred).toHaveLength(MAX_DETAIL_ENTRIES)
    expect(detail.truncated).toBe(7)
  })

  it('adds up what every capped list dropped', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ fileId: `f${index}`, message: 'x' }))
    const detail = buildDetail(
      result({
        errors: many(MAX_DETAIL_ENTRIES + 2),
        notices: many(MAX_DETAIL_ENTRIES + 3),
      })
    )
    expect(detail.truncated).toBe(5)
  })
})

describe('buildSyncEvent', () => {
  it('reuses the sentence the user already saw rather than inventing a second one', () => {
    const event = buildSyncEvent(result({ pushed: 2, pulled: 1 }), context)
    expect(event.summary).toBe('2 envoyées, 1 reçue')
    expect(event).toMatchObject({
      username: 'eleve1',
      role: 'eleve',
      trigger: 'manual',
      pushed: 2,
      pulled: 1,
      conflicts: 0,
      failures: 0,
      cancelled: false,
      device: 'Windows',
    })
  })

  it('counts conflicts and failures separately — they are not the same news', () => {
    const event = buildSyncEvent(
      result({ conflicts: [conflict(), conflict({ fileId: 'file-2' })], errors: [{ fileId: 'x', message: 'boum' }] }),
      context
    )
    expect(event.conflicts).toBe(2)
    expect(event.failures).toBe(1)
  })
})

describe('buildConflictPayload', () => {
  it('attaches the local version, which exists nowhere else', () => {
    expect(buildConflictPayload(conflict(), 'eleve1')).toEqual({
      file_id: 'file-1',
      path: 'Maths/Chapitre 1.zmap',
      username: 'eleve1',
      local_modified: '2026-09-10T10:00:00.000Z',
      remote_updated: '2026-09-10T11:00:00.000Z',
      local_content: '{"meta":{},"cards":[]}',
      status: 'open',
    })
  })

  it('still reports a conflict whose local file could not be read', () => {
    const payload = buildConflictPayload(conflict({ localContent: undefined }), 'eleve1')
    expect(payload.local_content).toBe('')
    expect(payload.status).toBe('open')
  })
})

describe('reportSyncRun', () => {
  it('writes one event and opens each conflict', async () => {
    const client = fakeClient()
    const outcome = await reportSyncRun(
      client,
      result({ conflicts: [conflict(), conflict({ fileId: 'file-2' })] }),
      context
    )

    expect(client.createEvent).toHaveBeenCalledTimes(1)
    expect(client.createConflict).toHaveBeenCalledTimes(2)
    expect(outcome).toMatchObject({ event: true, opened: 2, refreshed: 0, failures: [] })
  })

  it('refreshes a conflict already open instead of stacking a row per run', async () => {
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => [{ id: 'rec-1', file_id: 'file-1' }]),
    })
    const outcome = await reportSyncRun(client, result({ conflicts: [conflict()] }), context)

    expect(client.createConflict).not.toHaveBeenCalled()
    expect(client.updateConflict).toHaveBeenCalledWith('rec-1', expect.objectContaining({ file_id: 'file-1' }))
    expect(outcome).toMatchObject({ opened: 0, refreshed: 1 })
  })

  it('never throws when the server has no such collection: the sync still succeeded', async () => {
    const client = fakeClient({
      createEvent: vi.fn(async () => {
        throw new Error('404 Not Found')
      }),
    })
    const outcome = await reportSyncRun(client, result({ pushed: 1 }), context)

    expect(outcome.event).toBe(false)
    expect(outcome.failures).toEqual(['journal : 404 Not Found'])
  })

  it('still signals a conflict when it could not read the ones already open', async () => {
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => {
        throw new Error('injoignable')
      }),
    })
    const outcome = await reportSyncRun(client, result({ conflicts: [conflict()] }), context)

    // Un doublon possible vaut mieux qu'un conflit passé sous silence.
    expect(client.createConflict).toHaveBeenCalledTimes(1)
    expect(outcome.opened).toBe(1)
    expect(outcome.failures).toEqual(['conflits déjà ouverts : injoignable'])
  })

  it('keeps reporting the other conflicts when one of them fails', async () => {
    const createConflict = vi
      .fn()
      .mockRejectedValueOnce(new Error('refusé'))
      .mockResolvedValueOnce({})
    const client = fakeClient({ createConflict })
    const outcome = await reportSyncRun(
      client,
      result({ conflicts: [conflict(), conflict({ fileId: 'file-2', path: 'b.zmap' })] }),
      context
    )

    expect(createConflict).toHaveBeenCalledTimes(2)
    expect(outcome.opened).toBe(1)
    expect(outcome.failures).toEqual(['conflit « Maths/Chapitre 1.zmap » : refusé'])
  })

  it('does not go looking for open conflicts when there are none to report', async () => {
    const client = fakeClient()
    await reportSyncRun(client, result({ pushed: 4 }), context)
    expect(client.listOpenConflicts).not.toHaveBeenCalled()
  })
})
