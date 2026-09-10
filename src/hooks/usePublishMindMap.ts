import { useCallback } from 'react'
import { stampMindMapSyncMeta } from '../persistence/fileStore'
import { fileNameOf, isInsideFolder, parentDirOf } from '../persistence/paths'
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

  const publish = useCallback(async (path: string): Promise<PublishOutcome> => {
    // Read fresh rather than closed over: a command handler is kept in a ref
    // and may fire long after the render that created it.
    const { currentUser: user, syncFolderPath: folder } = useSyncStore.getState()
    if (user === null || folder === null || !isInsideFolder(path, folder)) return 'not-eligible'

    const { refreshFolder, bumpFileMetaRevision, setWorkspaceError } = useWorkspaceStore.getState()
    const name = fileNameOf(path)
    try {
      const stamped = await stampMindMapSyncMeta(path, user.username, user.role)
      if (!stamped) {
        setWorkspaceError(`« ${name} » est déjà publiée : elle a déjà une identité de synchronisation.`)
        return 'already-published'
      }
      // Both the row's badge and the pending counter read state this file's
      // header just changed.
      bumpFileMetaRevision()
      await refreshFolder(parentDirOf(path))
      return 'published'
    } catch (error) {
      setWorkspaceError(`Impossible de publier « ${name} » : ${describeError(error)}`)
      return 'failed'
    }
  }, [])

  return { canPublish, publish }
}
