import type { ReactNode } from 'react'
import { useStoreApi } from '@xyflow/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  ClipboardList,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileText,
  Move,
  PenLine,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Unlink,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../ui/context-menu'
import { CommandMenuItem } from './CommandMenuItem'
import { useCardSelectionStore } from '../../state/useCardSelectionStore'

interface CardContextMenuProps {
  cardId: string
  /** No card menu during a quiz — every action in it is refused anyway. */
  disabled?: boolean
  children: ReactNode
}

/**
 * The right-click menu of a single card.
 *
 * Every entry is a command, so this menu, the card's own buttons and the
 * keyboard cannot drift apart: one place decides what « supprimer » means, one
 * place decides whether it is available, and each entry prints the shortcut
 * that does the same thing — which is how a menu teaches its own shortcuts.
 *
 * Right-clicking SELECTS the card first. The commands act on the selection, so
 * without that the menu would silently operate on whatever card was selected
 * before — the one bug that would make the whole menu untrustworthy.
 */
export function CardContextMenu({ cardId, disabled = false, children }: CardContextMenuProps) {
  const storeApi = useStoreApi()

  return (
    <ContextMenu>
      {/* `disabled` on the trigger itself (Radix's own prop), never a
          conditional Fragment/ContextMenu swap around `children`: swapping
          the wrapper's element type forced React to unmount and remount
          everything inside it — including the title textarea — every time a
          quiz started or the map got locked, silently discarding its
          measured height (see CardNode's title auto-resize effect). */}
      <ContextMenuTrigger
        asChild
        disabled={disabled}
        onContextMenu={
          disabled
            ? undefined
            : event => {
                // Stops the canvas's own menu (whose trigger wraps the whole pane)
                // from opening on top of this one.
                event.stopPropagation()
                // Through React Flow, so the outline moves to this card too — the
                // mirror alone would leave the menu acting on one card while another
                // still looks selected.
                storeApi.getState().addSelectedNodes([cardId])
                useCardSelectionStore.getState().select(cardId)
              }
        }
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <CommandMenuItem command="edit.rename" icon={PenLine} label="Renommer" />
        <CommandMenuItem command="card.addChild" icon={ArrowRight} label="Ajouter une sous-carte" />
        <CommandMenuItem command="card.addSiblingAbove" icon={Plus} label="Ajouter au-dessus" />
        <CommandMenuItem command="card.addSiblingBelow" icon={Plus} label="Ajouter en dessous" />
        <ContextMenuSeparator />

        <CommandMenuItem command="card.openFiche" icon={BookOpen} label="Ouvrir la fiche" />
        <CommandMenuItem command="card.editDescription" icon={FileText} label="Modifier la description" />
        <CommandMenuItem command="card.pickIcon" icon={Sparkles} label="Choisir une icône" />
        <ContextMenuSeparator />

        <CommandMenuItem command="edit.copy" icon={Copy} label="Copier" />
        <CommandMenuItem command="edit.cut" icon={Scissors} label="Couper" />
        <CommandMenuItem command="edit.paste" icon={ClipboardPaste} label="Coller ici" />
        <CommandMenuItem command="edit.duplicateCard" icon={CopyPlus} label="Dupliquer" />
        <CommandMenuItem command="edit.copyBranchText" icon={ClipboardList} label="Copier en texte" />
        <ContextMenuSeparator />

        {/* Four reordering actions in a submenu rather than the main list: they
            are used together, and inline they would push « Supprimer » far
            enough down the menu to need a second look every time. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Move size={14} /> Déplacer
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <CommandMenuItem command="card.moveUp" icon={ArrowUp} label="Vers le haut" />
            <CommandMenuItem command="card.moveDown" icon={ArrowDown} label="Vers le bas" />
            <CommandMenuItem command="card.promote" icon={ArrowLeft} label="Remonter d’un niveau" />
            <CommandMenuItem command="card.demote" icon={ArrowRight} label="Descendre d’un niveau" />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <CommandMenuItem command="card.detach" icon={Unlink} label="Détacher" />
        <CommandMenuItem command="edit.delete" icon={Trash2} label="Supprimer" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
