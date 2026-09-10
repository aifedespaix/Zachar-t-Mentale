import { appConfigDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'

const LOG_FILE_NAME = 'sync-debug.log'

/**
 * The log is a debugging aid, not a record, so it is trimmed once it grows past
 * this — keeping the RECENT part, because a sync problem is always investigated
 * from the latest run backwards.
 *
 * Counted in characters rather than bytes on purpose: an exact size would cost
 * one more filesystem round-trip per line, and a French log's characters are
 * within a factor of two of its bytes.
 */
const MAX_LOG_CHARS = 512 * 1024
const KEEP_AFTER_TRIM_CHARS = 256 * 1024

const TRIM_MARKER = '--- journal tronqué : seules les dernières lignes sont conservées ---\n'

export type SyncLogLevel = 'debug' | 'info' | 'error'

/** `appConfigDir()/sync-debug.log` — the file the settings screen shows and opens. */
export async function syncLogPath(): Promise<string> {
  return join(await appConfigDir(), LOG_FILE_NAME)
}

function describeDetail(detail: unknown): string {
  if (detail instanceof Error) {
    // The SDK's own error text is English and never shown to the user, but it is
    // exactly what a bug report needs — status included, since 0 means "the
    // request never reached the server".
    const status = (detail as { status?: unknown }).status
    return `${detail.name}: ${detail.message}${status === undefined ? '' : ` (status ${String(status)})`}`
  }
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail) ?? String(detail)
  } catch {
    return String(detail)
  }
}

/**
 * One line, in the order a human reads it: when, how bad, what happened, and the
 * raw detail that only matters when it did not work.
 */
export function formatSyncLogLine(level: SyncLogLevel, message: string, detail: unknown, at: Date): string {
  const labels: Record<SyncLogLevel, string> = { debug: 'DEBUG ', info: 'INFO  ', error: 'ERREUR' }
  const label = labels[level]
  const tail = detail === undefined ? '' : ` | ${describeDetail(detail)}`
  return `${at.toISOString()}  ${label}  ${message}${tail}\n`
}

/** The tail of a log that grew too long, cut at a line boundary so no line is left half-written. */
export function trimSyncLog(contents: string): string {
  if (contents.length <= MAX_LOG_CHARS) return contents
  const kept = contents.slice(-KEEP_AFTER_TRIM_CHARS)
  const firstBreak = kept.indexOf('\n')
  return TRIM_MARKER + (firstBreak === -1 ? kept : kept.slice(firstBreak + 1))
}

/**
 * Appends one line to the sync log.
 *
 * NEVER throws, by contract: it is called from the very failure paths it
 * documents, where an exception would replace the real problem with a logging
 * one — and, called from a `catch`, turn a handled failure into an unhandled
 * rejection. A log that cannot be written is silent; the user's error message
 * has already been produced by then.
 */
export async function logSyncEvent(level: SyncLogLevel, message: string, detail?: unknown): Promise<void> {
  try {
    const path = await syncLogPath()
    const dir = await appConfigDir()
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    const previous = (await exists(path)) ? await readTextFile(path) : ''
    const line = formatSyncLogLine(level, message, detail, new Date())
    await writeTextFile(path, trimSyncLog(previous + line))
  } catch {
    // Silent by contract — see the doc comment above.
  }
}

/**
 * Shows the log to the user: the file itself when it exists (the file manager
 * selects it), the configuration folder otherwise — a freshly installed app has
 * no log yet, and revealing a path that does not exist fails rather than opening
 * an empty window.
 *
 * Unlike `logSyncEvent`, this DOES propagate: an "open the logs" button that
 * silently does nothing would be worse than an error message.
 */
/**
 * Opens the log in whatever the system uses for text files — the quickest way
 * from « ça n'a pas marché » to reading why, without hunting for a folder.
 *
 * Unlike the writing side, failures PROPAGATE: a missing file gets its own
 * sentence, because "nothing happened" is exactly what the user cannot debug.
 */
export async function openSyncLog(): Promise<string> {
  const path = await syncLogPath()
  if (!(await exists(path))) {
    throw new Error('Le journal est encore vide : lancez une synchronisation, puis réessayez.')
  }
  await openPath(path)
  return path
}

/**
 * Empties the log, so the next attempt is read on its own rather than mixed with
 * a week of older runs. Nothing is lost that matters: this file is a debugging
 * aid, never a record the app reads back.
 *
 * @returns whether a file was actually removed.
 */
export async function clearSyncLog(): Promise<boolean> {
  const path = await syncLogPath()
  if (!(await exists(path))) return false
  await remove(path)
  return true
}

export async function revealSyncLog(): Promise<string> {
  const path = await syncLogPath()
  if (await exists(path)) {
    await revealItemInDir(path)
    return path
  }
  const dir = await appConfigDir()
  await revealItemInDir(dir)
  return dir
}
