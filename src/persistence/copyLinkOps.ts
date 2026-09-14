import { exists, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { MindMapMeta, UserRole } from '../types/card'
import {
  copyLink as makeCopyLink,
  copySuffixFor,
  groupBaseNameAfterRename,
  linkedBaseNameOf,
  nextCopyIndex,
  renamedLink,
  sourceLink,
  type CopyLink,
} from '../sync/copyLink'
import { serializeMindMap, deserializeMindMap } from './serialization'
import { loadMindMapMeta, setMindMapCopyLink } from './fileStore'
import { copyAssetSidecar, movePath, renamePath } from './fileOps'
import {
  MIND_MAP_EXTENSION,
  fileNameOf,
  isMindMapPath,
  mindMapBaseName,
  mindMapExtensionSuffix,
  parentDirOf,
  separatorOf,
} from './paths'

/**
 * Le disque, pour le LIEN DE COPIE (voir `sync/copyLink.ts`) : créer la copie,
 * retrouver les membres d'un groupe, et faire tenir la règle « même dossier,
 * même nom » quand l'utilisateur renomme, déplace ou supprime l'un d'eux.
 *
 * Tout est LOCAL. Le lien ne part jamais au serveur et n'en revient jamais
 * (`syncService` le retire de ce qu'il envoie et le préserve sur ce qu'il
 * reçoit) : il décrit un arrangement de fichiers sur CETTE machine, et une
 * autre machine, où la copie n'existe pas, n'aurait qu'un badge qui ment.
 */

/** Un membre d'un groupe de copies : son chemin, et le lien qu'il porte. */
export interface LinkedMember {
  path: string
  meta: MindMapMeta
  link: CopyLink
}

/** Le déplacement d'un fichier entraîné par celui d'un membre du groupe. */
export interface LinkedMove {
  from: string
  to: string
}

function joinPath(folderPath: string, name: string): string {
  return folderPath === '' ? name : `${folderPath}${separatorOf(folderPath)}${name}`
}

/**
 * Les cartes d'un dossier qui portent le lien `groupId`, `excludePath` exclu.
 *
 * Un dossier illisible, ou un fichier dont l'en-tête ne se lit pas, ne fait
 * rien échouer : il ressort simplement du groupe. Une règle de nommage n'est
 * pas une raison de faire capoter le renommage que l'utilisateur a demandé.
 */
export async function linkedMembersIn(
  folderPath: string,
  groupId: string,
  excludePath?: string
): Promise<LinkedMember[]> {
  let entries: { name: string; isDirectory: boolean }[]
  try {
    entries = await readDir(folderPath)
  } catch {
    return []
  }
  const members: LinkedMember[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !isMindMapPath(entry.name)) continue
    const path = joinPath(folderPath, entry.name)
    if (excludePath !== undefined && path === excludePath) continue
    const meta = await loadMindMapMeta(path).catch(() => null)
    if (meta?.copyLink === undefined || meta.copyLink.groupId !== groupId) continue
    members.push({ path, meta, link: meta.copyLink })
  }
  return members
}

/**
 * Tout le groupe dont `path` fait partie, `path` compris et en tête — ou une
 * liste VIDE si ce fichier ne porte aucun lien.
 */
export async function linkedGroupOf(path: string): Promise<LinkedMember[]> {
  const meta = await loadMindMapMeta(path).catch(() => null)
  if (meta?.copyLink === undefined) return []
  const self: LinkedMember = { path, meta, link: meta.copyLink }
  return [self, ...(await linkedMembersIn(parentDirOf(path), meta.copyLink.groupId, path))]
}

/**
 * Écrit la copie liée de `sourcePath` et pose le lien des DEUX côtés.
 *
 * C'est le bouton orange de la résolution de conflits : « gardez les deux ».
 * La copie reçoit une identité de synchronisation NEUVE — un `file_id` frais et
 * l'utilisateur courant pour auteur — parce qu'elle est un fichier à part
 * entière : réutiliser celle de l'original ferait publier deux fichiers locaux
 * sur un même enregistrement, précisément la corruption que le modèle en fourche
 * interdit.
 *
 * Le nom est imposé, pas proposé : « <original> (copie) », dans le dossier de
 * l'original. C'est ce qui fait qu'on retrouve le couple trois semaines plus
 * tard sans avoir rien à se rappeler.
 */
