# App shell packaging (CI + auto-update) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship lot 6 — a Windows-only GitHub Actions release pipeline and a
silent, non-intrusive auto-update mechanism for the packaged app.

**Architecture:** A tag-triggered GitHub Actions workflow builds the Tauri
app on `windows-latest` and publishes a GitHub Release (with `latest.json`)
via `tauri-action`. The app embeds `tauri-plugin-updater`, checks that
release's `latest.json` on startup, downloads and installs silently in the
background if a newer signed build exists, and surfaces a small dismissible
banner offering to restart — never a forced or interrupting update.

**Tech Stack:** Tauri 2, Rust, React 19 + TypeScript, Vitest +
`@testing-library/react`, Bun, GitHub Actions (`tauri-apps/tauri-action`).

**Spec:** `docs/superpowers/specs/2026-09-08-lot6-packaging-design.md`

## Global Constraints

- Windows only. No macOS/Linux build targets, no OS matrix in CI.
- `src-tauri/tauri.conf.json > version` is the single source of truth for
  the app version. Do not add a version-sync script across
  `package.json`/`Cargo.toml`/`tauri.conf.json` — out of scope (YAGNI).
- Releases publish automatically (`releaseDraft: false`) — no manual
  review gate before a build goes live.
- No commercial code-signing certificate. Windows SmartScreen warnings on
  install are a known, accepted limitation — do not attempt to suppress
  them.
- Always use the latest stable version of any new dependency added in this
  plan (`tauri-plugin-updater`, `tauri-plugin-process`,
  `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`) — pin only if
  a task hits a blocking bug, documented inline with a link to the tracked
  upstream issue.
- The update UX must never interrupt the user: no forced relaunch, no
  blocking dialog, no visible error banner on a failed check — see Task 4.
- GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and making the repo public are
  **manual steps the user performs themselves** (see Task 3's handoff note)
  — no task in this plan requires `gh` CLI or GitHub credentials.

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/workflows/release.yml` | CI: build + publish a GitHub Release on a `v*` tag push |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-updater`, `tauri-plugin-process` deps |
| `src-tauri/src/lib.rs` | Register the two new plugins |
| `src-tauri/capabilities/default.json` | Grant `updater:default`, `process:allow-restart` |
| `src-tauri/tauri.conf.json` | `bundle.createUpdaterArtifacts`, `plugins.updater` config |
| `package.json` | Add `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` |
| `src/hooks/useAppUpdater.ts` (+ `.test.ts`) | Silent check → background download → `updateReady` flag; `applyUpdate()` relaunches |
| `src/components/update/UpdateReadyBanner.tsx` (+ `.test.tsx`) | Dismissible "update ready" banner |
| `src/index.css` | `--info-*` tokens (light + dark) + `.status-banner--info` modifier |
| `src/App.tsx` (+ `App.test.tsx`) | Wire the hook + banner, never overlapping `loadError`/`dropError` |

---

### Task 1: CI release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces: a workflow that publishes a GitHub Release with Windows
  installer artifacts + `latest.json` whenever a `v*` tag is pushed.
  Task 3's `endpoints` config depends on this release existing at
  `https://github.com/aifedespaix/Zachar-t-Mentale/releases/latest/download/latest.json`.

- [ ] **Step 1: Create the workflow file**

```yaml
name: publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish-tauri:
    permissions:
      contents: write
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7

      - name: setup bun
        uses: oven-sh/setup-bun@v2

      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - name: install frontend dependencies
        run: bun install

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'Zachar''t Mentale v__VERSION__'
          releaseBody: 'Voir les fichiers attachés pour installer cette version.'
          releaseDraft: false
          prerelease: false
```

- [ ] **Step 2: Verify the YAML parses correctly**

Run: `uv run --with pyyaml python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml', encoding='utf-8')); print('valid YAML')"`
Expected: `valid YAML`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add tag-triggered Windows release workflow"
```

---

### Task 2: Register the updater and process Rust plugins

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `tauri-plugin-updater` and `tauri-plugin-process` Rust
  crates registered and permissioned, which Task 3's `tauri.conf.json`
  updater config and Task 4's JS plugin calls both require at runtime.

- [ ] **Step 1: Add the two dependencies**

In `src-tauri/Cargo.toml`, in the `[dependencies]` block, after the
existing `tauri-plugin-dialog = "2"` line, add:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Register both plugins**

In `src-tauri/src/lib.rs`, change:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet])
```

to:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![greet])
```

- [ ] **Step 3: Grant the permissions**

In `src-tauri/capabilities/default.json`, add two entries to the
`permissions` array (anywhere among the existing entries, e.g. right after
`"fs:default"`):

```json
    "updater:default",
    "process:allow-restart",
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: exits 0, no errors (may print warnings about unused `greet` —
pre-existing, ignore).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(tauri): register the updater and process plugins"
```

---

### Task 3: Generate the signing key and configure the updater endpoint

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: Task 2's registered `tauri-plugin-updater`.
- Produces: `plugins.updater.pubkey` / `plugins.updater.endpoints`, which
  Task 4's `check()` call relies on at runtime to find and verify updates.

- [ ] **Step 1: Generate the signing keypair**

Run: `bunx tauri signer generate -w ~/.tauri/zachart-mentale.key`

This prints a public key to the terminal (a long base64-ish string) and
writes two local files outside the repo:
`~/.tauri/zachart-mentale.key` (private) and
`~/.tauri/zachart-mentale.key.pub` (public — same value as printed).
**Never move or copy the private key file into the repo.**

- [ ] **Step 2: Add `createUpdaterArtifacts` and the `updater` plugin config**

In `src-tauri/tauri.conf.json`, change:

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

to (pasting the exact public key string printed by Step 1 in place of
`PASTE_PUBLIC_KEY_HERE`):

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "PASTE_PUBLIC_KEY_HERE",
      "endpoints": [
        "https://github.com/aifedespaix/Zachar-t-Mentale/releases/latest/download/latest.json"
      ]
    }
  }
}
```

