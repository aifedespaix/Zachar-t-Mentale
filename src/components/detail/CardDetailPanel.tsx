import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ChevronDown, ChevronRight, Eraser, Layers, Pencil, Pin, PinOff, Plus, Trash2, X } from 'lucide-react'
import type { Card } from '../../types/card'
import { useCardsStore, selectEditsBlocked } from '../../state/useCardsStore'
import { useCardDetailStore } from '../../state/useCardDetailStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { ancestorTitles } from '../../state/cardsReducer'
import { clampCardLevel, detachedColors } from '../../colors/levelColors'
import { toCss } from '../../colors/contrast'
import { contentOf } from '../../content/blocks'
import { BlockView } from '../../content/BlockView'
import { ContentKindBadges } from '../../content/ContentKindBadges'
import { DescriptionDialog } from '../../content/DescriptionDialog'
import { imageBlockFrom } from '../../content/imageBlock'
import { pickImageFile } from '../../content/pickImage'
import { assetSrc } from '../../persistence/assets'
import {
  clampCardDetailWidth,
  loadCardDetailWidth,
  saveCardDetailWidth,
  MAX_CARD_DETAIL_WIDTH,
  MIN_CARD_DETAIL_WIDTH,
} from '../../persistence/cardDetailWidth'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../ui/context-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

/** How far one arrow-key press moves the border, matching the file sidebar. */
const KEYBOARD_RESIZE_STEP = 16

/**
 * The fiche of a card: its title, where it sits in the tree, and its
 * description in full.
 *
 * It replaces the popover as the place a definition is READ. The popover's
 * fixed 340 × 420 box was chosen so that opening one never moved the card or
 * the box itself, and it is still the right shape for a glance — but a
 * definition that mixes a rule, a stacked formula and a diagram is not a
 * glance. Here the content gets a column of its own, and the card on the
 * canvas goes back to being what it is: a title and a place in the tree.
 *
 * Several fiches can be open at once, which is the point: comparing two or
 * three cards is how a revision actually goes. Only one of them is a PREVIEW
 * (replaced by the next card opened); the others were pinned deliberately.
 */
/**
 * The two panel-wide commands — mode pile and « vider la liste ».
 *
 * Rendered in the panel's own context menu AND in each fiche's, because a
 * right-click on a fiche is still a right-click in the panel: the fiche's menu
 * adds its card-specific actions on top, it does not replace these.
 */
function PanelMenuCommands() {
  const stackMode = useCardDetailStore(s => s.stackMode)
  const toggleStackMode = useCardDetailStore(s => s.toggleStackMode)
  const clearUnpinned = useCardDetailStore(s => s.clearUnpinned)
  return (
    <>
      <ContextMenuItem onSelect={toggleStackMode}>
        <Layers size={14} /> {stackMode ? 'Désactiver le mode pile' : 'Activer le mode pile'}
      </ContextMenuItem>
      <ContextMenuItem onSelect={clearUnpinned}>
        <Eraser size={14} /> Vider la liste
      </ContextMenuItem>
    </>
  )
}

