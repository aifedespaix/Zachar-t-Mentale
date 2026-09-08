# Sidebar Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible action buttons on each sidebar row (`FileTreeRow.tsx`) with double-click-to-rename plus a right-click context menu (rename/export/delete/create/import/duplicate), backed by a shared naming modal and a new `duplicatePath` file operation.

**Architecture:** A new `radix-ui`-based `ContextMenu` UI primitive (mirroring the existing `Dialog` wrapper) drives per-row menus; a new generic `NameDialog` modal replaces the old inline "creating" input for create/duplicate; `fileOps.ts` gains `freeSiblingPath` (generalizing the existing `freeMindMapPath`) and `duplicatePath`. `FileTreeRow.tsx` is rewritten in one pass since its folder and mind-map branches share state/handlers that cannot be split across tasks without leaving an intermediate broken build.

**Tech Stack:** React + TypeScript, `radix-ui` (already a dependency), Tauri `@tauri-apps/plugin-fs`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-sidebar-menu-contextuel-design.md`

## Global Constraints

- No new npm dependency: `radix-ui` (bundled ContextMenu) and `cn` are already installed.
- Follow the existing wrapper convention from `src/components/ui/dialog.tsx` for the new `src/components/ui/context-menu.tsx` (`"use client"`, `cn` from `"cn"`, Tailwind classes using the `data-open`/`data-closed`/`data-disabled` custom variants already defined by the `shadcn` package import in `src/index.css`, plus explicit `data-[highlighted]:` bracket syntax for radix's highlight state, which has no custom variant).
- Follow the existing relative-import, inline-style convention (no Tailwind) for `src/components/sidebar/*.tsx`, matching `ExportDialog.tsx` and the current `FileTreeRow.tsx`.
- `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters: true` — every added import must be used.
- No sanitization of user-typed names beyond what already exists (`createMindMapFile`/`createSubfolder` never sanitize; only auto-generated defaults do, via `sanitizeFileName` inside `freeSiblingPath`).
- TDD throughout: a failing test before every implementation change.

---

### Task 1: `fileOps.ts` — `freeSiblingPath` and `duplicatePath`

**Files:**
- Modify: `src/persistence/fileOps.ts`
- Test: `src/persistence/fileOps.test.ts`

**Interfaces:**
- Produces: `freeSiblingPath(folderPath: string, baseName: string, isFolder: boolean): Promise<string>`, `duplicatePath(sourcePath: string, destPath: string, isFolder: boolean): Promise<void>`, and `withJsonExtension` becomes exported (was private).
- `freeMindMapPath` keeps its existing signature/behavior, now implemented via `freeSiblingPath`.

- [ ] **Step 1: Write the failing tests**

Add to `src/persistence/fileOps.test.ts`. First, extend the top-of-file `@tauri-apps/plugin-fs` mock to add `readDir` and `copyFile`:

```ts
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  readDir: vi.fn(),
  copyFile: vi.fn(),
}))
```

And the import line right after it:

```ts
import { mkdir, remove, rename, writeTextFile, exists, readDir, copyFile } from '@tauri-apps/plugin-fs'
```

Then append these two new `describe` blocks at the end of the file (after the existing `'the asset sidecar travels with its mind map'` block), and add `duplicatePath, freeSiblingPath` to the existing top import from `./fileOps`:

```ts
import { createMindMapFile, createSubfolder, renamePath, deletePath, freeMindMapPath, freeSiblingPath, duplicatePath } from './fileOps'
```

```ts
describe('freeSiblingPath', () => {
  beforeEach(() => {
    vi.mocked(mindMapExists).mockReset()
    vi.mocked(exists).mockReset()
  })

  it('returns the plain sanitized name for a file, appending .json', async () => {
    vi.mocked(mindMapExists).mockResolvedValue(false)
    const path = await freeSiblingPath('/cours', 'Chapitre 3 (copie)', false)
    expect(path).toBe('/cours/Chapitre 3 (copie).json')
  })

  it('returns the plain sanitized name for a folder, with no extension', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const path = await freeSiblingPath('/cours', 'Chimie (copie)', true)
    expect(path).toBe('/cours/Chimie (copie)')
  })

  it('appends a numbered suffix until it finds a free file name', async () => {
    vi.mocked(mindMapExists).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const path = await freeSiblingPath('/cours', 'Chapitre', false)
    expect(path).toBe('/cours/Chapitre (2).json')
  })

  it('appends a numbered suffix until it finds a free folder name', async () => {
    vi.mocked(exists).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const path = await freeSiblingPath('/cours', 'Chimie', true)
    expect(path).toBe('/cours/Chimie (3)')
  })
})

describe('duplicatePath', () => {
  beforeEach(() => {
    vi.mocked(copyFile).mockReset().mockResolvedValue(undefined)
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined)
    vi.mocked(readDir).mockReset()
    vi.mocked(exists).mockReset().mockResolvedValue(false)
  })

  it('copies a single mind map file with no sidecar', async () => {
    await duplicatePath('/cours/chapitre.json', '/cours/chapitre (copie).json', false)
    expect(copyFile).toHaveBeenCalledWith('/cours/chapitre.json', '/cours/chapitre (copie).json')
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('copies the asset sidecar alongside a duplicated mind map', async () => {
    vi.mocked(exists).mockResolvedValueOnce(true)
    vi.mocked(readDir).mockResolvedValueOnce([
      { name: 'schema.png', isDirectory: false, isFile: true, isSymlink: false },
    ])
    await duplicatePath('/cours/chapitre.json', '/cours/chapitre (copie).json', false)
    expect(mkdir).toHaveBeenCalledWith('/cours/chapitre (copie).assets')
    expect(copyFile).toHaveBeenCalledWith(
      '/cours/chapitre.assets/schema.png',
      '/cours/chapitre (copie).assets/schema.png'
    )
  })

  it('leaves a map with no sidecar alone', async () => {
    await duplicatePath('/cours/chapitre.json', '/cours/chapitre (copie).json', false)
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('recursively copies a folder and its contents', async () => {
    vi.mocked(readDir)
      .mockResolvedValueOnce([
        { name: 'atomes.json', isDirectory: false, isFile: true, isSymlink: false },
        { name: 'sous-dossier', isDirectory: true, isFile: false, isSymlink: false },
      ])
      .mockResolvedValueOnce([{ name: 'liaisons.json', isDirectory: false, isFile: true, isSymlink: false }])
    await duplicatePath('/cours/chimie', '/cours/chimie (copie)', true)

    expect(mkdir).toHaveBeenCalledWith('/cours/chimie (copie)')
    expect(mkdir).toHaveBeenCalledWith('/cours/chimie (copie)/sous-dossier')
    expect(copyFile).toHaveBeenCalledWith('/cours/chimie/atomes.json', '/cours/chimie (copie)/atomes.json')
    expect(copyFile).toHaveBeenCalledWith(
      '/cours/chimie/sous-dossier/liaisons.json',
      '/cours/chimie (copie)/sous-dossier/liaisons.json'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/persistence/fileOps.test.ts`
Expected: FAIL — `freeSiblingPath`/`duplicatePath` are not exported / not defined.

- [ ] **Step 3: Implement `freeSiblingPath` and `duplicatePath`**

In `src/persistence/fileOps.ts`:

1. Change the import line to add `readDir, copyFile`:

```ts
import { mkdir, remove, rename, writeTextFile, exists, readDir, copyFile } from '@tauri-apps/plugin-fs'
```

2. Export `withJsonExtension` (was private):

```ts
export function withJsonExtension(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`
}
```

3. Replace `freeMindMapPath`'s body and add `freeSiblingPath` right before it:

```ts
/**
 * A free `<folderPath>/<baseName>[ (n)]` path, with a forced `.json`
 * extension when `isFolder` is false: the plain sanitized name if free,
 * else the first numbered variant that doesn't collide. Generalizes what
 * `freeMindMapPath` used to do inline, to also cover folders and
 * duplicate-name defaults.
 */
