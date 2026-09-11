/**
 * dsh-pwsh-rtk — route eligible PowerShell commands through `rtk` (Rust Token Killer).
 *
 * See ../README.md for why this hooks the shell executor's `resolve()` boundary
 * instead of a tool policy hook. The decision logic lives in ./rewrite.js.
 */

import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox'
import { rewriteCommand } from './rewrite.js'

export { acceptRewrite, resetStrategy, resolveStrategy, rewriteByWhitelist, rewriteCommand } from './rewrite.js'

/**
 * The mounted Windows executor with rtk routing at the resolve boundary.
 * Sandbox confinement, budgets, spill, termination and exit classification are
 * inherited unchanged.
 */
export default class RtkSandboxPwshExecutor extends SandboxPwshExecutor {
  resolve(request) {
    const rewritten = rewriteCommand(request.command)
    if (rewritten === request.command) return super.resolve(request)
    return super.resolve({ ...request, command: rewritten })
  }
}
