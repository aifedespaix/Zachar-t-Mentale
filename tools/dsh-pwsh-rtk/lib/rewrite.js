/**
 * The rtk-rewrite decision, with no DSH dependency, so it can be unit-tested
 * outside a harness process. `lib/index.js` wires it into the pwsh executor.
 *
 * `rtk rewrite "<cmd>"` is the vendor's own "single source of truth for hooks".
 * Two quirks shape the implementation:
 *
 *   - stdout is the answer, not the exit code. rtk prints the rewritten command
 *     and still exits non-zero when its tracking database is unavailable (a DSH
 *     sandbox denies writes to %APPDATA%\rtk), so gating on `status === 0` would
 *     silently discard valid rewrites.
 *   - a confined process may be refused a named pipe, which makes the ordinary
 *     `spawnSync` capture fail (EPERM) while the same command succeeds when its
 *     stdout goes to a file descriptor. The runner therefore retries through a
 *     temp file before giving up, and a whitelist parsed from rtk's own `--help`
 *     keeps routing alive on an rtk with no `rewrite` subcommand at all.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** rtk subcommands that must never be prepended to a model command (fallback mode). */
export const META_SUBCOMMANDS = new Set([
  'run', 'proxy', 'pipe', 'init', 'config', 'trust', 'untrust', 'verify',
  'telemetry', 'learn', 'discover', 'session', 'gain', 'cc-economics',
  'recall', 'hook', 'hook-audit', 'rewrite', 'help'
])

