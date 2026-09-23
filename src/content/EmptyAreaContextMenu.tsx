import type { ReactNode } from 'react'
import {
  Check,
  Keyboard,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Plus,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type { BandTabId } from '../types/symbolBand'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../components/ui/context-menu'
import { LanguageFlag } from './LanguageHelpPalette'
import { SYMBOL_TABS } from './symbolTabs'
import { MenuShortcut } from './descriptionMenuKit'

export interface EmptyAreaMenuActions {
  onAddBlock: () => void
  bandTab: BandTabId | null
  onChooseTab: (tab: BandTabId | null) => void
  onOpenBandOptions: () => void
  narrow: boolean
  onToggleNarrow: () => void
  shortcutsOpen: boolean
  onToggleShortcuts: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onDeleteDescription: () => void
  onClose: () => void
}

/**
 * The right-click menu of the empty space around the blocks — everything a
 * description-wide gesture, none of it about any one block.
 *
 * Grouped by what the gesture touches, in the order a hand reaches for them
 * most: writing (add a block, switch which symbols the band offers), display
 * (families, width, shortcuts), history, then the two ways to leave. A menu
 * that read top to bottom as "everything the footer already offers, in the
 * order the footer draws it" would have buried « Ajouter un bloc » — the one
 * entry that is not already a button in reach — under six others.
 */
export function EmptyAreaContextMenu({
  actions,
  children,
}: {
  /** `undefined` when the host gave this editor nowhere to route the dialog-scoped actions — every current test harness. The menu is skipped entirely rather than shown with half its rows silently doing nothing. */
  actions?: EmptyAreaMenuActions
  children: ReactNode
}) {
  if (actions === undefined) return <>{children}</>

  const {
    onAddBlock,
    bandTab,
    onChooseTab,
    onOpenBandOptions,
    narrow,
    onToggleNarrow,
    shortcutsOpen,
    onToggleShortcuts,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onDeleteDescription,
    onClose,
  } = actions

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onAddBlock}>
          <Plus size={14} />
          <span style={{ flex: 1 }}>Ajouter un bloc</span>
          <MenuShortcut keys="Ctrl + Entrée" />
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <SlidersHorizontal size={14} />
            Changer de mode
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {SYMBOL_TABS.map((tab, position) => {
              const Icon = tab.icon
              const flag = tab.id === 'en' || tab.id === 'es' || tab.id === 'fr' ? tab.id : null
              const active = tab.id === bandTab
              return (
                <ContextMenuItem key={tab.id} onSelect={() => onChooseTab(tab.id)}>
                  {flag !== null ? <LanguageFlag id={flag} /> : Icon !== null && <Icon size={14} />}
                  <span style={{ flex: 1 }}>{tab.label}</span>
                  {active ? <Check size={13} /> : <MenuShortcut keys={`Alt + ${position + 1}`} />}
                </ContextMenuItem>
              )
            })}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onChooseTab(null)}>
              <X size={14} />
              <span style={{ flex: 1 }}>Masquer le bandeau</span>
              {bandTab === null ? <Check size={13} /> : <MenuShortcut keys="Alt + 0" />}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={onOpenBandOptions}>
          <LayoutGrid size={14} />
          <span style={{ flex: 1 }}>Familles de symboles affichées</span>
          <MenuShortcut keys="Ctrl + Maj + F" />
        </ContextMenuItem>
        <ContextMenuItem onSelect={onToggleNarrow}>
          {narrow ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          <span style={{ flex: 1 }}>{narrow ? 'Élargir la modale' : 'Rétrécir la modale'}</span>
          <MenuShortcut keys="Ctrl + M" />
        </ContextMenuItem>
        <ContextMenuItem onSelect={onToggleShortcuts}>
          <Keyboard size={14} />
          <span style={{ flex: 1 }}>Afficher les raccourcis</span>
          {shortcutsOpen ? <Check size={13} /> : <MenuShortcut keys="Ctrl + /" />}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem disabled={!canUndo} onSelect={onUndo}>
          <Undo2 size={14} />
          <span style={{ flex: 1 }}>Annuler</span>
          <MenuShortcut keys="Ctrl + Z" />
        </ContextMenuItem>
        <ContextMenuItem disabled={!canRedo} onSelect={onRedo}>
          <Redo2 size={14} />
          <span style={{ flex: 1 }}>Rétablir</span>
          <MenuShortcut keys="Ctrl + Maj + Z" />
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Sans raccourci, comme le bouton du pied qui pose la même
            confirmation : une suppression totale n'est jamais à une seule
            frappe malencontreuse de distance (voir `file.delete` dans
            `types/commands.ts`, qui suit la même règle). */}
        <ContextMenuItem variant="destructive" onSelect={onDeleteDescription}>
          <Trash2 size={14} />
          <span style={{ flex: 1 }}>Supprimer la description</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onClose}>
          <X size={14} />
          <span style={{ flex: 1 }}>Fermer</span>
          <MenuShortcut keys="Échap" />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