export async function freeSiblingPath(folderPath: string, baseName: string, isFolder: boolean): Promise<string> {
  const safe = sanitizeFileName(baseName)
  const separator = folderPath.includes('\\') ? '\\' : '/'
  const nameOf = (candidateBase: string) => (isFolder ? candidateBase : withJsonExtension(candidateBase))
  const isTaken = (candidatePath: string) => (isFolder ? exists(candidatePath) : mindMapExists(candidatePath))
  let candidate = `${folderPath}${separator}${nameOf(safe)}`
  let attempt = 1
  while (await isTaken(candidate)) {
    attempt += 1
    candidate = `${folderPath}${separator}${nameOf(`${safe} (${attempt})`)}`
  }
  return candidate
}

/**
 * A free `<folderPath>/<baseName>[ (n)].json` path. Used when writing a
 * file whose name comes from external data (an XMind sheet title) that
 * could coincidentally match something already in the folder.
 */
export async function freeMindMapPath(folderPath: string, baseName: string): Promise<string> {
  return freeSiblingPath(folderPath, baseName, false)
}
```

4. Add `copyDirRecursive` and `duplicatePath` at the end of the file:

```ts
async function copyDirRecursive(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir)
  const entries = await readDir(sourceDir)
  for (const entry of entries) {
    const sourcePath = await join(sourceDir, entry.name)
    const destPath = await join(destDir, entry.name)
    if (entry.isDirectory) {
      await copyDirRecursive(sourcePath, destPath)
    } else {
      await copyFile(sourcePath, destPath)
    }
  }
}

/**
 * Duplicates a file or folder onto a new sibling path, carrying a mind
 * map's asset sidecar with it.
 *
 * The sidecar copy is best-effort ON PURPOSE, same rationale as
 * `renamePath`: the primary copy has already succeeded by then, and
 * throwing here would report a failure for an operation that half-happened.
 */
