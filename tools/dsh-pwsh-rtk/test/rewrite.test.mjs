/**
 * Unit tests for the rtk-rewrite decision, run with `node test/rewrite.test.mjs`.
 *
 * The rtk runner is injected, so this suite exercises the real decision logic
 * without spawning anything (which a confined DSH shell refuses anyway) and
 * covers the exit-code quirk observed against rtk 0.42.4 in a sandbox.
 */

import assert from 'node:assert/strict'

// The module probes rtk once at import so a real session pays no probe latency.
// Tests inject their own runner, so keep that probe out of the way.
process.env.DSH_PWSH_RTK_NO_PROBE = '1'
// Injected runners would otherwise write their decisions into the session log.
process.env.DSH_PWSH_RTK_QUIET = '1'
const {
  acceptRewrite, resetStrategy, resolveStrategy, rewriteByWhitelist, rewriteCommand, subcommandWhitelist
} = await import('../lib/rewrite.js')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('PASS ' + name)
  } catch (error) {
    console.log('FAIL ' + name + '\n     ' + error.message)
    process.exitCode = 1
  }
}

/** A fake rtk: rewrite answers, ignoring exit status the way the real binary does. */
const REWRITES = {
  'git status': 'rtk git status',
  'git log --oneline -20': 'rtk git log --oneline -20',
  'cargo test && git push': 'rtk cargo test && rtk git push',
  'git commit -m "a;b"': 'rtk git commit -m "a;b"'
}

const runRewriteMode = (args) => {
  if (args[0] === '--version') return 'rtk 0.42.4\n'
  if (args[0] === 'rewrite' && args[1] === '--help') return 'Rewrite a raw command to its RTK equivalent (single source of truth for hooks)\n'
  if (args[0] === 'rewrite') return REWRITES[args[1]] ?? null
  return null
}

const HELP_FIXTURE = 'Commands:\n  ls             List directory contents\n  git            Git commands\n  rg             Compact ripgrep\n  run            Execute via sh -c\n  rewrite        Rewrite a raw command\n'

const runWhitelistMode = (args) => {
  if (args[0] === '--version') return 'rtk 0.42.4\n'
  if (args[0] === 'rewrite') return null
  if (args[0] === '--help') return HELP_FIXTURE
  return null
}

const runAbsentMode = () => null

test('strategy: rewrite when the binary exposes `rtk rewrite`', () => {
  resetStrategy()
  assert.deepEqual(resolveStrategy(runRewriteMode).mode, 'rewrite')
})

test('strategy: off when rtk is absent', () => {
  resetStrategy()
  assert.deepEqual(resolveStrategy(runAbsentMode).mode, 'off')
  assert.equal(rewriteCommand('git status', resolveStrategy(runAbsentMode), runAbsentMode), 'git status')
})

test('strategy: whitelist fallback on an rtk without `rewrite`', () => {
  resetStrategy()
  const resolved = resolveStrategy(runWhitelistMode)
  assert.equal(resolved.mode, 'whitelist')
  assert.ok(resolved.whitelist.has('git'))
  assert.ok(resolved.whitelist.has('rg'))
  assert.ok(!resolved.whitelist.has('run'), 'meta subcommands must be excluded')
  assert.ok(!resolved.whitelist.has('rewrite'), 'meta subcommands must be excluded')
})

test('rewrite authority: stdout wins over a non-zero exit code', () => {
  resetStrategy()
  const resolved = resolveStrategy(runRewriteMode)
  // rtk 0.42.4 in a DSH sandbox prints the rewrite and exits 3 (its tracking DB
  // is unwritable). The injected runner mirrors that by never signalling status.
  assert.equal(rewriteCommand('git status', resolved, runRewriteMode), 'rtk git status')
})

test('rewrite authority: a command with no rtk equivalent passes through', () => {
  resetStrategy()
  const resolved = resolveStrategy(runRewriteMode)
  for (const command of ['Get-ChildItem -Force', 'npm test', 'git status | Select-String x']) {
    assert.equal(rewriteCommand(command, resolved, runRewriteMode), command)
  }
})

test('rewrite authority: compound commands are left to rtk', () => {
  resetStrategy()
  const resolved = resolveStrategy(runRewriteMode)
  assert.equal(rewriteCommand('cargo test && git push', resolved, runRewriteMode), 'rtk cargo test && rtk git push')
})

test('rewrite authority: quoted metacharacters are rtk\'s call, not a local veto', () => {
  resetStrategy()
  const resolved = resolveStrategy(runRewriteMode)
  assert.equal(rewriteCommand('git commit -m "a;b"', resolved, runRewriteMode), 'rtk git commit -m "a;b"')
})

test('cache: repeat lookups do not re-run the runner', () => {
  resetStrategy()
  const resolved = resolveStrategy(runRewriteMode)
  let calls = 0
  const counting = (args) => { calls++; return runRewriteMode(args) }
  rewriteCommand('git status', resolved, counting)
  rewriteCommand('git status', resolved, counting)
  assert.equal(calls, 1)
})

test('guard: junk, multi-line, or unchanged stdout is refused', () => {
  assert.equal(acceptRewrite('git status', ''), 'git status')
  assert.equal(acceptRewrite('git status', '  '), 'git status')
  assert.equal(acceptRewrite('git status', 'git status'), 'git status')
  assert.equal(acceptRewrite('git status', 'no rewrite available\nsecond line'), 'git status')
  assert.equal(acceptRewrite('git status', 'warning: something\n'), 'git status')
  assert.equal(acceptRewrite('git status', 'rtk git status\n'), 'rtk git status')
})

test('whitelist gate: shape, first token, and idempotence', () => {
  const whitelist = subcommandWhitelist(() => HELP_FIXTURE)
  assert.equal(rewriteByWhitelist('git status', whitelist), 'rtk git status')
  assert.equal(rewriteByWhitelist('  rg -n TODO src  ', whitelist), 'rtk rg -n TODO src')
  assert.equal(rewriteByWhitelist('rtk gain', whitelist), 'rtk gain')
  assert.equal(rewriteByWhitelist('ls | rtk git status', whitelist), 'ls | rtk git status')
  assert.equal(rewriteByWhitelist('Write-Output 1', whitelist), 'Write-Output 1')
  assert.equal(rewriteByWhitelist('', whitelist), '')
})

test('non-string input never throws', () => {
  resetStrategy()
  const resolved = resolveStrategy(runRewriteMode)
  assert.equal(rewriteCommand(undefined, resolved, runRewriteMode), undefined)
  assert.equal(rewriteCommand(null, resolved, runRewriteMode), null)
  assert.equal(rewriteCommand('   ', resolved, runRewriteMode), '   ')
})

console.log('\n' + passed + ' tests OK' + (process.exitCode ? ' (avec echecs)' : ''))