export async function createLinkedCopy(params: {
  sourcePath: string
  author: string
  role: UserRole
}): Promise<{ path: string; link: CopyLink }> {
  const { sourcePath, author, role } = params
  const { meta, cards } = deserializeMindMap(await readTextFile(sourcePath))
  if (meta === null) {
    throw new Error(`« ${fileNameOf(sourcePath)} » n’a pas d’identité de synchronisation : il n’y a rien à lier.`)
  }

  const folder = parentDirOf(sourcePath)
  // Copier une copie rejoint le groupe existant plutôt que d'en ouvrir un
  // deuxième : sinon « Chapitre 1 (copie) (copie) » deviendrait la racine d'un
  // groupe à elle seule, et le couple d'origine perdrait un membre.
  const groupId = meta.copyLink?.groupId ?? meta.id
  const baseName = meta.copyLink?.baseName ?? mindMapBaseName(sourcePath)

  const siblings = await linkedMembersIn(folder, groupId, sourcePath)
  // Le rang du fichier COPIÉ compte parmi les rangs pris : il est exclu du
  // recensement des voisins (c'est lui qui demande), et l'oublier ferait
  // proposer son propre nom à la copie qu'on est en train de faire de lui.
  const used = [...siblings, { link: meta.copyLink }].flatMap(member =>
    member.link?.index === undefined ? [] : [member.link.index]
  )
  let index = nextCopyIndex(used)
  let destPath = joinPath(folder, `${baseName}${copySuffixFor(index)}${MIND_MAP_EXTENSION}`)
  // Un fichier sans lien peut déjà occuper ce nom (une copie manuelle, un
  // reliquat) : on prend le rang suivant plutôt que d'écraser quoi que ce soit.
  while (await exists(destPath)) {
    index = nextCopyIndex([...used, index])
    destPath = joinPath(folder, `${baseName}${copySuffixFor(index)}${MIND_MAP_EXTENSION}`)
  }

  const link = makeCopyLink(groupId, baseName, index)
  const copyMeta: MindMapMeta = {
    id: crypto.randomUUID(),
    author,
    role,
    lastModified: new Date().toISOString(),
    copyLink: link,
  }
  if (meta.type !== undefined) copyMeta.type = meta.type
  await writeTextFile(destPath, serializeMindMap(copyMeta, cards))
  await copyAssetSidecar(sourcePath, destPath)

  // L'original n'apprend le lien qu'une fois la copie ÉCRITE : marquer d'abord
  // laisserait, si l'écriture échoue, un fichier qui se dit lié à une copie
  // qui n'existe pas.
  if (meta.copyLink === undefined) await setMindMapCopyLink(sourcePath, sourceLink(groupId, baseName))

  return { path: destPath, link }
}

/**
 * Renomme tout un groupe à partir du nom tapé sur l'un de ses membres.
 *
 * La règle « même nom » ne peut pas être un interdit — refuser le renommage
 * d'une copie serait punir l'utilisateur d'avoir choisi de garder les deux
 * versions. Elle est donc une PROPAGATION : ce qui est tapé donne la racine du
 * groupe (suffixe retiré s'il est là), et chaque membre reprend le nom que son
 * propre lien impose. Renommer « Chapitre 1 (copie) » en « Chapitre 2 » renomme
 * donc aussi l'original en « Chapitre 2 », et la copie en « Chapitre 2 (copie) ».
 *
 * Chaque fichier garde SON extension : un `.json` de la première version de
 * l'app reste un `.json`, comme partout ailleurs dans le renommage.
 *
 * @returns les déplacements réellement effectués, pour que l'appelant puisse
 * suivre le fichier ouvert et rafraîchir le dossier.
 */