export async function duplicatePath(sourcePath: string, destPath: string, isFolder: boolean): Promise<void> {
  if (isFolder) {
    await copyDirRecursive(sourcePath, destPath)
    return
  }
  await copyFile(sourcePath, destPath)
  if (!isMindMapPath(sourcePath)) return

  try {
    const sourceSidecar = sidecarDirOf(sourcePath)
    if (!(await exists(sourceSidecar))) return
    await copyDirRecursive(sourceSidecar, sidecarDirOf(destPath))
  } catch {
    // Best-effort, as in `renamePath`: the `.json` copy already succeeded.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/persistence/fileOps.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/fileOps.ts src/persistence/fileOps.test.ts
git commit -m "$(cat <<'EOF'
feat(persistence): add duplicatePath and generalize freeMindMapPath

freeSiblingPath extends the existing collision-avoidance numbering to
folders and non-.json defaults; duplicatePath copies a file (with its
asset sidecar, best-effort) or recursively copies a folder. Both back
the upcoming sidebar context menu's Dupliquer action.
EOF
)"
```

---

### Task 2: `src/components/ui/context-menu.tsx` — radix-ui wrapper

**Files:**
- Create: `src/components/ui/context-menu.tsx`
- Test: `src/components/ui/context-menu.test.tsx`

**Interfaces:**
- Produces: `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem` (props include `variant?: "default" | "destructive"`), `ContextMenuSeparator`, `ContextMenuSub`, `ContextMenuSubTrigger`, `ContextMenuSubContent` — all re-exported from the file, mirroring `dialog.tsx`'s pattern.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/context-menu.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './context-menu'

describe('ContextMenu', () => {
  it('opens on right-click and runs an item\'s handler on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <div>Ligne</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Action</ContextMenuItem>
          <ContextMenuSeparator />
        </ContextMenuContent>
      </ContextMenu>
    )

    expect(screen.queryByRole('menuitem', { name: 'Action' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('Ligne'))
    await user.click(await screen.findByRole('menuitem', { name: 'Action' }))

    expect(onSelect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/context-menu.test.tsx`
Expected: FAIL — `./context-menu` module does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/ui/context-menu.tsx`:

```tsx
"use client"

import * as React from "react"
import { cn } from "cn"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { ChevronRightIcon } from "lucide-react"

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPortal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </ContextMenuPortal>
  )
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/context-menu.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/context-menu.tsx src/components/ui/context-menu.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add ContextMenu primitive wrapper

Mirrors the existing Dialog wrapper's convention (radix-ui + cn +
Tailwind data-state variants). Backs the sidebar row menu and, later,
the graph canvas menu.
EOF
)"
```

---

### Task 3: `src/components/sidebar/NameDialog.tsx` — naming modal

**Files:**
- Create: `src/components/sidebar/NameDialog.tsx`
- Test: `src/components/sidebar/NameDialog.test.tsx`

**Interfaces:**
- Produces: `NameDialog({ title, initialName, confirmLabel, onConfirm, onCancel }: NameDialogProps)`, where `NameDialogProps = { title: string; initialName: string; confirmLabel: string; onConfirm: (name: string) => void; onCancel: () => void }`.
- Consumes: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` from `../ui/dialog`; `Button` from `../ui/button`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/sidebar/NameDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NameDialog } from './NameDialog'

describe('NameDialog', () => {
  it('pre-fills the name field with the initial name, fully selected', () => {
    render(
      <NameDialog
        title="Nouvelle carte mentale"
        initialName="Nouvelle carte mentale"
        confirmLabel="Créer"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )

    const input = screen.getByRole('textbox', { name: 'Nouvelle carte mentale' }) as HTMLInputElement
    expect(input).toHaveValue('Nouvelle carte mentale')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Nouvelle carte mentale'.length)
  })

  it('confirms with the trimmed name on Enter', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NameDialog
        title="Dupliquer « Chapitre 3 »"
        initialName="Chapitre 3 (copie)"
        confirmLabel="Dupliquer"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    const input = screen.getByRole('textbox', { name: /dupliquer/i })
    await user.clear(input)
    await user.type(input, '  Ma copie  {Enter}')

    expect(onConfirm).toHaveBeenCalledWith('Ma copie')
  })

  it('confirms with the current name when the confirm button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NameDialog
        title="Nouveau sous-dossier"
        initialName="Nouveau dossier"
        confirmLabel="Créer"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(onConfirm).toHaveBeenCalledWith('Nouveau dossier')
  })

  it('disables the confirm button and refuses to submit an empty name', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NameDialog
        title="Nouvelle carte mentale"
        initialName="Nouvelle carte mentale"
        confirmLabel="Créer"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    const input = screen.getByRole('textbox', { name: 'Nouvelle carte mentale' })
    await user.clear(input)

    expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <NameDialog
        title="Nouvelle carte mentale"
        initialName="Nouvelle carte mentale"
        confirmLabel="Créer"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/sidebar/NameDialog.test.tsx`
Expected: FAIL — `./NameDialog` module does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/sidebar/NameDialog.tsx`:

```tsx
// src/components/sidebar/NameDialog.tsx
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'

export interface NameDialogProps {
  title: string
  initialName: string
  confirmLabel: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

/**
 * Generic name-entry modal shared by "create a mind map", "create a
 * subfolder", and "duplicate" — the pre-filled name is always already free
 * in the target folder (computed by the caller via `freeSiblingPath`), so
 * confirming without editing can never collide or overwrite anything.
 */
export function NameDialog({ title, initialName, confirmLabel, onConfirm, onCancel }: NameDialogProps) {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <input
          ref={inputRef}
          autoFocus
          aria-label={title}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem', fontSize: 14 }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/sidebar/NameDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/NameDialog.tsx src/components/sidebar/NameDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(sidebar): add NameDialog, a shared naming modal

Backs create-mindmap, create-subfolder, and duplicate — all three
pre-fill a name that's already free in the target folder, so
confirming without editing never collides.
EOF
)"
```

---

### Task 4: Rewire `FileTreeRow.tsx` — context menu, double-click rename, duplicate

This is one task, not split by node type: the folder and mind-map branches share the same imports, state, and handlers (`namingAction`, `openDuplicateDialog`, etc.) — splitting them would leave an intermediate commit that doesn't compile.

**Files:**
- Modify: `src/components/sidebar/FileTreeRow.tsx` (full rewrite)
- Modify: `src/components/sidebar/FileTreeRow.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator` from `../ui/context-menu` (Task 2); `NameDialog` from `./NameDialog` (Task 3); `duplicatePath, freeSiblingPath, withJsonExtension` from `../../persistence/fileOps` (Task 1); `mindMapBaseName` added to the existing `../../persistence/paths` import.
- No new exports beyond the existing `FileTreeRow` component.

- [ ] **Step 1: Write the failing test file (full replacement)**

Replace the entire contents of `src/components/sidebar/FileTreeRow.test.tsx` with:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileTreeRow } from './FileTreeRow'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import type { FileTreeNode } from '../../types/workspace'