export function CardDetailPanel() {
  const openEntries = useCardDetailStore(s => s.open)
  const editingCardId = useCardDetailStore(s => s.editingCardId)
  const stackMode = useCardDetailStore(s => s.stackMode)
  const pin = useCardDetailStore(s => s.pin)
  const unpin = useCardDetailStore(s => s.unpin)
  const close = useCardDetailStore(s => s.close)
  const toggleCollapsed = useCardDetailStore(s => s.toggleCollapsed)
  const setEditing = useCardDetailStore(s => s.setEditing)
  const toggleStackMode = useCardDetailStore(s => s.toggleStackMode)
  const clearUnpinned = useCardDetailStore(s => s.clearUnpinned)
  const cards = useCardsStore(s => s.history.present)

  const [width, setWidth] = useState(loadCardDetailWidth)
  const [resizing, setResizing] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  // Same rationale as the file sidebar's: writing on every pointer move would
  // hammer `localStorage` a hundred times a drag for a value only the next
  // launch reads.
  const commitWidth = useCallback((next: number) => {
    const clamped = clampCardDetailWidth(next)
    setWidth(clamped)
    saveCardDetailWidth(clamped)
  }, [])

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    // Called optionally: jsdom has no pointer-capture API, and the drag works
    // without it (only the "cursor outruns the border" case degrades).
    handleRef.current?.setPointerCapture?.(event.pointerId)
    setResizing(true)
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizing) return
    // Measured from the panel's RIGHT edge, mirrored from the file sidebar's
    // left-edge measurement: this panel grows leftwards, so the width is the
    // distance from the pointer to that edge.
    const right = handleRef.current?.parentElement?.getBoundingClientRect().right ?? 0
    setWidth(clampCardDetailWidth(right - event.clientX))
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizing) return
    handleRef.current?.releasePointerCapture?.(event.pointerId)
    setResizing(false)
    saveCardDetailWidth(width)
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Left widens: the panel's border is on its left, so the directions are
    // the mirror of the file sidebar's.
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commitWidth(width + KEYBOARD_RESIZE_STEP)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      commitWidth(width - KEYBOARD_RESIZE_STEP)
    }
  }

  if (openEntries.length === 0) return null

  const editingCard = editingCardId === null ? undefined : cards.find(card => card.id === editingCardId)

  return (
    <TooltipProvider>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <aside
            aria-label="Fiches de cartes"
            style={{
              position: 'relative',
              width,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border)',
              background: 'var(--background)',
              overflowY: 'auto',
            }}
          >
            {/* Straddles the border, like the file sidebar's handle, so the grab
                target is bigger than the 1px line it moves. */}
            <div
              ref={handleRef}
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionner le panneau des fiches"
              aria-valuenow={width}
              aria-valuemin={MIN_CARD_DETAIL_WIDTH}
              aria-valuemax={MAX_CARD_DETAIL_WIDTH}
              tabIndex={0}
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
              onKeyDown={handleResizeKeyDown}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: -2,
                width: 5,
                zIndex: 2,
                cursor: 'col-resize',
                background: resizing ? 'var(--primary)' : 'transparent',
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 2,
                padding: '4px 6px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={stackMode ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-label={stackMode ? 'Désactiver le mode pile' : 'Activer le mode pile'}
                    aria-pressed={stackMode}
                    onClick={toggleStackMode}
                  >
                    <Layers size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {stackMode ? 'Désactiver le mode pile' : 'Activer le mode pile'}
                  <span style={{ opacity: 0.7, marginLeft: 8 }}>Une fiche reste affichée quand une autre s’ouvre</span>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Vider la liste des fiches"
                    onClick={clearUnpinned}
                  >
                    <Eraser size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Vider la liste
                  <span style={{ opacity: 0.7, marginLeft: 8 }}>Ferme toutes les fiches non épinglées</span>
                </TooltipContent>
              </Tooltip>
            </div>

            {openEntries.map(entry => {
              const card = cards.find(c => c.id === entry.cardId)
              // Guarded rather than assumed: `retain` clears fiches for deleted
              // cards, but it runs on a store subscription and this render can be
              // the one in between.
              if (card === undefined) return null
              return (
                <CardFiche
                  key={entry.cardId}
                  card={card}
                  cards={cards}
                  pinned={entry.pinned}
                  collapsed={entry.collapsed}
                  onPin={() => pin(card.id)}
                  onUnpin={() => unpin(card.id)}
                  onClose={() => close(card.id)}
                  onToggleCollapsed={() => toggleCollapsed(card.id)}
                  onEdit={() => setEditing(card.id)}
                />
              )
            })}

            {/* One editor for the whole panel, keyed by card, rather than one per
                fiche: two dialogs for the same card must be impossible, and the
                store already holds which card is being edited. */}
            {editingCard !== undefined && (
              <FicheEditor card={editingCard} cards={cards} onClose={() => setEditing(null)} />
            )}
          </aside>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <PanelMenuCommands />
        </ContextMenuContent>
      </ContextMenu>
    </TooltipProvider>
  )
}

