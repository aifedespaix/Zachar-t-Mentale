import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { canReceiveChildren, isRootCard, type Card } from '../../types/card'
import { useCardsStore, selectEditsBlocked } from '../../state/useCardsStore'
import { useCardDetailStore } from '../../state/useCardDetailStore'
import { useCardHoverStore } from '../../state/useCardHoverStore'
import { useCardSelectionStore } from '../../state/useCardSelectionStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { useCommand } from '../../hooks/useCommand'
import { ancestorTitles, siblingsOf, childrenOf } from '../../state/cardsReducer'
import { clampCardLevel, detachedColors } from '../../colors/levelColors'
import { toCss } from '../../colors/contrast'
import { contentOf, blocksToPlainText } from '../../content/blocks'
import { BlockView } from '../../content/BlockView'
import { ContentKindBadges } from '../../content/ContentKindBadges'
import { DescriptionDialog, type NavSide, type TitleChipColors } from '../../content/DescriptionDialog'
import { imageBlockFrom } from '../../content/imageBlock'
import { pickImageFile } from '../../content/pickImage'
import { assetSrc } from '../../persistence/assets'
import { prefersReducedMotion } from '../../utils/prefersReducedMotion'
import { normalizeForComparison } from '../../utils/textSimilarity'
import {
  clampCardDetailWidth,
  loadCardDetailWidth,
  saveCardDetailWidth,
  MAX_CARD_DETAIL_WIDTH,
  MIN_CARD_DETAIL_WIDTH,
} from '../../persistence/cardDetailWidth'
import { Button } from '../ui/button'
import { CommandButton } from '../commands/CommandButton'
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
 * three cards is how a revision actually goes — the panel is always a stack,
 * every fiche opened joins the others rather than replacing one.
 */
/**
 * The one panel-wide command — « tout fermer ».
 *
 * Rendered in the panel's own context menu AND in each fiche's, because a
 * right-click on a fiche is still a right-click in the panel: the fiche's menu
 * adds its card-specific actions on top, it does not replace this one.
 */
function PanelMenuCommands() {
  const closeAll = useCardDetailStore(s => s.closeAll)
  return (
    <ContextMenuItem onSelect={closeAll}>
      <Eraser size={14} /> Tout fermer
    </ContextMenuItem>
  )
}

