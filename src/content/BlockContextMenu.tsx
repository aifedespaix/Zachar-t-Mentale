import type { ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CopyPlus,
  MessageCircleQuestion,
  Sigma,
  Table2,
  Trash2,
  Type,
} from 'lucide-react'
import type { CardBlockKind } from '../types/cardBlock'
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
import { MenuShortcut } from './descriptionMenuKit'

export interface BlockContextMenuProps {
  index: number
  kind: CardBlockKind
  /** How many blocks the description has — the last one can never be deleted (mirrors the gutter's own trash icon). */
  blockCount: number
  /**
   * Les deux directions qui aboutissent VRAIMENT pour ce bloc, calculées par
   * l'appelant (voir « blockMove »). Un bloc au premier rang d'une question ne
   * peut pas remonter au-dessus de son en-tête, et l'en-tête lui-même ne peut
   * pas se faufiler dans sa propre question : « index === 0 » ne suffit donc
   * plus à savoir si « Monter » a un sens.
   */
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (from: number, to: number) => void
  onDuplicate: () => void
  onDelete: () => void
  /** `table`/`text`/`math` from the submenu, or `question` from the standalone entry below it — the same path `BlockKindMenu` already uses. */
  onChangeKind: (kind: CardBlockKind) => void
  children: ReactNode
}

/**
 * The right-click menu of a single block — as opposed to `FieldContextMenu`
 * (the text/formula zone inside it) and `EmptyAreaContextMenu` (the blank
 * space around every block).
 *
 * Its trigger stops the event from bubbling to the empty-area menu wrapping
 * the whole list, the same nesting trick `CardContextMenu` already uses for
 * the canvas's own pane menu underneath every card.
 *
 * « Marquer comme question » is deliberately NOT inside « Changer de type » :
 * the request was for it to stand apart and read as the one that puts the
 * block forward, so it keeps its own row, in blue, below the submenu instead
 * of being a fourth entry indistinguishable from the other three.
 */
export function BlockContextMenu({
  index,
  kind,
  blockCount,
  canMoveUp,
  canMoveDown,
  onMove,
  onDuplicate,
  onDelete,
  onChangeKind,
  children,
}: BlockContextMenuProps) {
  const isQuestion = kind === 'question'
  const canChangeKind = kind !== 'image'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={event => event.stopPropagation()}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!canMoveUp} onSelect={() => onMove(index, index - 1)}>
          <ArrowUp size={14} />
          <span style={{ flex: 1 }}>Monter le bloc</span>
          <MenuShortcut keys="Alt + ↑" />
        </ContextMenuItem>
        <ContextMenuItem disabled={!canMoveDown} onSelect={() => onMove(index, index + 1)}>
          <ArrowDown size={14} />
          <span style={{ flex: 1 }}>Descendre le bloc</span>
          <MenuShortcut keys="Alt + ↓" />
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>
          <CopyPlus size={14} />
          <span style={{ flex: 1 }}>Dupliquer le bloc</span>
          <MenuShortcut keys="Alt + D" />
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canChangeKind}>
            {kind === 'math' ? <Sigma size={14} /> : kind === 'table' ? <Table2 size={14} /> : <Type size={14} />}
            Changer de type
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onChangeKind('text')}>
              <Type size={14} />
              <span style={{ flex: 1 }}>Texte</span>
              {kind === 'text' && <Check size={13} />}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onChangeKind('math')}>
              <Sigma size={14} />
              <span style={{ flex: 1 }}>Formule</span>
              {kind === 'math' && <Check size={13} />}
            </ContextMenuItem>
            <ContextMenuItem disabled={kind === 'table'} onSelect={() => onChangeKind('table')}>
              <Table2 size={14} />
              <span style={{ flex: 1 }}>Tableau</span>
              {kind === 'table' && <Check size={13} />}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* À part et en bleu : c'est la mise en avant demandée, pas une
            quatrième entrée du sous-menu ci-dessus. */}
        {canChangeKind && (
          <ContextMenuItem
            onSelect={() => onChangeKind('question')}
            style={{ color: 'var(--info-fg)', fontWeight: 600 }}
          >
            <MessageCircleQuestion size={14} />
            <span style={{ flex: 1 }}>Marquer comme question</span>
            {isQuestion ? <Check size={13} /> : <MenuShortcut keys="Alt + Q" />}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" disabled={blockCount <= 1} onSelect={onDelete}>
          <Trash2 size={14} />
          <span style={{ flex: 1 }}>Supprimer le bloc</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