vi.mock('../../persistence/fileOps', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileOps')>()
  return {
    ...actual,
    createMindMapFile: vi.fn(),
    createSubfolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    duplicatePath: vi.fn(),
    freeSiblingPath: vi.fn(),
  }
})
vi.mock('../../persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})
vi.mock('../../persistence/fileStore', () => ({ loadMindMap: vi.fn(), saveMindMap: vi.fn(), mindMapExists: vi.fn() }))
vi.mock('../../persistence/exportIO', () => ({ pickXmindFile: vi.fn(), readBinaryFile: vi.fn() }))
vi.mock('../../xmind/importXmind', () => ({ readXmindFile: vi.fn() }))

import {
  createMindMapFile,
  createSubfolder,
  renamePath,
  deletePath,
  duplicatePath,
  freeSiblingPath,
} from '../../persistence/fileOps'
import { scanFolder } from '../../persistence/fileTree'
import { loadMindMap, saveMindMap } from '../../persistence/fileStore'
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
    workspaceError: pristine.workspaceError,
  })
}

/** Opens the row's context menu — the only way any action but open/toggle is reachable. */
function openMenu(rowName: string | RegExp) {
  fireEvent.contextMenu(screen.getByRole('button', { name: rowName }))
}

describe('FileTreeRow', () => {
  beforeEach(() => {
    resetWorkspaceStore()
    vi.mocked(createMindMapFile).mockReset()
    vi.mocked(createSubfolder).mockReset()
    vi.mocked(renamePath).mockReset()
    vi.mocked(deletePath).mockReset()
    vi.mocked(duplicatePath).mockReset()
    vi.mocked(scanFolder).mockReset()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(pickXmindFile).mockReset()
    vi.mocked(readBinaryFile).mockReset()
    vi.mocked(readXmindFile).mockReset()
    // The naming modal's pre-filled default always comes from `freeSiblingPath` —
    // most tests care about the name the user actually submits, not this
    // default, so simulate "always free" (no numbered suffix) unless a test
    // overrides it.
    vi.mocked(freeSiblingPath)
      .mockReset()
      .mockImplementation(async (folderPath, baseName, isFolder) => {
        const separator = folderPath.includes('\\') ? '\\' : '/'
        return `${folderPath}${separator}${isFolder ? baseName : `${baseName}.json`}`
      })
  })

  it('renders a mindmap file and opens it on click', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    await user.click(screen.getByText('chapitre1.json'))

    expect(onOpenFile).toHaveBeenCalledWith('/cours/chapitre1.json')
  })

  it('highlights the row matching the currently open file', () => {
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.getByRole('button', { name: 'chapitre1.json' })).toHaveStyle({ background: 'var(--muted)' })
  })

  it('renders an "other" file as visually inert and never calls onOpenFile', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    expect(screen.getByText('notes.pdf').closest('[aria-disabled]')).toBeInTheDocument()
    await user.click(screen.getByText('notes.pdf'))
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('toggles a folder open/closed and shows/hides its children', async () => {
    const user = userEvent.setup()
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [{ type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' }],
    }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.queryByText('atomes.json')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chimie/i }))
    expect(screen.getByText('atomes.json')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chimie/i }))
    expect(screen.queryByText('atomes.json')).not.toBeInTheDocument()
  })

  it('renames a mind map file via double-click, with no menu involved', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: 'chapitre1.json' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1-v2.json')
  })

  it('renames a non-root folder via double-click', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: /chimie/i }))
    const input = screen.getByRole('textbox', { name: /renommer chimie/i })
    await user.clear(input)
    await user.type(input, 'chimie-2026{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chimie', '/cours/chimie-2026')
  })

  it('does not offer renaming a root folder, even via double-click', async () => {
    const user = userEvent.setup()
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: /cours-svt/i }))

    expect(screen.queryByRole('textbox', { name: /renommer/i })).not.toBeInTheDocument()
  })

  it('renames a mind map file via the context menu', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1-v2.json')
  })

  it('updates the current file path when renaming the file that is currently open', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1-v2.json'))
  })

  it('rewrites the current file path when renaming a FOLDER that contains the open file', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chimie/atomes.json' })
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chimie/i })
    await user.clear(input)
    await user.type(input, 'chimie-2026{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chimie', '/cours/chimie-2026')
    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chimie-2026/atomes.json'))
  })

  it('leaves the current file alone when renaming a folder that merely shares a name prefix', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chimie-avancee/atomes.json' })
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chimie/i })
    await user.clear(input)
    await user.type(input, 'chimie-2026{Enter}')

    await waitFor(() => expect(renamePath).toHaveBeenCalled())
    expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chimie-avancee/atomes.json')
  })

  it('reports a failed rename instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockRejectedValue(new Error('fichier verrouillé'))
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/fichier verrouillé/))
    expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1.json')
  })

  it('shows a "retirer de la liste" action in the context menu of a root folder, and calls onRemoveRoot with its path', async () => {
    const user = userEvent.setup()
    const onRemoveRoot = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={onRemoveRoot} />)

    openMenu(/cours-svt/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Retirer cours-svt de la liste' }))

    expect(onRemoveRoot).toHaveBeenCalledWith('/cours-svt')
  })

  it('does not show "retirer", "renommer", "supprimer" or "dupliquer" on a root folder, only creation actions', async () => {
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)

    openMenu(/cours-svt/i)

    expect(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Nouveau sous-dossier' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Importer XMind' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Retirer cours-svt de la liste' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Renommer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Supprimer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Dupliquer' })).not.toBeInTheDocument()
  })

  it('does not show "retirer" on a non-root folder, but does show renommer/supprimer/dupliquer', async () => {
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours-svt/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)

    expect(await screen.findByRole('menuitem', { name: 'Renommer' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Supprimer' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Dupliquer' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /retirer/i })).not.toBeInTheDocument()
  })

  it('creates a new mind map file inside a folder and opens it', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockResolvedValue('/cours/chimie/nouveau.json')
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'nouveau.json', path: '/cours/chimie/nouveau.json' },
    ])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))
    const input = await screen.findByRole('textbox', { name: 'Nouvelle carte mentale' })
    await user.clear(input)
    await user.type(input, 'nouveau{Enter}')

    expect(createMindMapFile).toHaveBeenCalledWith('/cours/chimie', 'nouveau')
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('/cours/chimie/nouveau.json'))
  })

  it('pre-fills the new-mind-map dialog with a name already free in the folder', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chimie/Nouvelle carte mentale (2).json')
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))

    expect(freeSiblingPath).toHaveBeenCalledWith('/cours/chimie', 'Nouvelle carte mentale', false)
    expect(await screen.findByRole('textbox', { name: 'Nouvelle carte mentale (2)' })).toHaveValue(
      'Nouvelle carte mentale (2)'
    )
  })

  it('creates a new subfolder', async () => {
    const user = userEvent.setup()
    vi.mocked(createSubfolder).mockResolvedValue('/cours/chimie/atomes')
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouveau sous-dossier' }))
    const input = await screen.findByRole('textbox', { name: 'Nouveau dossier' })
    await user.clear(input)
    await user.type(input, 'atomes{Enter}')

    expect(createSubfolder).toHaveBeenCalledWith('/cours/chimie', 'atomes')
  })

  it('reports a failed creation instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockRejectedValue(new Error('lecture seule'))
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))
    const input = await screen.findByRole('textbox', { name: 'Nouvelle carte mentale' })
    await user.type(input, '{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/lecture seule/))
  })

  it('duplicates a mind map file and opens the copy', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chapitre1 (copie).json')
    vi.mocked(duplicatePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))

    expect(freeSiblingPath).toHaveBeenCalledWith('/cours', 'chapitre1 (copie)', false)
    const input = await screen.findByRole('textbox', { name: /dupliquer/i })
    await user.type(input, '{Enter}')

    expect(duplicatePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1 (copie).json', false)
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('/cours/chapitre1 (copie).json'))
  })

  it('duplicates a folder without opening anything', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chimie (copie)')
    vi.mocked(duplicatePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))
    expect(freeSiblingPath).toHaveBeenCalledWith('/cours', 'chimie (copie)', true)
    const input = await screen.findByRole('textbox', { name: /dupliquer/i })
    await user.type(input, '{Enter}')

    expect(duplicatePath).toHaveBeenCalledWith('/cours/chimie', '/cours/chimie (copie)', true)
    await waitFor(() => expect(scanFolder).toHaveBeenCalledWith('/cours'))
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('reports a failed duplication instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chapitre1 (copie).json')
    vi.mocked(duplicatePath).mockRejectedValue(new Error('disque plein'))
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))
    const input = await screen.findByRole('textbox', { name: /dupliquer/i })
    await user.type(input, '{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/disque plein/))
  })

  it('reports a failed deletion instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockRejectedValue(new Error('fichier verrouillé'))
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/fichier verrouillé/))
    expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1.json')
  })

  it('deletes a mind map file after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
    expect(screen.getByRole('heading', { name: /supprimer le fichier « chapitre1.json » ?/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chapitre1.json', false)
  })

  it('clears the current file when deleting the file that is currently open', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBeNull())
  })

  it('deletes a folder and its contents after confirmation, showing the descendant count', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
        { type: 'mindmap', name: 'liaisons.json', path: '/cours/chimie/liaisons.json' },
      ],
    }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
    expect(
      screen.getByRole('heading', { name: /supprimer le dossier « chimie » et son contenu \(2 éléments\)/i })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chimie', true)
  })

  it('opens the export dialog with the file\'s cards once they are loaded and validated', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Exporter' }))

    expect(await screen.findByText('Exporter « chapitre1 »')).toBeInTheDocument()
  })

  it('reports an error instead of opening the dialog when the file no longer exists', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue(null)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Exporter' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/n’existe plus/))
    expect(screen.queryByText(/^Exporter «/)).not.toBeInTheDocument()
  })

  it('reports an error instead of opening the dialog when the file fails validation', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue([
      { id: 'a', level: 1, title: 'A', parentId: null, order: 0 },
      { id: 'b', level: 1, title: 'B', parentId: null, order: 0 },
    ])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Exporter' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/structure du fichier est invalide/))
  })

  it('imports every sheet of a picked XMind file as its own .json in the folder, then refreshes it', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue('/downloads/vieux-cours.xmind')
    vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
    vi.mocked(readXmindFile).mockResolvedValue([
      { sheetTitle: 'Chapitre 1', cards: [{ id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 }] },
      { sheetTitle: 'Chapitre 2', cards: [{ id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 }] },
    ])
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    await waitFor(() => expect(saveMindMap).toHaveBeenCalledTimes(2))
    expect(saveMindMap).toHaveBeenCalledWith('/cours/Chapitre 1.json', [
      { id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 },
    ])
    expect(saveMindMap).toHaveBeenCalledWith('/cours/Chapitre 2.json', [
      { id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 },
    ])
    expect(scanFolder).toHaveBeenCalledWith('/cours')
  })

  it('does nothing when the XMind file picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue(null)
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('reports an XMind import failure through the workspace error channel', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue('/downloads/corrompu.xmind')
    vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
    vi.mocked(readXmindFile).mockRejectedValue(new Error('archive corrompue'))
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/corrompu\.xmind.*archive corrompue/))
  })

  it('reports how many sheets were written before a mid-import failure, and still refreshes the folder', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue('/downloads/cours.xmind')
    vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
    vi.mocked(readXmindFile).mockResolvedValue([
      { sheetTitle: 'Chapitre 1', cards: [{ id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 }] },
      { sheetTitle: 'Chapitre 2', cards: [{ id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 }] },
    ])
    vi.mocked(saveMindMap).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disque plein'))
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/1 carte.*mentale.*déjà importée/))
    expect(scanFolder).toHaveBeenCalledWith('/cours')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — no context menu / menuitem roles exist yet, buttons like "Renommer"/"Dupliquer" don't exist.

