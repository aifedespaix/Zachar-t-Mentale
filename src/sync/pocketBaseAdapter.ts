import type PocketBase from 'pocketbase'
import type {
  AssetsApi,
  FoldersApi,
  MindMapsApi,
  RemoteAssetRecord,
  RemoteFolderRecord,
  RemoteMindMapRecord,
  SyncClient,
} from './syncService'
import type { OpenConflictRecord, ReportingClient } from './syncReporting'

interface RawAssetRecord {
  id: string
  hash: string
  extension: string
  file: string
}

/** Adapts a real `pocketbase` client to the narrow `SyncClient` interface `syncService.sync()` depends on. */
export function createSyncClient(pb: PocketBase): SyncClient {
  const mindMapsCollection = pb.collection('cartes_mentales')
  const assetsCollection = pb.collection('assets')

  // Every call passes the request options straight through: the sync hands it
  // its AbortSignal, and the SDK forwards it to fetch — which is what makes
  // « Annuler » take effect during a slow request, not only between two files.
  const mindMaps: MindMapsApi = {
    getFullList: options => mindMapsCollection.getFullList<RemoteMindMapRecord>(options),
    create: (data, options) => mindMapsCollection.create<RemoteMindMapRecord>(data, options),
    update: (id, data, options) => mindMapsCollection.update<RemoteMindMapRecord>(id, data, options),
  }

  const assets: AssetsApi = {
    getFullList: options => assetsCollection.getFullList<RemoteAssetRecord>(options),
    upload: async (hash, extension, bytes, options) => {
      const form = new FormData()
      form.append('hash', hash)
      form.append('extension', extension)
      form.append('file', new Blob([bytes as unknown as BlobPart]), `${hash}.${extension}`)
      await assetsCollection.create(form, options)
    },
    download: async (record, options) => {
      const raw = await assetsCollection.getOne<RawAssetRecord>(record.id, options)
      const url = pb.files.getURL(raw, raw.file)
      const response = await fetch(url, options)
      if (!response.ok) throw new Error(`Téléchargement de l’image échoué (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }

  // La collection des dossiers vides. Facultative côté serveur : `sync()`
  // avale un 404 sans broncher, donc on la branche toujours et c'est le serveur
  // qui décide s'il a quelque chose à dire.
  const folders: FoldersApi = {
    getFullList: options => pb.collection('dossiers').getFullList<RemoteFolderRecord>({ ...options, fields: 'id,path' }),
  }

  return { mindMaps, assets, folders }
}

/**
 * Adapte un client `pocketbase` aux collections de l'espace du professeur.
 *
 * Séparé de `createSyncClient` à dessein : ces collections sont FACULTATIVES.
 * Un serveur sur lequel `infra/setup-pocketbase.mjs` n'a pas encore été relancé
 * ne les a pas, répond 404, et la synchronisation doit continuer de marcher
 * exactement comme avant — c'est `reportSyncRun` qui absorbe l'échec.
 */
export function createReportingClient(pb: PocketBase): ReportingClient {
  const events = pb.collection('sync_events')
  const conflicts = pb.collection('sync_conflicts')

  return {
    createEvent: data => events.create(data),
    listOpenConflicts: username =>
      conflicts.getFullList<OpenConflictRecord>({
        // `filter()` échappe les valeurs : un pseudo ne peut pas s'évader dans
        // l'expression, si permissive que soit la validation côté serveur.
        filter: pb.filter('status = "open" && username = {:username}', { username }),
        fields: 'id,file_id',
      }),
    createConflict: data => conflicts.create(data),
    updateConflict: (id, data) => conflicts.update(id, data),
    closeConflict: (id, resolution, by) =>
      conflicts.update(id, { status: 'resolved', resolution, resolved_by: by, resolved_at: new Date().toISOString() }),
  }
}
