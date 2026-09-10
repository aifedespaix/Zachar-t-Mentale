import { useCallback } from 'react'
import { stampMindMapSyncMeta } from '../persistence/fileStore'
import { fileNameOf, isInsideFolder } from '../persistence/paths'
import { useSyncStore } from '../state/useSyncStore'
import { useWorkspaceStore, describeError } from '../state/useWorkspaceStore'
import type { MindMapMeta } from '../types/card'

export type PublishOutcome = 'published' | 'already-published' | 'not-eligible' | 'failed'

/**
 * « Publier » — gives a purely local map the sync identity the push loop
 * requires, so a chapter written in the app can finally reach the server.
 *
 * Shared by the two surfaces that offer it (the open file's « Fichier » menu
 * and a tree row's context menu) so the eligibility rules cannot drift: they
 * are the four conditions under which the action MEANS something —
 *
 * - a signed-in account (the `author` to stamp, synced later under its name),
 * - a configured sync folder, and the file INSIDE it (the push loop only walks
 *   that folder: stamping a file elsewhere would produce a file that claims to
 *   be syncable and never is),
 * - no existing `meta` — an already-synced file needs nothing, and someone
 *   else's file is entered through « Personnaliser », never by stamping over
 *   the id that points at their remote record.
 *
 * Success is deliberately quiet: the row's lock badge disappears and the
 * footer's « à envoyer » counter goes up, which is the feedback that matters.
 * A refusal or a failure is REPORTED — the user asked for it by clicking.
 */
export function usePublishMindMap() {
  const syncFolderPath = useSyncStore(state => state.syncFolderPath)
  const currentUser = useSyncStore(state => state.currentUser)

  const canPublish = useCallback(
    (path: string | null, meta: MindMapMeta | null): boolean =>
      path !== null &&
      meta === null &&
      currentUser !== null &&
      syncFolderPath !== null &&
      isInsideFolder(path, syncFolderPath),
    [currentUser, syncFolderPath]
  )

  /** The stamping itself, with no interface work: what a single publish and a bulk one both need. */
  const stampOne = useCallback(
    async (path: string): Promise<{ outcome: PublishOutcome; error: unknown }> => {
      // Read fresh rather than closed over: a command handler is kept in a ref
      // and may fire long after the render that created it.
      const { currentUser: user, syncFolderPath: folder } = useSyncStore.getState()
      if (user === null || folder === null || !isInsideFolder(path, folder)) {
        return { outcome: 'not-eligible', error: null }
      }

      try {
        const stamped = await stampMindMapSyncMeta(path, user.username, user.role)
        return { outcome: stamped ? 'published' : 'already-published', error: null }
      } catch (error) {
        // Carried out rather than swallowed: the caller is the one that can tell
        // the user WHY the write failed.
        return { outcome: 'failed', error }
      }
    },
    []
  )

  /** Everything that reads a changed header: the rows' badges, the tree, the counter. */
  const refreshAfterPublishing = useCallback(async (folder: string) => {
    const { refreshFolder, bumpFileMetaRevision } = useWorkspaceStore.getState()
    bumpFileMetaRevision()
    await refreshFolder(folder)
    await useSyncStore.getState().refreshPendingCount()
  }, [])

  const publish = useCallback(
    async (path: string): Promise<PublishOutcome> => {
      const folder = useSyncStore.getState().syncFolderPath
      const name = fileNameOf(path)
      const { outcome, error } = await stampOne(path)

      if (outcome === 'already-published') {
        useWorkspaceStore
          .getState()
          .setWorkspaceError(`« ${name} » est déjà publiée : elle a déjà une identité de synchronisation.`)
        return outcome
      }
      if (outcome === 'failed') {
        useWorkspaceStore
          .getState()
          .setWorkspaceError(`Impossible de publier « ${name} » : ${describeError(error)}`)
        return outcome
      }
      if (outcome === 'published' && folder !== null) await refreshAfterPublishing(folder)
      return outcome
    },
    [refreshAfterPublishing, stampOne]
  )

  /**
   * Publishes a whole list — what the settings screen offers when the survey
   * finds maps that no amount of syncing will ever move.
   *
   * The refresh happens ONCE at the end: doing it per file would re-scan the
   * folder thirty times for a thirty-file folder.
   */
  const publishAll = useCallback(
    async (paths: string[]): Promise<{ published: number; failed: number }> => {
      let published = 0
      let failed = 0
      for (const path of paths) {
        const { outcome } = await stampOne(path)
        if (outcome === 'published') published += 1
        else if (outcome === 'failed') failed += 1
      }
      const folder = useSyncStore.getState().syncFolderPath
      if (published > 0 && folder !== null) await refreshAfterPublishing(folder)
      return { published, failed }
    },
    [refreshAfterPublishing, stampOne]
  )

  return { canPublish, publish, publishAll }
}