- [ ] **Step 3: Rewrite the component (full replacement)**

Replace the entire contents of `src/components/sidebar/FileTreeRow.tsx` with:

```tsx
// src/components/sidebar/FileTreeRow.tsx
import { useState } from 'react'
import { Folder, FolderOpen, FolderPlus, FileJson, FilePlus, File, ChevronRight, ChevronDown, Pencil, Trash2, X, Download, FileUp, Copy } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import type { Card } from '../../types/card'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import {
  createMindMapFile,
  createSubfolder,
  renamePath,
  deletePath,
  duplicatePath,
  freeMindMapPath,
  freeSiblingPath,
  withJsonExtension,
} from '../../persistence/fileOps'
import { countDescendants } from '../../persistence/fileTree'
import { parentDirOf, separatorOf, fileNameOf, mindMapBaseName } from '../../persistence/paths'
import { loadMindMap, saveMindMap } from '../../persistence/fileStore'
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { validateCards } from '../../validation/cardsValidation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { ExportDialog } from './ExportDialog'
import { NameDialog } from './NameDialog'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
  isRoot?: boolean
  onRemoveRoot?: (path: string) => void
}

interface NamingAction {
  title: string
  initialName: string
  confirmLabel: string
  onConfirm: (name: string) => void
}

function ConfirmDeleteDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FileTreeRow({ node, depth, onOpenFile, isRoot = false, onRemoveRoot }: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)

  const [renaming, setRenaming] = useState(false)
  const [draftRenameName, setDraftRenameName] = useState(node.name)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [exportCards, setExportCards] = useState<Card[] | null>(null)
  const [namingAction, setNamingAction] = useState<NamingAction | null>(null)

  const indent = { paddingLeft: 8 + depth * 16 }

  async function submitRename() {
    const name = draftRenameName.trim()
    setRenaming(false)
    if (!name || name === node.name) return
    const parentPath = parentDirOf(node.path)
    const separator = separatorOf(node.path)
    const newPath = `${parentPath}${separator}${name}`
    try {
      await renamePath(node.path, newPath)
    } catch (error) {
      setWorkspaceError(`Impossible de renommer « ${node.name} » en « ${name} » : ${describeError(error)}`)
      return
    }
    // Same containment check `confirmDelete` uses: renaming a FOLDER moves
    // every file under it too, so the open file's path has to follow.
    if (node.path === currentFilePath) setCurrentFile(newPath)
    else if (currentFilePath?.startsWith(node.path + separator)) {
      setCurrentFile(newPath + currentFilePath.slice(node.path.length))
    }
    await refreshFolder(parentPath)
  }

  async function confirmDelete() {
    setConfirmDeleteOpen(false)
    const parentPath = parentDirOf(node.path)
    const separator = separatorOf(node.path)
    try {
      await deletePath(node.path, node.type === 'folder')
    } catch (error) {
      setWorkspaceError(`Impossible de supprimer « ${node.name} » : ${describeError(error)}`)
      return
    }
    if (currentFilePath === node.path || currentFilePath?.startsWith(node.path + separator)) setCurrentFile(null)
    await refreshFolder(parentPath)
  }

  async function handleImportXmind() {
    let path: string | null = null
    let sheetsWritten = 0
    try {
      path = await pickXmindFile()
      if (!path) return
      const bytes = await readBinaryFile(path)
      const sheets = await readXmindFile(bytes)
      for (const sheet of sheets) {
        const target = await freeMindMapPath(node.path, sheet.sheetTitle)
        await saveMindMap(target, sheet.cards)
        sheetsWritten += 1
      }
      await refreshFolder(node.path)
    } catch (error) {
      if (sheetsWritten > 0) await refreshFolder(node.path)
      const partial = sheetsWritten > 0 ? ` (${sheetsWritten} carte(s) mentale(s) déjà importée(s) avant l’échec)` : ''
      setWorkspaceError(`Impossible d’importer « ${path ? fileNameOf(path) : 'le fichier XMind'} » : ${describeError(error)}${partial}`)
    }
  }

  async function openExport() {
    let raw: Card[] | null
    try {
      raw = await loadMindMap(node.path)
    } catch (error) {
      setWorkspaceError(`Impossible d’exporter « ${node.name} » : ${describeError(error)}`)
      return
    }
    if (raw === null) {
      setWorkspaceError(`Impossible d’exporter « ${node.name} » : ce fichier n’existe plus.`)
      return
    }
    if (!validateCards(raw).valid) {
      setWorkspaceError(`Impossible d’exporter « ${node.name} » : la structure du fichier est invalide.`)
      return
    }
    setExportCards(raw)
  }

  async function openCreateMindMapDialog() {
    const fullPath = await freeSiblingPath(node.path, 'Nouvelle carte mentale', false)
    setNamingAction({
      title: 'Nouvelle carte mentale',
      initialName: mindMapBaseName(fileNameOf(fullPath)),
      confirmLabel: 'Créer',
      onConfirm: submitCreateMindMap,
    })
  }

  async function submitCreateMindMap(name: string) {
    setNamingAction(null)
    try {
      const path = await createMindMapFile(node.path, name)
      await refreshFolder(node.path)
      onOpenFile(path)
    } catch (error) {
      setWorkspaceError(`Impossible de créer la carte mentale « ${name} » : ${describeError(error)}`)
    }
  }

  async function openCreateFolderDialog() {
    const fullPath = await freeSiblingPath(node.path, 'Nouveau dossier', true)
    setNamingAction({
      title: 'Nouveau sous-dossier',
      initialName: fileNameOf(fullPath),
      confirmLabel: 'Créer',
      onConfirm: submitCreateFolder,
    })
  }

  async function submitCreateFolder(name: string) {
    setNamingAction(null)
    try {
      await createSubfolder(node.path, name)
      await refreshFolder(node.path)
    } catch (error) {
      setWorkspaceError(`Impossible de créer le dossier « ${name} » : ${describeError(error)}`)
    }
  }

  async function openDuplicateDialog() {
    const parentPath = parentDirOf(node.path)
    const isFolder = node.type === 'folder'
    const currentBaseName = isFolder ? node.name : mindMapBaseName(node.name)
    const fullPath = await freeSiblingPath(parentPath, `${currentBaseName} (copie)`, isFolder)
    setNamingAction({
      title: `Dupliquer « ${node.name} »`,
      initialName: isFolder ? fileNameOf(fullPath) : mindMapBaseName(fileNameOf(fullPath)),
      confirmLabel: 'Dupliquer',
      onConfirm: submitDuplicate,
    })
  }

  async function submitDuplicate(name: string) {
    setNamingAction(null)
    const parentPath = parentDirOf(node.path)
    const separator = separatorOf(node.path)
    const isFolder = node.type === 'folder'
    const destPath = `${parentPath}${separator}${isFolder ? name : withJsonExtension(name)}`
    try {
      await duplicatePath(node.path, destPath, isFolder)
      await refreshFolder(parentPath)
      if (!isFolder) onOpenFile(destPath)
    } catch (error) {
      setWorkspaceError(`Impossible de dupliquer « ${node.name} » : ${describeError(error)}`)
    }
  }

  if (node.type === 'folder') {
    const isExpanded = expandedPaths.has(node.path)
    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {renaming ? (
                <input
                  autoFocus
                  aria-label={`Renommer ${node.name}`}
                  value={draftRenameName}
                  onChange={e => setDraftRenameName(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setDraftRenameName(node.name)
                      setRenaming(false)
                    }
                  }}
                  style={{ ...indent, display: 'block', flex: 1 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleExpanded(node.path)}
                  onDoubleClick={() => {
                    if (!isRoot) setRenaming(true)
                  }}
                  aria-expanded={isExpanded}
                  style={{
                    ...indent,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                  <span>{node.name}</span>
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={openCreateMindMapDialog}>
              <FilePlus size={14} /> Nouvelle carte mentale
            </ContextMenuItem>
            <ContextMenuItem onSelect={openCreateFolderDialog}>
              <FolderPlus size={14} /> Nouveau sous-dossier
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleImportXmind}>
              <FileUp size={14} /> Importer XMind
            </ContextMenuItem>
            {!isRoot && (
              <ContextMenuItem onSelect={openDuplicateDialog}>
                <Copy size={14} /> Dupliquer
              </ContextMenuItem>
            )}
            {!isRoot && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => setRenaming(true)}>
                  <Pencil size={14} /> Renommer
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onSelect={() => setConfirmDeleteOpen(true)}>
                  <Trash2 size={14} /> Supprimer
                </ContextMenuItem>
              </>
            )}
            {isRoot && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onRemoveRoot?.(node.path)}>
                  <X size={14} /> Retirer {node.name} de la liste
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {confirmDeleteOpen && (
          <ConfirmDeleteDialog
            title={`Supprimer le dossier « ${node.name} » et son contenu (${countDescendants(node)} éléments) ?`}
            onCancel={() => setConfirmDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        )}

        {namingAction && (
          <NameDialog
            title={namingAction.title}
            initialName={namingAction.initialName}
            confirmLabel={namingAction.confirmLabel}
            onConfirm={namingAction.onConfirm}
            onCancel={() => setNamingAction(null)}
          />
        )}

        {isExpanded &&
          node.children.map(child => <FileTreeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    )
  }

  if (node.type === 'mindmap') {
    const isActive = node.path === currentFilePath
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              {renaming ? (
                <input
                  autoFocus
                  aria-label={`Renommer ${node.name}`}
                  value={draftRenameName}
                  onChange={e => setDraftRenameName(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setDraftRenameName(node.name)
                      setRenaming(false)
                    }
                  }}
                  style={{ ...indent, display: 'block', flex: 1 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenFile(node.path)}
                  onDoubleClick={() => setRenaming(true)}
                  style={{
                    ...indent,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    background: isActive ? 'var(--muted)' : 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <FileJson size={16} />
                  <span>{node.name}</span>
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={openDuplicateDialog}>
              <Copy size={14} /> Dupliquer
            </ContextMenuItem>
            <ContextMenuItem onSelect={openExport}>
              <Download size={14} /> Exporter
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setRenaming(true)}>
              <Pencil size={14} /> Renommer
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => setConfirmDeleteOpen(true)}>
              <Trash2 size={14} /> Supprimer
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {confirmDeleteOpen && (
          <ConfirmDeleteDialog
            title={`Supprimer le fichier « ${node.name} » ?`}
            onCancel={() => setConfirmDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        )}

        {namingAction && (
          <NameDialog
            title={namingAction.title}
            initialName={namingAction.initialName}
            confirmLabel={namingAction.confirmLabel}
            onConfirm={namingAction.onConfirm}
            onCancel={() => setNamingAction(null)}
          />
        )}

        {exportCards && (
          <ExportDialog
            fileName={node.name}
            filePath={node.path}
            cards={exportCards}
            open
            onClose={() => setExportCards(null)}
            onError={setWorkspaceError}
          />
        )}
      </div>
    )
  }

  return (
    <div aria-disabled style={{ ...indent, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-foreground)' }}>
      <File size={16} />
      <span>{node.name}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS, all tests.

Also run the sidebar's other test file, since it renders `FileTreeRow` indirectly through `FileSidebar`:

Run: `npx vitest run src/components/sidebar/FileSidebar.test.tsx`
Expected: PASS unchanged (it doesn't assert on row action buttons — verify this holds; if any assertion there does target a removed button, adapt it the same way as above).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "$(cat <<'EOF'
feat(sidebar): replace row action buttons with a context menu

Rename now triggers on double-click or via the menu; export/delete/
create-mindmap/create-subfolder/import-xmind/duplicate all move into
a right-click menu (radix ContextMenu), organized per node type (root
folder / subfolder / mind map). Create and duplicate go through the
new NameDialog, always pre-filled with a name already free on disk.
EOF
)"
```