export async function renameLinkedGroup(params: {
  /** Le membre que l'utilisateur a renommé — son chemin AVANT renommage. */
  memberPath: string
  /** Le nom de base tapé, sans extension. */
  typedBaseName: string
}): Promise<LinkedMove[]> {
  const { memberPath, typedBaseName } = params
  const group = await linkedGroupOf(memberPath)
  if (group.length === 0) return []

  const baseName = groupBaseNameAfterRename(typedBaseName)
  const moves: LinkedMove[] = []
  for (const member of group) {
    const link = renamedLink(member.link, baseName)
    const folder = parentDirOf(member.path)
    const target = joinPath(folder, `${linkedBaseNameOf(link)}${mindMapExtensionSuffix(member.path)}`)
    if (target !== member.path) {
      // Un nom déjà pris n'est pas écrasé : le membre garde le sien, et le
      // groupe est simplement dépareillé jusqu'au prochain renommage — très
      // au-dessus de la perte d'un fichier homonyme.
      if (await exists(target)) continue
      await renamePath(member.path, target)
      moves.push({ from: member.path, to: target })
    }
    await setMindMapCopyLink(target, link).catch(() => {})
  }
  return moves
}

/**
 * Emmène le reste du groupe dans le dossier où un de ses membres vient d'aller.
 *
 * « Même dossier » est la moitié de la règle, et c'est celle qui compte le jour
 * où l'original part dans « Archives » : sans elle, la copie reste seule dans
 * l'ancien dossier, avec un badge qui promet un voisin qui n'est plus là.
 *
 * Un membre qui ne peut pas suivre (nom déjà pris là-bas, dossier en lecture
 * seule) est laissé où il est plutôt que de faire échouer le déplacement déjà
 * accompli : `movePath` refuse avant d'écrire quoi que ce soit.
 */
export async function moveLinkedGroup(params: {
  /** Le membre déjà déplacé, à son NOUVEAU chemin. */
  memberPath: string
  /** Le dossier d'où il vient — c'est là que les autres membres sont encore. */
  previousFolderPath: string
  destFolderPath: string
}): Promise<LinkedMove[]> {
  const { memberPath, previousFolderPath, destFolderPath } = params
  const meta = await loadMindMapMeta(memberPath).catch(() => null)
  if (meta?.copyLink === undefined) return []

  const moves: LinkedMove[] = []
  // Les autres membres sont cherchés dans leur ANCIEN dossier : celui d'où le
  // membre déclencheur vient de partir.
  const members = await linkedMembersIn(previousFolderPath, meta.copyLink.groupId, memberPath)
  for (const member of members) {
    try {
      await movePath(member.path, destFolderPath, false)
      moves.push({ from: member.path, to: joinPath(destFolderPath, fileNameOf(member.path)) })
    } catch {
      // Laissé sur place, volontairement : voir le commentaire ci-dessus.
    }
  }
  return moves
}

/**
 * Retire le lien du dernier membre encore debout.
 *
 * Appelé après une suppression : un lien qui ne désigne plus personne est pire
 * que pas de lien du tout — le badge promet un voisin, et l'utilisateur le
 * cherche. Un groupe qui a encore deux membres est laissé tel quel.
 */
export async function unlinkIfAlone(folderPath: string, groupId: string): Promise<void> {
  const members = await linkedMembersIn(folderPath, groupId)
  if (members.length !== 1) return
  const alone = members[0]
  if (alone === undefined) return
  await setMindMapCopyLink(alone.path, undefined).catch(() => {})
}

/**
 * Le dossier et le groupe d'un fichier sur le point d'être supprimé, quand il
 * en a un — ce qu'il faut avoir lu AVANT la suppression pour pouvoir appeler
 * `unlinkIfAlone` après.
 */
export async function copyLinkOf(path: string): Promise<CopyLink | undefined> {
  const meta = await loadMindMapMeta(path).catch(() => null)
  return meta?.copyLink
}
