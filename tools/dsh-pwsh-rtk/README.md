# dsh-pwsh-rtk

Route eligible PowerShell commands through [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) inside DeepSeek Harness — compress tool output, save tokens, change nothing else.

The **pwsh twin** of [`@deeptrial/dsh-bash-rtk`](https://github.com/DeepTrial/dsh-bash-rtk), which only wraps the POSIX `bash` executor. On Windows the model's shell tool is `pwsh`, so that plugin never sees the commands; this one wraps `SandboxPwshExecutor` instead.

## Why an executor subclass (and not a hook)

DSH deliberately forbids rewriting tool arguments:

- `PreToolDecision` is `allow | deny | ask`, documented as *"Input rewriting is excluded because arguments are already logged and presented"*;
- the tool registry *"materializes and freezes parsed arguments"* before dispatch;
- the Claude Code hook bridge logs and ignores `updatedInput` — which is how `rtk hook claude` rewrites commands — so mounting that bridge would not help either ([upstream still has it only as a proposal](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.zh.md)).

The last stop before a command string becomes an argv is `ShellExecutor.resolve(request) -> spec`. Subclassing the mounted executor and rewriting `request.command` there is the same seam `dsh-bash-rtk` uses, and it leaves the tool layer, logging, approvals and sandbox untouched.

## Authority: rtk itself

`rtk rewrite "<cmd>"` is the vendor's *"single source of truth for hooks"*: exit 0 and print the rewritten command, or exit 1 with no output when the command has no rtk equivalent. This plugin forwards that answer and never invents a mapping.

Two quirks are handled explicitly:

- **stdout is the answer, not the exit code.** Measured against rtk 0.42.4 inside a DSH sandbox: `rtk rewrite "git status"` prints `rtk git status` while exiting **3**, because its tracking database (`%APPDATA%\rtk`) is not writable there. A `status === 0` gate would silently discard every valid rewrite. The plugin therefore accepts single-line stdout that mentions rtk and differs from the input, and refuses anything else (junk, multi-line notices, unchanged text).
- **old rtk falls back to a whitelist** parsed from rtk's own `--help` (minus its meta subcommands), so the classic tool set still routes on a binary that predates `rtk rewrite`.

Any failure — no rtk, spawn refused by a sandbox (`EPERM` on piped stdio), timeout, unusable output — degrades to byte-identical pass-through. Installing this plugin cannot make a command *run* differently, only be reported more compactly.

## Install

```powershell
# from a checkout of this directory
pwsh -File .\install.ps1          # copies the package into the web profile + patches cordis.patch.yml
# then restart dsh web
```

`install.ps1` backs up `cordis.patch.yml` and `package.json` with a timestamp first, and prints the exact revert line.

Manual equivalent:

```powershell
# 1. the package must live *inside* the profile: a `link:` to a directory elsewhere
#    resolves bare imports (@deepseek-ai/*) from its real path and fails.
Copy-Item -Recurse . "$env:DSH_HOME\profiles\web\node_modules\dsh-pwsh-rtk"

# 2. paste into ~/.dsh/profiles/web/cordis.patch.yml (see ./cordis.patch.yml)
#    - id: pwsh-sandbox
#      disabled: true
#    - insert:
#        - id: pwsh-rtk
#          name: 'dsh-pwsh-rtk'

# 3. restart dsh web
```

## Verify

**Probe with a bare command.** rtk refuses compound commands, so a pipe, `;`, `&&`,
redirect or `$()` disqualifies it — appending `| Select-Object -First 10` to a probe
hides exactly the rewrite you are testing for. This cost an hour of debugging once;
do not repeat it.

```powershell
git status                            # rewritten: * main...origin/main  ·  ?? tools/
git status -sb                        # rewritten
ls                                    # rewritten to `rtk ls` (rtk then needs a native ls on PATH)
git status | Select-Object -First 10  # NOT rewritten — rtk's own refusal, by design
```

Two independent confirmations, neither relying on output formatting:

```powershell
# the executor spawns `rtk rewrite` just before each unseen command:
do { Get-Process rtk -ErrorAction SilentlyContinue | Select-Object Id; Start-Sleep -Milliseconds 20 } while ($true)

# a rewritten command runs *through* rtk, so rtk's own counter moves:
rtk gain | Select-String 'Total commands'
```

Unit tests, no harness required:

```powershell
node test\rewrite.test.mjs      # 11 cases, injected rtk runner
```

## Diagnostics

`%TEMP%\dsh-pwsh-rtk.log` gets one line per boot and one per degraded probe, because
this plugin fails *quietly* — a refused command and a broken probe look identical from
the outside. Delete the file to reset. Lines seen in practice:

```
rtk output capture resolved to 'pipe'
strategy=rewrite
rtk rewrite <cmd> -> empty stdout (status=1)     # rtk has no equivalent: expected
spawn rtk --version failed (pipe): EPERM         # a confined shell refused the pipe
```

## Uninstall

```powershell
pwsh -File .\uninstall.ps1       # removes the two patch rows and the copied package
```

## Limits

- Windows only: the subclass extends `SandboxPwshExecutor`, the executor row enabled on `win32`.
- **Compound commands are never rewritten** — that is rtk's decision, not this plugin's, and it is deliberate: wrapping a shell program would change what runs. Keep probes bare.
- One rtk process per distinct command (`spawnSync`, cached per command string, ≤512 entries). A few milliseconds inside a command that already costs far more; not free.
- DSH is pre-stable (`0.1.5-rc.2` here) and this overrides an internal method. If a DSH upgrade renames `resolve()` or `SandboxPwshExecutor`, the plugin stops rewriting (loudly, at load). Re-check with:
  `node -e "import('@deepseek-ai/dsh-pwsh-sandbox').then(m => console.log(Object.keys(m)))"` from the profile directory.

MIT.
