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

  const mindMaps: MindMapsApi = {
    getFullList: () => mindMapsCollection.getFullList<RemoteMindMapRecord>(),
    create: data => mindMapsCollection.create<RemoteMindMapRecord>(data),
    update: (id, data) => mindMapsCollection.update<RemoteMindMapRecord>(id, data),
  }

  const assets: AssetsApi = {
    getFullList: () => assetsCollection.getFullList<RemoteAssetRecord>(),
    upload: async (hash, extension, bytes) => {
      const form = new FormData()
      form.append('hash', hash)
      form.append('extension', extension)
      form.append('file', new Blob([bytes as unknown as BlobPart]), `${hash}.${extension}`)
      await assetsCollection.create(form)
    },
    download: async record => {
      const raw = await assetsCollection.getOne<RawAssetRecord>(record.id)
      const url = pb.files.getURL(raw, raw.file)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Téléchargement de l’image échoué (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }

  return { mindMaps, assets }
}