/** Fallback-mode gate: any of these means the command is a shell program, not one tool call. */
export const SHELL_METACHARACTERS = /[|&;<>`$()\r\n]/

/** Resolved strategy for this process: null while unprobed. */
let strategy = null

/** How rtk output was captured: null until a capture succeeds. */
let captureMode = null

/** command -> rewritten command, for repeat lookups (the original means "no rewrite"). */
const rewriteCache = new Map()

/**
 * One line per boot in `%TEMP%\dsh-pwsh-rtk.log`. This plugin degrades to
 * pass-through by design, which makes a silent failure indistinguishable from a
 * command rtk simply does not rewrite — so the record of *why* it degraded is
 * worth the bytes. Best effort: diagnostics never break a command.
 */
export function debugLog(line) {
  if (process.env.DSH_PWSH_RTK_QUIET === '1') return
  try {
    const dir = process.env.TEMP ?? process.env.TMP ?? '.'
    appendFileSync(join(dir, 'dsh-pwsh-rtk.log'), `${new Date().toISOString()} pid=${process.pid} ${line}\n`)
  } catch { /* never throw from diagnostics */ }
}

/**
 * Run rtk and capture stdout, preferring a pipe and falling back to a file
 * descriptor (no named pipe) when the environment refuses the pipe.
 */
function capture(args) {
  const piped = spawnSync('rtk', args, { encoding: 'utf8', windowsHide: true, timeout: 5000 })
  if (!piped.error) return { stdout: String(piped.stdout ?? ''), status: piped.status, mode: 'pipe', error: null }

  const file = join(process.env.TEMP ?? process.env.TMP ?? '.', `dsh-pwsh-rtk-${process.pid}.out`)
  let fd
  try {
    fd = openSync(file, 'w')
    const filed = spawnSync('rtk', args, { stdio: ['ignore', fd, 'ignore'], windowsHide: true, timeout: 5000 })
    closeSync(fd)
    fd = undefined
    return { stdout: readFileSync(file, 'utf8'), status: filed.status, mode: 'file', error: filed.error ?? null }
  } catch (error) {
    return { stdout: '', status: null, mode: 'file', error }
  } finally {
    if (fd !== undefined) { try { closeSync(fd) } catch { /* already closed */ } }
    try { unlinkSync(file) } catch { /* never created */ }
  }
}

/** The default rtk runner: one short-lived process, output captured, never throwing. */
export function runRtk(args) {
  try {
    const result = capture(args)
    if (result.error) {
      debugLog(`spawn rtk ${args.join(' ')} failed (${result.mode}): ${result.error.code ?? result.error.message}`)
      return null
    }
    if (captureMode === null && result.status !== null) {
      captureMode = result.mode
      debugLog(`rtk output capture resolved to '${result.mode}'`)
    }
    const stdout = String(result.stdout ?? '')
    if (stdout === '') {
      const detail = args[0] === '--version' ? '' : ` stderr=${JSON.stringify(String(result.stderr ?? '').trim().slice(0, 120))}`
      debugLog(`rtk ${args.join(' ')} -> empty stdout (status=${result.status})${detail}`)
      return null
    }
    return stdout
  } catch (error) {
    debugLog(`spawn rtk ${args.join(' ')} threw: ${error?.message ?? String(error)}`)
    return null
  }
}

/** Parse rtk's own `Commands:` block as the fallback whitelist. */
export function subcommandWhitelist(run = runRtk) {
  const help = run(['--help'])
  const found = new Set()
  if (help !== null) {
    for (const match of help.matchAll(/^\s{2}([a-z][a-z0-9-]*)\s{2,}\S/gm)) {
      if (!META_SUBCOMMANDS.has(match[1])) found.add(match[1])
    }
  }
  return found
}

/** Forget the memoized strategy (tests, or a deliberate re-probe). */
export function resetStrategy() {
  strategy = null
  captureMode = null
  rewriteCache.clear()
}

/**
 * Decide once whether rtk is usable and which authority to consult:
 * `rewrite` (this rtk ships `rtk rewrite`), `whitelist`, or `off`.
 */
export function resolveStrategy(run = runRtk) {
  if (strategy === null) {
    if (run(['--version']) === null) {
      strategy = { mode: 'off' }
      debugLog('strategy=off (rtk --version produced nothing)')
    } else if ((run(['rewrite', '--help']) ?? '').includes('Rewrite a raw command')) {
      strategy = { mode: 'rewrite' }
      debugLog('strategy=rewrite')
    } else {
      const whitelist = subcommandWhitelist(run)
      strategy = { mode: 'whitelist', whitelist }
      debugLog(`strategy=whitelist (${whitelist.size} subcommands)`)
    }
  }
  return strategy
}

/** Fallback-mode decision, mirroring rtk's conservatism about compound commands. */
export function rewriteByWhitelist(command, whitelist) {
  const trimmed = command.trim()
  if (trimmed === '' || SHELL_METACHARACTERS.test(trimmed)) return command
  const [first] = trimmed.split(/\s+/)
  if (first === 'rtk' || !whitelist.has(first)) return command
  return `rtk ${trimmed}`
}

/**
 * Accept rtk's stdout only when it is a single line that actually mentions rtk
 * and changes the command — a defensive gate against a version printing a
 * notice on stdout instead of an answer.
 */
export function acceptRewrite(original, stdout) {
  const candidate = String(stdout ?? '').trim()
  if (candidate === '' || candidate === original) return original
  if (candidate.includes('\n') || !/\brtk\b/.test(candidate)) return original
  return candidate
}

/**
 * Return the command rtk would run for `command`, or the original string when
 * there is nothing to route.
 */
export function rewriteCommand(command, resolved = resolveStrategy(), run = runRtk) {
  if (typeof command !== 'string' || command.trim() === '') return command
  if (resolved.mode === 'off') return command
  const cached = rewriteCache.get(command)
  if (cached !== undefined) return cached
  const next = resolved.mode === 'rewrite'
    ? acceptRewrite(command, run(['rewrite', command]))
    : rewriteByWhitelist(command, resolved.whitelist)
  if (rewriteCache.size < 512) rewriteCache.set(command, next)
  return next
}

// Probe once at import so the first command pays no probe latency and the
// outcome reaches the diagnostic log even in a session that runs no command.
// `DSH_PWSH_RTK_NO_PROBE=1` keeps a test process from spawning anything.
if (process.env.DSH_PWSH_RTK_NO_PROBE !== '1') {
  try { resolveStrategy() } catch { /* already logged by runRtk */ }
}