- [ ] **Step 3: Verify the JSON is well-formed**

Run: `python -c "import json; json.load(open('src-tauri/tauri.conf.json', encoding='utf-8')); print('valid JSON')"`
Expected: `valid JSON`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(tauri): configure the updater signing key and release endpoint"
```

- [ ] **Step 5: Manual handoff (not a code step — do this yourself, not via an agent)**

Add two repository secrets on GitHub (Settings → Secrets and variables →
Actions → New repository secret):
- `TAURI_SIGNING_PRIVATE_KEY` = the full contents of
  `~/.tauri/zachart-mentale.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you chose when
  Step 1 prompted for one

This step requires your own GitHub authentication and is intentionally
outside the scope of any task an agent can execute (see Global
Constraints).

---

### Task 4: `useAppUpdater` hook

**Files:**
- Modify: `package.json` (via `bun add`)
- Create: `src/hooks/useAppUpdater.ts`
- Test: `src/hooks/useAppUpdater.test.ts`

**Interfaces:**
- Consumes: `check` from `@tauri-apps/plugin-updater`, `relaunch` from
  `@tauri-apps/plugin-process`.
- Produces: `useAppUpdater(): { updateReady: boolean; applyUpdate: () =>
  Promise<void> }` — Task 6 (`App.tsx`) renders `UpdateReadyBanner` based
  on `updateReady` and wires its restart button to `applyUpdate`.

- [ ] **Step 1: Install the two frontend packages**

Run: `bun add @tauri-apps/plugin-updater @tauri-apps/plugin-process`

- [ ] **Step 2: Write the failing test**

Create `src/hooks/useAppUpdater.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAppUpdater } from './useAppUpdater'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

describe('useAppUpdater', () => {
  beforeEach(() => {
    vi.mocked(check).mockReset()
    vi.mocked(relaunch).mockReset()
  })

  it('stays not-ready and never downloads when no update is available', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('downloads automatically and becomes ready when an update is available', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValue({ available: true, downloadAndInstall } as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(result.current.updateReady).toBe(true))
    expect(downloadAndInstall).toHaveBeenCalled()
  })

  it('stays not-ready and does not throw when check() rejects', async () => {
    vi.mocked(check).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('stays not-ready and does not throw when downloadAndInstall() rejects', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('network dropped'))
    vi.mocked(check).mockResolvedValue({ available: true, downloadAndInstall } as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('applyUpdate() relaunches the app', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    await result.current.applyUpdate()
    expect(relaunch).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useAppUpdater.test.ts`