function CardFiche({
  card,
  cards,
  pinned,
  collapsed,
  onPin,
  onUnpin,
  onClose,
  onToggleCollapsed,
  onEdit,
}: {
  card: Card
  cards: Card[]
  pinned: boolean
  collapsed: boolean
  onPin: () => void
  onUnpin: () => void
  onClose: () => void
  onToggleCollapsed: () => void
  onEdit: () => void
}) {
  const locked = useCardsStore(selectEditsBlocked)
  const updateContent = useCardsStore(s => s.updateContent)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const theme = useResolvedTheme()
  const level = clampCardLevel(card.level)
  const levelAppearance = useAppearanceSettingsStore(s => s.levels[level])
  const colors = card.detached === true ? detachedColors[theme] : levelAppearance.color[theme]

  const blocks = contentOf(card)
  const breadcrumb = ancestorTitles(cards, card.id)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <section
          aria-label={`Fiche de ${card.title}`}
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <header style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '8px 8px 8px 10px' }}>
            {/* The level colour is the same one the card wears on the canvas: with
                several fiches stacked, it is the fastest way to tell which branch
                each one came from. */}
            <span
              aria-hidden
              style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: toCss(colors.border) }}
            />
            <button
              type="button"
              aria-label={collapsed ? `Déplier la fiche de ${card.title}` : `Replier la fiche de ${card.title}`}
              aria-expanded={!collapsed}
              onClick={onToggleCollapsed}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
                padding: 0,
                textAlign: 'left',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ paddingTop: 2, opacity: 0.6 }}>
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {breadcrumb.length > 0 && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 10,
                      opacity: 0.55,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {breadcrumb.join(' › ')}
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.title}
                  </span>
                  {/* A collapsed fiche shows ONLY its header, so the badges are
                      what say whether it is worth reopening. */}
                  {collapsed && <ContentKindBadges blocks={blocks} />}
                </span>
              </span>
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    pinned
                      ? `Désépingler la fiche de ${card.title}`
                      : `Épingler la fiche de ${card.title}`
                  }
                  onClick={pinned ? onUnpin : onPin}
                >
                  {pinned ? <PinOff /> : <Pin />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {pinned
                  ? 'Désépingler : la fiche redevient un aperçu'
                  : 'Épingler : la fiche reste ouverte quand une autre est consultée'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Fermer la fiche de ${card.title}`}
                  onClick={onClose}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fermer</TooltipContent>
            </Tooltip>
          </header>

          {!collapsed && (
            <div style={{ padding: '0 12px 12px 16px', fontSize: 13 }}>
              {blocks.length > 0 ? (
                <BlockView
                  blocks={blocks}
                  resolveAsset={currentFilePath === null ? () => '' : asset => assetSrc(currentFilePath, asset)}
                />
              ) : (
                <p style={{ margin: '0 0 8px', opacity: 0.6 }}>Cette carte n’a pas encore de description.</p>
              )}

              {!locked && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <Button variant="outline" size="sm" onClick={onEdit}>
                    {blocks.length > 0 ? <Pencil /> : <Plus />}
                    {blocks.length > 0 ? 'Modifier' : 'Ajouter une description'}
                  </Button>
                  {blocks.length > 0 && (
                    <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteOpen(true)}>
                      <Trash2 />
                      Supprimer
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {confirmDeleteOpen && (
            <Dialog open onOpenChange={setConfirmDeleteOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Supprimer la description de « {card.title} » ?</DialogTitle>
                </DialogHeader>
                <p style={{ margin: 0, fontSize: 14 }}>Le contenu de cette fiche sera définitivement supprimé.</p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                    Annuler
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      updateContent(card.id, [])
                      setConfirmDeleteOpen(false)
                    }}
                  >
                    Supprimer
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </section>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <PanelMenuCommands />
        <ContextMenuSeparator />
        {!locked && (
          <ContextMenuItem onSelect={onEdit}>
            {blocks.length > 0 ? <Pencil size={14} /> : <Plus size={14} />}
            {blocks.length > 0 ? 'Modifier' : 'Ajouter une description'}
          </ContextMenuItem>
        )}
        {!locked && blocks.length > 0 && (
          <ContextMenuItem variant="destructive" onSelect={() => setConfirmDeleteOpen(true)}>
            <Trash2 size={14} /> Supprimer
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={pinned ? onUnpin : onPin}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />} {pinned ? 'Désépingler' : 'Épingler'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The editor, opened from a fiche.
 *
 * Split out so the image capabilities and the store wiring live in one place
 * rather than being rebuilt for every open fiche — and so the panel above stays
 * about layout.
 */
function FicheEditor({ card, cards, onClose }: { card: Card; cards: Card[]; onClose: () => void }) {
  const updateContent = useCardsStore(s => s.updateContent)
  // A description written from the editor joins the panel immediately: the
  // card had nothing to read a second ago, so nothing was opened for it, and
  // saving it is exactly the moment the fiche becomes worth showing.
  const show = useCardDetailStore(s => s.show)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)

  return (
    <DescriptionDialog
      breadcrumb={ancestorTitles(cards, card.id)}
      cardTitle={card.title}
      blocks={contentOf(card)}
      onSave={blocks => {
        updateContent(card.id, blocks)
        if (blocks.length > 0) show(card.id)
      }}
      onClose={onClose}
      resolveAsset={currentFilePath === null ? () => '' : asset => assetSrc(currentFilePath, asset)}
      // Gated on there being an open file: assets live in a sidecar named
      // after it, so with none there is nowhere to store one and the
      // affordances stay hidden rather than failing on click.
      onInsertImage={currentFilePath ? source => imageBlockFrom(currentFilePath, source) : undefined}
      onPickImage={
        currentFilePath
          ? async () => {
              const source = await pickImageFile()
              return source === null ? undefined : imageBlockFrom(currentFilePath, source)
            }
          : undefined
      }
      onError={setWorkspaceError}
    />
  )
}
