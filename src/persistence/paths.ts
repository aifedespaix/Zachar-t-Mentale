/**
 * Pure path helpers. The app deals in whole path strings handed to it by Tauri
 * (`join`, the folder picker, the file tree), never in path *components*, so
 * everything here works on strings and supports both separators — a Windows
 * path keeps its backslashes, a POSIX one its slashes.
 */

/**
 * The extension the app WRITES. `.zmap` is registered with Windows by the
 * installer, so a mind map opens on a double-click; `.json` could not be,
 * without making this app the default editor for every JSON file on the
 * machine.
 */
export const MIND_MAP_EXTENSION = '.zmap'

/**
 * The extensions the app READS, most specific first. `.json` stays in the list
 * because every map written before `.zmap` existed is one, and those files are
 * the user's own course material — they keep opening, from the tree, from a
 * drop, and from the « Ouvrir avec » menu.
 */
const MIND_MAP_EXTENSIONS = [MIND_MAP_EXTENSION, '.json']

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g

/** The known mind-map extension `path` ends with, or `null` for anything else. */
function mindMapExtensionOf(path: string): string | null {
  const lower = path.toLowerCase()
  return MIND_MAP_EXTENSIONS.find(extension => lower.endsWith(extension)) ?? null
}

/** Whether `path` names a mind map the app can open — `.zmap` or a legacy `.json`. */
export function isMindMapPath(path: string): boolean {
  return mindMapExtensionOf(path) !== null
}

/**
 * `name` with a mind-map extension. A name that already carries one is left
 * alone, so re-saving a legacy `chapitre.json` does not turn it into
 * `chapitre.json.zmap`; anything else gets `.zmap`, because new files are
 * written in the format the installer associates with the app.
 */
export function withMindMapExtension(name: string): string {
  return isMindMapPath(name) ? name : `${name}${MIND_MAP_EXTENSION}`
}

/** The separator a path already uses, so a derived path stays consistent with it. */
export function separatorOf(path: string): '\\' | '/' {
  return path.includes('\\') ? '\\' : '/'
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** The folder containing `path`, without its trailing separator ('' for a bare name). */
export function parentDirOf(path: string): string {
  const name = fileNameOf(path)
  return path.slice(0, path.length - name.length).replace(/[\\/]+$/, '')
}

/** The file name without its mind-map extension — what the user actually named the map. */
export function mindMapBaseName(path: string): string {
  const name = fileNameOf(path)
  const extension = mindMapExtensionOf(name)
  return extension === null ? name : name.slice(0, -extension.length)
}

/**
 * Where a repaired copy of `path` goes: « [Nom original] (Réparée).zmap », next
 * to the original. The copy is a file the app writes from scratch, so it gets
 * the current extension even when the broken original was a legacy `.json`.
 *
 * `attempt` disambiguates when that name is already taken — the whole point of
 * the repair flow is that nothing existing gets overwritten, and a second
 * repair of the same file must not silently replace the first one.
 */
export function repairedCopyPath(path: string, attempt = 1): string {
  const suffix = attempt <= 1 ? '(Réparée)' : `(Réparée ${attempt})`
  const dir = parentDirOf(path)
  const name = `${mindMapBaseName(path)} ${suffix}${MIND_MAP_EXTENSION}`
  return dir === '' ? name : `${dir}${separatorOf(path)}${name}`
}

/**
 * Whether `path` sits in `folderPath` (or IS it) — the check every sync
 * action needs before it can promise anything.
 *
 * Separators are normalised (a sync folder picked on Windows may reach the
 * store with either one) and a WINDOWS drive path is compared
 * case-insensitively, because the filesystem is. A POSIX path is compared
 * exactly: `/home/Eleve` and `/home/eleve` are two different folders there.
 *
 * The trailing-separator test is what keeps `C:\\Cours2` from passing for
 * `C:\\Cours` — a prefix comparison alone says yes to exactly that.
 */
export function isInsideFolder(path: string, folderPath: string): boolean {
  if (path === '' || folderPath === '') return false
  const normalize = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const windows = (value: string) => /^[a-zA-Z]:/.test(value)
  const target = normalize(path)
  const root = normalize(folderPath)
  const comparable = (value: string) => (windows(value) ? value.toLowerCase() : value)
  const left = comparable(target)
  const right = comparable(root)
  return left === right || left.startsWith(`${right}/`)
}

/** A sheet/topic title turned into a safe file name component: illegal characters stripped, never empty. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? 'Sans titre' : cleaned
}