Expected: FAIL — `useAppUpdater.ts` does not exist yet.

- [ ] **Step 4: Implement the hook**

Create `src/hooks/useAppUpdater.ts`:

```ts
import { useEffect, useState } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export interface AppUpdaterState {
  /** True once a signed update has been fully downloaded and installed —
   * restarting the app is safe and will boot into the new version. */
  updateReady: boolean
  applyUpdate: () => Promise<void>
}

/**
 * Checks for an update once on mount and, if one exists, downloads and
 * installs it silently in the background — no progress UI, no prompt.
 * Any failure (offline, unreachable endpoint, bad signature, dropped
 * download) is swallowed: the app just tries again on its next launch.
 * `applyUpdate` (relaunch) is never called automatically — only a user
 * action should ever restart the app.
 */
export function useAppUpdater(): AppUpdaterState {
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    check()
      .then(async update => {
        if (!update || update.available === false) return
        await update.downloadAndInstall()
        if (!cancelled) setUpdateReady(true)
      })
      .catch(error => {
        console.error('Échec de la vérification/installation de la mise à jour :', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { updateReady, applyUpdate: relaunch }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useAppUpdater.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/hooks/useAppUpdater.ts src/hooks/useAppUpdater.test.ts
git commit -m "feat(update): add useAppUpdater — silent check, download, and install"
```

---

### Task 5: `UpdateReadyBanner` component + CSS tokens

**Files:**
- Modify: `src/index.css`
- Create: `src/components/update/UpdateReadyBanner.tsx`
- Test: `src/components/update/UpdateReadyBanner.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (takes `onApply: () =>
  void` as a prop).
- Produces: `UpdateReadyBanner({ onApply }: { onApply: () => void })` —
  Task 6 renders it with `onApply={applyUpdate}` from `useAppUpdater()`.

- [ ] **Step 1: Add the `--info-*` tokens**

In `src/index.css`, in the light `:root` block, right after
`--warning-fg: oklch(0.4 0.12 60);`, add:

```css
  --info-bg: oklch(0.94 0.03 240);
  --info-border: oklch(0.7 0.1 240);
  --info-fg: oklch(0.35 0.08 240);
```

In the dark theme block, right after `--warning-fg: oklch(0.9 0.08 80);`,
add:

```css
  --info-bg: oklch(0.28 0.05 240);
  --info-border: oklch(0.5 0.12 240);
  --info-fg: oklch(0.88 0.06 240);
```

- [ ] **Step 2: Add the `.status-banner--info` modifier**

Right after the existing `.status-banner { ... }` rule, add:

```css
/* Modifier for a neutral/informational banner (e.g. update-ready) sharing
   .status-banner's layout but themed via the info tokens instead of the
   warning ones. */
.status-banner--info {
  border-color: var(--info-border);
  background: var(--info-bg);
  color: var(--info-fg);
}
```

- [ ] **Step 3: Write the failing test**

Create `src/components/update/UpdateReadyBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateReadyBanner } from './UpdateReadyBanner'

