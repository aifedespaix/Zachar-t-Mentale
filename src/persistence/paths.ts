/**
 * Pure path helpers. The app deals in whole path strings handed to it by Tauri
 * (`join`, the folder picker, the file tree), never in path *components*, so
 * everything here works on strings and supports both separators — a Windows
 * path keeps its backslashes, a POSIX one its slashes.
 */

const MIND_MAP_EXTENSION = '.json'

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

/** The file name without its `.json` extension — what the user actually named the map. */
export function mindMapBaseName(path: string): string {
  const name = fileNameOf(path)
  return name.toLowerCase().endsWith(MIND_MAP_EXTENSION) ? name.slice(0, -MIND_MAP_EXTENSION.length) : name
}

/**
 * Where a repaired copy of `path` goes: « [Nom original] (Réparée).json », next
 * to the original.
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