---

### Task 5: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all test files (including `CardNode.test.tsx` from sub-project D, unaffected by this branch's changes).

- [ ] **Step 2: Type-check the whole project**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Spec-coverage self-check**

Re-read `docs/superpowers/specs/2026-09-08-sidebar-menu-contextuel-design.md` section by section and confirm each requirement has a corresponding implemented behavior:
- Menus per node type (root/subfolder/mind map) — Task 4.
- Double-click rename, no debounce — Task 4.
- `NameDialog` shared by create/duplicate, always-free default — Tasks 3-4.
- `duplicatePath`/`freeSiblingPath` — Task 1.
- Error handling via `setWorkspaceError` with a generic cause message — Task 1 (implementation) + Task 4 (wiring), covered by the "reports a failed duplication" test in Task 4. The spec deliberately does NOT track partial-copy progress for an interrupted folder duplication (unlike the XMind import): confirm the design doc's rationale for that (a duplicate that fails partway is always resolved the same way — delete the incomplete copy and retry — so a per-file progress count adds no decision-relevant information) still reads as correct; it is not a gap to fill.

- [ ] **Step 4: Manual sanity read-through**

Read the final `src/components/sidebar/FileTreeRow.tsx` once more end to end (not per-task diffs) specifically hunting for cross-task issues the project has been bitten by before: unused imports, a handler defined but never wired to a menu item, a menu item wired to the wrong handler (e.g. mindmap's "Dupliquer" accidentally calling `openCreateMindMapDialog`), and the `isRoot` conditionals gating the right items.

- [ ] **Step 5: Report**

No commit for this task (verification only) unless Step 3 produced a new test, in which case commit it separately with its own message. Summarize to the user: sub-project A complete, ready to move to sub-project B (format icons + cache) per the roadmap in the design doc.