export function CardDetailPanel() {
  const openEntries = useCardDetailStore(s => s.open)
  const editingCardId = useCardDetailStore(s => s.editingCardId)
  const close = useCardDetailStore(s => s.close)
  const toggleCollapsed = useCardDetailStore(s => s.toggleCollapsed)
  const setEditing = useCardDetailStore(s => s.setEditing)
  const closeAll = useCardDetailStore(s => s.closeAll)
  const cards = useCardsStore(s => s.history.present)

  /**
   * Creates the neighbour an edge asked for, with the title its own prompt
   * already collected (see `CreatePromptOverlay`), then moves the dialog onto
   * it. A card is never born blind or nameless any more, so there is no
   * placeholder left to type over — unlike the "+" this replaced, nothing here
   * asks the fresh dialog to auto-select a title field.
   *
   * The dialog only knows a "+" was activated on its left/right/top/bottom;
   * which op that maps to is the caller's business. The store owns the rules,
   * and an op it refuses simply leaves the dialog where it was.
   */
  const createRelative = useCallback(
    (cardId: string, side: NavSide, title: string) => {
      const store = useCardsStore.getState()
      const newCardId =
        side === 'right'
          ? store.addChild(cardId)
          : side === 'top'
            ? store.addSibling(cardId, 'above')
            : side === 'bottom'
              ? store.addSibling(cardId, 'below')
              : null
      if (newCardId === null) return
      store.updateTitle(newCardId, title)
      setEditing(newCardId)
    },
    [setEditing]
  )

  const [width, setWidth] = useState(loadCardDetailWidth)
  const [resizing, setResizing] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)
  /** What the search field holds. A view over the open fiches — never persisted. */
  const [search, setSearch] = useState('')
  /**
   * Hides the panel down to a thin strip, like the file sidebar's own fold —
   * but only ever while there is something to hide: with nothing open the
   * panel already goes away on its own (see `mounted` below).
   */
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false)

  const isOpen = openEntries.length > 0
  /**
   * Whether this panel is hosting anything at all.
   *
   * No longer the same question as `isOpen`: the description editor is rendered
   * from here, and opening that editor no longer opens a fiche — so a card can
   * be written in with the panel showing nothing at all. `isOpen` still decides
   * the WIDTH, so the panel stays at zero and the map keeps its room; this
   * decides whether the component is there to host the dialog, which is
   * rendered into a portal and therefore does not care how wide its host is.
   */
  const hostingEditor = editingCardId !== null
  // Stays mounted a beat after the last fiche closes, so the panel can shrink
  // away instead of vanishing mid-frame; `wasOpenRef` is what tells the effect
  // below "this is a fresh open" from "this is a fresh close" without also
  // firing on every unrelated re-render.
  const [mounted, setMounted] = useState(isOpen || hostingEditor)
  // Also true when the panel mounts already open (e.g. a fiche was open
  // before this component existed), so that case grows from zero too.
  const [entering, setEntering] = useState(isOpen)
  const wasOpenRef = useRef(isOpen)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setMounted(true)
      setEntering(true)
      wasOpenRef.current = true
    }
    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false
      const timer = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    // The editor alone is enough to need the host mounted — and once it is gone,
    // with no fiche behind it, the host goes too. Same beat as a closing fiche,
    // so a close reads as a shrink rather than a blink.
    if (hostingEditor) {
      setMounted(true)
      return
    }
    if (isOpen) return
    const timer = setTimeout(() => setMounted(false), 220)
    return () => clearTimeout(timer)
  }, [hostingEditor, isOpen])

  const openCountRef = useRef(openEntries.length)
  useEffect(() => {
    // Opening a fiche is the whole point of opening it, so a fold from
    // earlier does not survive a NEW fiche joining the list — whether the
    // panel was empty or already had others open.
    if (openEntries.length > openCountRef.current) setManuallyCollapsed(false)
    openCountRef.current = openEntries.length
  }, [openEntries.length])

  useEffect(() => {
    if (!entering) return
    // One frame at width 0 before jumping to `width` is what makes the grow
    // an animation instead of a snap: setting both in the same render would
    // paint the final width directly, with nothing to transition from.
    const frame = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(frame)
  }, [entering])

  const hoveredCardId = useCardHoverStore(s => s.hoveredCardId)
  // Where each open fiche lives in the DOM, keyed by card id: the auto-scroll
  // needs the element, and a callback ref on `CardFiche` is the one place where
  // the card id and its node are both in scope.
  const ficheRefs = useRef(new Map<string, HTMLElement>())

  /**
   * Brings the hovered card's fiche into view.
   *
   * `block: 'nearest'` scrolls the panel the SMALLEST amount that makes the fiche
   * visible, so hovering the fiche itself (already on screen) is a natural
   * no-op, and one that sits above or below glides just to the edge instead of
   * jumping to the middle. No hovered card, or no fiche open for it, is nothing
   * to scroll.
   */
  useEffect(() => {
    if (hoveredCardId === null) return
    const fiche = ficheRefs.current.get(hoveredCardId)
    if (fiche === undefined) return
    fiche.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' })
  }, [hoveredCardId])

  const selectedCardId = useCardSelectionStore(s => s.selectedCardId)
  /**
   * Same auto-scroll as the hover one above, keyed on selection instead — the
   * one that matters for keyboard/minimap navigation, which moves the
   * selection without ever touching the pointer.
   */
  useEffect(() => {
    if (selectedCardId === null) return
    const fiche = ficheRefs.current.get(selectedCardId)
    if (fiche === undefined) return
    fiche.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' })
  }, [selectedCardId])

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

  // Registered unconditionally (like the file sidebar's own fold command), so
  // the shortcut still reaches the panel while it is folded away — only
  // disabled with nothing open to fold in the first place.
  useCommand(
    'view.toggleDetailPanel',
    () => setManuallyCollapsed(current => !current),
    isOpen,
    manuallyCollapsed ? 'Afficher les fiches' : 'Masquer les fiches'
  )

  if (!mounted && !hostingEditor) return null

  const renderedWidth = isOpen && !entering ? width : 0
  const editingCard = editingCardId === null ? undefined : cards.find(card => card.id === editingCardId)

  /**
   * The description editor, ready to drop into whichever shape this panel takes.
   *
   * It is a `Dialog`, so it renders into a portal: it does not need to be
   * inside the panel's chrome, only inside a mounted component. That is what
   * lets the panel stay out of the way — folded, or absent entirely — while a
   * card is still being written in.
   */
  const editor =
    editingCard === undefined ? null : (
      // Keyed by card id: the edge arrows inside the dialog navigate by asking
      // the store to edit a different card, which changes `editingCard` without
      // unmounting this call site on its own — the key is what forces a fresh
      // `DescriptionDialog` (and a fresh draft seeded from the new card) rather
      // than reusing the old instance with the new card's props stapled onto it.
      <FicheEditor
        key={editingCard.id}
        card={editingCard}
        cards={cards}
        onClose={() => setEditing(null)}
        onCreateRelative={createRelative}
      />
    )

  if (isOpen && manuallyCollapsed) {
    return (
      <>
        <TooltipProvider>
          <div
            style={{
              width: 32,
              flexShrink: 0,
              borderLeft: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              paddingBottom: 8,
            }}
          >
            <CommandButton
              command="view.toggleDetailPanel"
              icon={PanelRightOpen}
              label="Déplier le panneau des fiches"
              variant="ghost"
              size="icon-sm"
            />
          </div>
        </TooltipProvider>
        {editor}
      </>
    )
  }

  // Nothing to read, and nothing left to shrink away either: the editor only.
  // The aside is NOT rendered, even at zero width — its header, its search
  // field and its footer would all still be laid out inside a zero-width box,
  // spilling over the map for as long as the dialog stays open. (While a fiche
  // IS closing, `mounted` is still true and the aside runs its own animation
  // below, which is exactly what `mounted` is for.)
  if (!isOpen && !mounted) return <>{editor}</>


  /**
   * The search is a VIEW over the open fiches, never a mutation of them: it
   * never touches `collapsed`, so a fiche that only matches through its
   * description stays exactly as folded as it was.
   */
  const query = search.trim()
  const searching = query !== ''
  const needle = normalizeForComparison(query)
  const visibleEntries = !searching
    ? openEntries
    : openEntries.filter(entry => {
        const card = cards.find(c => c.id === entry.cardId)
        if (card === undefined) return true
        if (normalizeForComparison(card.title).includes(needle)) return true
        return normalizeForComparison(blocksToPlainText(contentOf(card))).includes(needle)
      })

  return (
    <TooltipProvider>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <aside
            aria-label="Fiches de cartes"
            style={{
              position: 'relative',
              width: renderedWidth,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border)',
              background: 'var(--background)',
              // Off during a drag and for "reduce motion", same rationale as
              // the file sidebar's own width transition.
              transition: resizing || prefersReducedMotion() ? 'none' : 'width 220ms ease',
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

            {/* Same split as the file sidebar: the header names the panel, every
                action lives in the footer bar below. */}
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Fiches de cartes</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search
                  size={13}
                  style={{ position: 'absolute', left: 7, color: 'var(--muted-foreground)', pointerEvents: 'none' }}
                />
                <input
                  className="sidebar-search"
                  type="text"
                  value={search}
                  placeholder="Rechercher…"
                  aria-label="Rechercher dans les fiches"
                  onChange={event => setSearch(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Escape') return
                    setSearch('')
                    event.currentTarget.blur()
                  }}
                  style={{ paddingLeft: 24, paddingRight: search === '' ? 8 : 26 }}
                />
                {search !== '' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Effacer la recherche"
                    onClick={() => setSearch('')}
                    style={{ position: 'absolute', right: 2 }}
                  >
                    <X size={13} />
                  </Button>
                )}
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {searching && visibleEntries.length === 0 && (
                <p role="status" style={{ padding: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>
                  Aucun résultat pour « {query} ».
                </p>
              )}
              {visibleEntries.map(entry => {
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
                    collapsed={entry.collapsed}
                    onClose={() => close(card.id)}
                    onToggleCollapsed={() => toggleCollapsed(card.id)}
                    onEdit={() => setEditing(card.id)}
                    sectionRef={element => {
                      if (element === null) ficheRefs.current.delete(card.id)
                      else ficheRefs.current.set(card.id, element)
                    }}
                  />
                )
              })}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '4px 6px',
                borderTop: '1px solid var(--border)',
                flexShrink: 0,
                flexWrap: 'wrap',
              }}
            >
              <CommandButton
                command="view.toggleDetailPanel"
                icon={PanelRightClose}
                label="Replier le panneau des fiches"
                variant="ghost"
                size="icon-sm"
              />
              <span className="toolbar-separator" aria-hidden />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Tout fermer" onClick={closeAll}>
                    <Eraser size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Tout fermer
                  <span style={{ opacity: 0.7, marginLeft: 8 }}>Ferme toutes les fiches ouvertes</span>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* One editor for the whole panel, keyed by card, rather than one per
                fiche: two dialogs for the same card must be impossible, and the
                store already holds which card is being edited. */}
            {editor}
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
  collapsed,
  onClose,
  onToggleCollapsed,
  onEdit,
  sectionRef,
}: {
  card: Card
  cards: Card[]
  collapsed: boolean
  onClose: () => void
  onToggleCollapsed: () => void
  onEdit: () => void
  /** Registers the fiche's DOM node with the panel, for the hover auto-scroll. */
  sectionRef?: (element: HTMLElement | null) => void
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
  // The fiche half of the cross-highlight — see `useCardHoverStore`. Hovering
  // here lights up the card on the canvas AND this fiche, so the two always read
  // as one object whichever side the pointer entered.
  const hovered = useCardHoverStore(s => s.hoveredCardId === card.id)
  const hoverCard = useCardHoverStore(s => s.hover)
  const unhoverCard = useCardHoverStore(s => s.unhover)
  // The fiche half of the SELECTION cross-highlight, mirroring `CardNode`'s own
  // `selected` — same neutral `--ring` colour on both sides, kept distinct
  // from `hovered`'s level colour so "the card I clicked" and "the card my
  // pointer happens to be over" never look the same fiche.
  const selected = useCardSelectionStore(s => s.selectedCardId === card.id)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <section
          ref={sectionRef}
          aria-label={`Fiche de ${card.title}`}
          data-hovered={hovered}
          data-selected={selected}
          onMouseEnter={() => hoverCard(card.id)}
          onMouseLeave={() => unhoverCard(card.id)}
          style={{
            borderBottom: '1px solid var(--border)',
            // Discreet and symmetric with the card's halo: a faint level-tinted
            // wash plus a crisp accent bar at the panel's edge. The bar is an
            // INSET SHADOW, not a border, so switching it on moves nothing.
            //
            // Selection wins the background wash when both states apply (a
            // flat background can only show one tint at a time), but the bar
            // stacks like the card's own ring: hover's 2px on top, selection's
            // wider 4px showing through behind it.
            background: selected
              ? 'color-mix(in oklch, var(--ring), transparent 85%)'
              : hovered
                ? `color-mix(in oklch, ${toCss(colors.bg)}, transparent 92%)`
                : undefined,
            boxShadow: [
              `inset 2px 0 0 ${hovered ? toCss(colors.border) : 'transparent'}`,
              `inset 4px 0 0 ${selected ? 'var(--ring)' : 'transparent'}`,
            ].join(', '),
            transition: 'background 140ms ease, box-shadow 140ms ease',
          }}
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
                  {/* Focused on open, visibly — not just Radix's default focus
                      on « Annuler » — so the ring shows which action Entrée
                      will trigger, and Entrée actually triggers it. */}
                  <Button
                    variant="destructive"
                    autoFocus
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
function FicheEditor({
  card,
  cards,
  onClose,
  onCreateRelative,
}: {
  card: Card
  cards: Card[]
  onClose: () => void
  onCreateRelative: (cardId: string, side: NavSide, title: string) => void
}) {
  const updateContent = useCardsStore(s => s.updateContent)
  const updateTitle = useCardsStore(s => s.updateTitle)
  const editsBlocked = useCardsStore(selectEditsBlocked)
  const setEditing = useCardDetailStore(s => s.setEditing)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const theme = useResolvedTheme()
  const level = clampCardLevel(card.level)
  const levelAppearance = useAppearanceSettingsStore(s => s.levels[level])
  const colors = card.detached === true ? detachedColors[theme] : levelAppearance.color[theme]
  // Every level at once, for the dialog's edge arrows: each one leads to a
  // different card, and each is painted in ITS OWN card's colours so the user
  // can recognise where a jump goes before reading the title on the button.
  const allLevels = useAppearanceSettingsStore(s => s.levels)

  /** The palette a level wears: how a "+" predicts the colour of the card it will create. */
  function paletteForLevel(targetLevel: number): TitleChipColors {
    const palette = allLevels[clampCardLevel(targetLevel)].color[theme]
    return { bg: toCss(palette.bg), border: toCss(palette.border), text: toCss(palette.text) }
  }

  /** The palette a card wears — same rules as this one: its level, or the achromatic detached set. */
  function chipColorsFor(target: Card | undefined): TitleChipColors | undefined {
    if (target === undefined) return undefined
    if (target.detached === true) {
      const palette = detachedColors[theme]
      return { bg: toCss(palette.bg), border: toCss(palette.border), text: toCss(palette.text) }
    }
    return paletteForLevel(target.level)
  }

  // The edge arrows' targets: the parent LEFT, the first child RIGHT (with
  // a count when there is more than one), and this card's neighbours at the
  // same level ABOVE and BELOW. `siblingsOf` includes the card itself, sorted
  // in display order, so its own position in that list is where the
  // previous/next split falls.
  const parent = card.parentId === null ? undefined : cards.find(c => c.id === card.parentId)
  const children = childrenOf(cards, card.id)
  const siblings = siblingsOf(cards, card.id)
  const ownIndex = siblings.findIndex(sibling => sibling.id === card.id)
  const prevSibling = ownIndex > 0 ? siblings[ownIndex - 1] : undefined
  const nextSibling = ownIndex >= 0 && ownIndex < siblings.length - 1 ? siblings[ownIndex + 1] : undefined

  /**
   * What each empty edge offers to create, in the palette the new card will
   * actually wear — so a "+" for a child predicts the CHILD's level colour, and
   * one for a sibling predicts this card's own.
   *
   * The rules are the store's, checked HERE rather than at click time so a "+"
   * is never offered for a card the store would refuse: a floating card can
   * neither receive a child nor join a sibling group, a level-4 card has no room
   * for a child, and the root has no siblings to sit beside. `left` is absent by
   * design — the only card with no parent is the root, and the store cannot
   * invent a parent for it.
   */
  const canCreateSibling = !isRootCard(card) && card.detached !== true
  const onCreate = editsBlocked
    ? undefined
    : {
        right: canReceiveChildren(card)
          ? { colors: paletteForLevel(card.level + 1), onSelect: (title: string) => onCreateRelative(card.id, 'right', title) }
          : undefined,
        top: canCreateSibling
          ? { colors: paletteForLevel(card.level), onSelect: (title: string) => onCreateRelative(card.id, 'top', title) }
          : undefined,
        bottom: canCreateSibling
          ? { colors: paletteForLevel(card.level), onSelect: (title: string) => onCreateRelative(card.id, 'bottom', title) }
          : undefined,
      }

  return (
    <DescriptionDialog
      cardId={card.id}
      breadcrumb={ancestorTitles(cards, card.id)}
      cardTitle={card.title}
      blocks={contentOf(card)}
      onSave={blocks => {
        // The content, and only the content. Saving used to also open the
        // card's fiche, so that a description written from scratch "joined the
        // panel immediately" — which meant the editor and the eye both pushed
        // something into the right panel, and the user could not write a note
        // without being shown a fiche they had not asked to read. Writing and
        // reading are two intentions; the eye is the button for the second one.
        updateContent(card.id, blocks)
      }}
      onClose={onClose}
      parentTarget={parent && { id: parent.id, title: parent.title, colors: chipColorsFor(parent) }}
      childTarget={
        children[0] && {
          id: children[0].id,
          title: children[0].title,
          count: children.length,
          colors: chipColorsFor(children[0]),
        }
      }
      prevSibling={prevSibling && { id: prevSibling.id, title: prevSibling.title, colors: chipColorsFor(prevSibling) }}
      nextSibling={nextSibling && { id: nextSibling.id, title: nextSibling.title, colors: chipColorsFor(nextSibling) }}
      onNavigate={setEditing}
      onCreate={onCreate}
      // The dialog's title field mirrors the card's own — same colours, same
      // rename — so "the biggest, most present place to work on this card" is
      // recognisably the same card, not a bare form.
      onRenameTitle={title => updateTitle(card.id, title)}
      titleColors={{ bg: toCss(colors.bg), border: toCss(colors.border), text: toCss(colors.text) }}
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
