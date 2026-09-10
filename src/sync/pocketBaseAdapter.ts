import type PocketBase from 'pocketbase'
import type { AssetsApi, MindMapsApi, RemoteAssetRecord, RemoteMindMapRecord, SyncClient } from './syncService'

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

  return { mindMaps, assets }
}