describe('UpdateReadyBanner', () => {
  it('shows a Redémarrer button that calls onApply when clicked', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<UpdateReadyBanner onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'Redémarrer' }))

    expect(onApply).toHaveBeenCalled()
  })

  it('hides itself when the dismiss button is clicked, without calling onApply', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<UpdateReadyBanner onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'Masquer le message de mise à jour' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/components/update/UpdateReadyBanner.test.tsx`
Expected: FAIL — `UpdateReadyBanner.tsx` does not exist yet.

- [ ] **Step 5: Implement the component**

Create `src/components/update/UpdateReadyBanner.tsx`:

```tsx
import { useState } from 'react'

interface UpdateReadyBannerProps {
  onApply: () => void
}

/**
 * A discreet, dismissible banner offering to restart into an already
 * fully-downloaded update. Dismissing only hides it — the update has
 * already been installed by useAppUpdater and will apply on the next
 * natural relaunch regardless.
 */
export function UpdateReadyBanner({ onApply }: UpdateReadyBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div role="status" className="status-banner status-banner--info">
      <span style={{ flex: 1 }}>Mise à jour prête</span>
      <button
        type="button"
        onClick={onApply}
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: 4,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 13,
          padding: '2px 8px',
        }}
      >
        Redémarrer
      </button>
      <button
        type="button"
        aria-label="Masquer le message de mise à jour"
        onClick={() => setDismissed(true)}
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15 }}
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/components/update/UpdateReadyBanner.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/components/update/UpdateReadyBanner.tsx src/components/update/UpdateReadyBanner.test.tsx
git commit -m "feat(update): add the UpdateReadyBanner component and info CSS tokens"
```

---

### Task 6: Wire the updater into `App.tsx`

**Files:**
- Modify: `src/App.tsx:1-29` (imports), `:79` (hooks), `:214-232` (banners)
- Modify: `src/App.test.tsx:1-44` (mocks/imports), append a new `describe`
  block

**Interfaces:**
- Consumes: `useAppUpdater` (Task 4), `UpdateReadyBanner` (Task 5).
- Produces: nothing consumed by later tasks (this is the integration
  point; no further lot-6 tasks exist).

- [ ] **Step 1: Write the failing test**

In `src/App.test.tsx`, add these two mocks right after the existing
`vi.mock('@tauri-apps/plugin-dialog', ...)` line (line 34):

```ts
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn().mockResolvedValue(null) }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
```

Add this import right after the existing `import { loadSessionState } ...`
line (line 44):

```ts
import { check } from '@tauri-apps/plugin-updater'
```

Append this new `describe` block at the end of the file:

```tsx
describe('App update banner', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    vi.mocked(check).mockReset()
  })

  it('shows the update banner once the background download finishes', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValue({ available: true, downloadAndInstall } as never)

    render(<App />)

    expect(await screen.findByText('Mise à jour prête')).toBeInTheDocument()
  })

  it('does not show the update banner when no update is available', async () => {
    vi.mocked(check).mockResolvedValue(null)

    render(<App />)
    await act(async () => {})

    expect(screen.queryByText('Mise à jour prête')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.tsx -t "update banner"`
Expected: FAIL — `App.tsx` does not render `UpdateReadyBanner` yet, so
"Mise à jour prête" is never found.

- [ ] **Step 3: Wire the hook and banner into `App.tsx`**

Add these two imports after the existing
`import { useAppliedFontFamily } from './hooks/useAppliedFontFamily'`
line (line 29):

```ts
import { useAppUpdater } from './hooks/useAppUpdater'
import { UpdateReadyBanner } from './components/update/UpdateReadyBanner'
```

Add the hook call right after `useAppliedFontFamily()` (line 79):

```ts
  const { updateReady, applyUpdate } = useAppUpdater()
```

Insert the banner right after the `dropError` block and before `<main
ref={mainRef} ...>` (i.e. right after the closing `)}` that follows line
232's `dropError` block):

```tsx
        {!loadError && !dropError && updateReady && (
          <UpdateReadyBanner onApply={applyUpdate} />
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/App.test.tsx -t "update banner"`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: all tests pass (the pre-existing suite plus the new ones from
Tasks 4-6).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(update): wire the silent updater and its banner into App"
```

---

## After this plan

This plan produces working, testable code but **cannot itself prove the
release pipeline works** — CI workflow correctness and a real signed
update round-trip can only be verified by actually cutting a release (see
spec's Tests section). Once all 6 tasks are merged:

1. Complete Task 3 Step 5 (GitHub secrets) if not already done.
2. Bump `version` in `tauri.conf.json`, commit, `git tag v0.1.1 && git push
   origin v0.1.1` (or whatever the next version is).
3. Watch the Actions run succeed and the Release appear with installer +
   `latest.json` attached.
4. Install that build, then cut a `v0.1.2` and confirm the running app
   picks it up (silent download, banner appears, restart applies it).

This verification is explicitly out of scope for the task-by-task
implementation above (it requires a real GitHub Actions run and two real
released versions) — do it once, by hand, after the plan is fully merged.
